-- Per-file download counts, for team and share-link downloads alike (0006 only counts per share link).
-- One row per downloaded file. A single download adds 1; a zip adds 1 to every file inside it.
-- Not counted: ?json=1 URL refreshes and ?stream=1 video playback. Shown to the team only.

create table if not exists public.item_downloads (
  event_id  uuid not null references public.events (id) on delete cascade,
  item_id   text not null,
  count     bigint not null default 0,
  last_at   timestamptz not null default now(),
  primary key (event_id, item_id)
);

alter table public.item_downloads enable row level security;

-- Adds one download to each id without a read-modify-write race. Duplicate ids in one call count once.
create or replace function public.record_item_downloads(ev uuid, ids text[])
returns void
language sql
as $$
  insert into public.item_downloads (event_id, item_id, count, last_at)
  select ev, id, 1, now() from (select distinct unnest(ids) as id) s
  on conflict (event_id, item_id)
  do update set count = item_downloads.count + 1, last_at = now();
$$;
