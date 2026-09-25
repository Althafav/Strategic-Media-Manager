-- Private view links: an unguessable token that gives external people
-- view + download access to one folder (and its subfolders), without logging in.

create table if not exists public.shares (
  id            uuid primary key default gen_random_uuid(),
  token         text not null unique,
  event_id      uuid not null references public.events (id) on delete cascade,
  folder_id     text not null,           -- OneDrive item id of the shared folder
  folder_path   text[] not null default '{}', -- path inside the event when shared (for display and "open in app")
  folder_name   text not null,
  label         text,                    -- who/what the link is for
  expires_at    timestamptz,             -- null = never
  created_at    timestamptz not null default now(),
  last_viewed_at timestamptz,
  view_count    int not null default 0
);

create index if not exists shares_event_folder_idx on public.shares (event_id, folder_id);

alter table public.shares enable row level security;

-- Counts a page view without a read-modify-write race.
create or replace function public.touch_share(tok text)
returns void
language sql
as $$
  update public.shares set view_count = view_count + 1, last_viewed_at = now() where token = tok;
$$;
