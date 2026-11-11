-- "Find my photos" on share links: a per-event face index built in a team member's browser (lib/faces.ts,
-- components/face-index-button.tsx). Only face embeddings are stored, never images. A guest's selfie embedding
-- is compared with match_faces and not stored.
create extension if not exists vector;

-- Admin switch per event: show "Find my photos" on the event's share links.
alter table public.events
  add column if not exists face_search boolean not null default false;

-- One row per scanned photo, also for photos with no faces (faces = 0) or that couldn't be read (faces = -1),
-- so they aren't scanned again. Removed with the photo's index row (delta sync deletes, link change resets).
create table if not exists public.face_scans (
  event_id   uuid not null,
  item_id    text not null,
  faces      int not null,
  scanned_at timestamptz not null default now(),
  primary key (event_id, item_id),
  foreign key (event_id, item_id) references public.nodes (event_id, id) on delete cascade
);

-- L2-normalised 1024-d faceres descriptors (half precision is plenty and halves the scan).
-- `box` is the face's [x, y, w, h] as fractions of the photo.
create table if not exists public.face_embeddings (
  event_id  uuid not null,
  item_id   text not null,
  face_idx  int not null,
  embedding halfvec(1024) not null,
  box       jsonb,
  primary key (event_id, item_id, face_idx),
  foreign key (event_id, item_id) references public.face_scans (event_id, item_id) on delete cascade
);

alter table public.face_scans enable row level security;
alter table public.face_embeddings enable row level security;

-- Image index rows of an event that haven't been scanned yet, newest first (new uploads become searchable first).
create or replace function public.unscanned_images(ev uuid, lim int default 50)
returns setof public.nodes language sql stable as $$
  select n.* from public.nodes n
  where n.event_id = ev and n.kind = 'file' and n.is_image
    and not exists (select 1 from public.face_scans s where s.event_id = ev and s.item_id = n.id)
  order by n.modified_at desc nulls last, n.id
  limit lim;
$$;

-- Counts for the indexing dialog and /settings.
create or replace function public.face_index_status(ev uuid)
returns table (images bigint, scanned bigint, faces bigint) language sql stable as $$
  select
    (select count(*) from public.nodes where event_id = ev and kind = 'file' and is_image),
    (select count(*) from public.face_scans where event_id = ev),
    (select count(*) from public.face_embeddings where event_id = ev);
$$;

-- Photos of one event with a face within `max_dist` (cosine distance) of `q`, closest first.
-- Scope: null/null = the whole event; otherwise items in `scope_ids` or inside any folder path in `scope_paths`
-- (nodes.path is the item's parent folders, '/'-joined). An exact scan over one event's faces: no ANN index,
-- since the event filter would defeat it and an event holds tens of thousands of faces at most.
create or replace function public.match_faces(
  ev uuid,
  q halfvec(1024),
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
