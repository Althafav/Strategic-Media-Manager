-- Albums: a team member's own collection of picked photos/files, possibly from several events and folders.
-- Nothing is copied or moved in OneDrive: album_items only point at OneDrive item ids, like share links and requests.
-- created_by is 'admin' or the SSO user's email (shareOwner). Only the owner changes an album; the team members in
-- shared_with may open and download it. Items from private events are hidden from people who can't see that event.

create table if not exists public.albums (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 120),
  created_by  text not null,
  shared_with text[] not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists albums_created_by_idx on public.albums (created_by);
create index if not exists albums_shared_with_idx on public.albums using gin (shared_with);

create table if not exists public.album_items (
  album_id  uuid not null references public.albums (id) on delete cascade,
  event_id  uuid not null references public.events (id) on delete cascade,
  item_id   text not null,
  name      text not null,
  kind      text not null check (kind in ('file', 'folder')),
  path      text[] not null default '{}', -- the item's own folder, relative to the event root
  added_at  timestamptz not null default now(),
  primary key (album_id, event_id, item_id)
);

create index if not exists album_items_album_added_idx on public.album_items (album_id, added_at);

alter table public.albums enable row level security;
alter table public.album_items enable row level security;
