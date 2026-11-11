-- Face search rework: a new face model (128-d embeddings instead of 1024-d) and automatic grouping of faces
-- into people. Old and new embeddings can't be compared, so this EMPTIES the face index of every event: photos
-- are scanned again automatically the next time the admin has the app open.

-- 1. Drop the old index contents and the old search function (its argument type changes).
delete from public.face_scans; -- cascades to face_embeddings
drop function if exists public.match_faces(uuid, halfvec, float, int, text[], text[]);

-- 2. People: one row per person found in an event. `total` is the sum of that person's face embeddings;
--    cosine distance ignores length, so comparing with the sum is the same as comparing with the average face.
create table if not exists public.face_people (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  total      vector(128) not null,
  name       text,
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists face_people_event on public.face_people (event_id);
alter table public.face_people enable row level security;

-- 3. Embeddings: 128-d, and which person each face belongs to (null = not grouped: too small, or not yet).
alter table public.face_embeddings drop column if exists embedding;
alter table public.face_embeddings add column embedding halfvec(128) not null;
alter table public.face_embeddings
  add column if not exists person_id uuid references public.face_people (id) on delete set null;
create index if not exists face_embeddings_person on public.face_embeddings (person_id);

-- Photos of one event with a face within `max_dist` (cosine distance) of `q`, closest first. Unchanged from
-- 0023 apart from the embedding size. Scope: null/null = the whole event; otherwise items in `scope_ids` or
-- inside any folder path in `scope_paths`.
create or replace function public.match_faces(
  ev uuid,
  q halfvec(128),
  max_dist float,
  lim int default 500,
  scope_paths text[] default null,
  scope_ids text[] default null
)
returns table (item_id text, distance float) language sql stable as $$
  select f.item_id, min(f.embedding <=> q) as distance
  from public.face_embeddings f
  join public.nodes n on n.event_id = f.event_id and n.id = f.item_id
  where f.event_id = ev
    and (f.embedding <=> q) <= max_dist
    and (
      (scope_paths is null and scope_ids is null)
      or n.id = any (scope_ids)
      or exists (
        select 1 from unnest(scope_paths) p
        where n.path = p or left(n.path, length(p) + 1) = p || '/'
      )
    )
  group by f.item_id
  order by distance
  limit lim;
$$;

-- Groups an event's ungrouped faces into people, biggest (clearest) faces first. A face joins the nearest
-- person within `max_dist`, else it starts a new person. Two rules keep groups clean:
--   - a person can't be in the same photo twice, so look-alikes standing together aren't merged;
--   - faces narrower than `min_width` of the photo are too small to identify and stay ungrouped.
-- Called after every saved scan batch, so it only ever sees the new faces. Returns how many it grouped.
create or replace function public.assign_face_people(ev uuid, max_dist float, min_width float default 0.025)
returns int language plpgsql as $$
declare
  f record;
  pid uuid;
  grouped int := 0;
begin
  for f in
    select e.item_id, e.face_idx, e.embedding::vector(128) as emb
    from public.face_embeddings e
    where e.event_id = ev and e.person_id is null and (e.box ->> 2)::float >= min_width
    order by (e.box ->> 2)::float * (e.box ->> 3)::float desc
  loop
    pid := null;
    select p.id into pid
    from public.face_people p
    where p.event_id = ev
      and (p.total <=> f.emb) < max_dist
      and not exists (
        select 1 from public.face_embeddings o
        where o.event_id = ev and o.item_id = f.item_id and o.person_id = p.id
      )
    order by p.total <=> f.emb
    limit 1;

    if pid is null then
      insert into public.face_people (event_id, total) values (ev, f.emb) returning id into pid;
    else
      update public.face_people set total = total + f.emb where id = pid;
    end if;
    update public.face_embeddings set person_id = pid
    where event_id = ev and item_id = f.item_id and face_idx = f.face_idx;
    grouped := grouped + 1;
  end loop;
  return grouped;
end;
$$;

-- An event's people, most-photographed first, each with their clearest (largest) face as the cover.
-- Counts are read live, so deleted photos drop out by themselves.
create or replace function public.list_face_people(ev uuid, min_photos int default 2)
returns table (id uuid, name text, hidden boolean, photos bigint, cover_item text, cover_box jsonb)
language sql stable as $$
  select p.id, p.name, p.hidden, c.photos, b.item_id, b.box
  from public.face_people p
  join lateral (
    select count(distinct e.item_id) as photos from public.face_embeddings e where e.person_id = p.id
  ) c on true
  join lateral (
    select e.item_id, e.box from public.face_embeddings e
    where e.person_id = p.id
    order by (e.box ->> 2)::float * (e.box ->> 3)::float desc
    limit 1
  ) b on true
  where p.event_id = ev and c.photos >= min_photos
  order by c.photos desc, p.created_at;
$$;
