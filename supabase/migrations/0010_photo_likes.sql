-- Team likes on photos: one row per person per item. Only the team likes (share-link visitors can't).
-- owner is "admin" for the password login, or the SSO user's email (same as shares.created_by).

create table if not exists public.photo_likes (
  event_id  uuid not null references public.events (id) on delete cascade,
  item_id   text not null,
  owner     text not null,
  liked_at  timestamptz not null default now(),
  primary key (event_id, item_id, owner)
);

create index if not exists photo_likes_owner_idx on public.photo_likes (owner);

alter table public.photo_likes enable row level security;

-- Most liked items, optionally within one event. Hidden events are skipped.
create or replace function public.top_liked(ev uuid default null, lim int default 100)
returns table (event_id uuid, item_id text, likes bigint)
language sql stable as $$
  select l.event_id, l.item_id, count(*) as likes
  from public.photo_likes l
  join public.events e on e.id = l.event_id and not e.hidden
  where ev is null or l.event_id = ev
  group by l.event_id, l.item_id
  order by likes desc, max(l.liked_at) desc
  limit lim;
$$;
