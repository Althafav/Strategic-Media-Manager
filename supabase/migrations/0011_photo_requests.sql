-- Photo requests: a team member asks an event's marketing coordinator for photos.
-- Each event has at most one coordinator (one nullable column), assigned by the admin.
-- requested_by / resolved_by are "admin" or the SSO user's email (same as shares.created_by).

alter table public.events
  add column if not exists coordinator_email text references public.app_users (email) on delete set null;

create table if not exists public.photo_requests (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  requested_by     text not null,
  message          text not null check (char_length(message) between 1 and 2000),
  folder_path      text[] not null default '{}',
  status           text not null default 'pending' check (status in ('pending', 'in_progress', 'fulfilled', 'declined')),
  coordinator_note text check (coordinator_note is null or char_length(coordinator_note) <= 2000),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      text
);

create index if not exists photo_requests_event_status_idx on public.photo_requests (event_id, status);
create index if not exists photo_requests_requested_by_idx on public.photo_requests (requested_by);

alter table public.photo_requests enable row level security;
