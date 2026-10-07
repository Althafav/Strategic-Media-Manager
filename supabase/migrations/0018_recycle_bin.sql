-- Recycle bin for the admin. Revoking a share link or deleting a photo request now only marks the row
-- (deleted_at/deleted_by); the admin restores or deletes it for good on /bin. Rows older than 30 days are purged by
-- the daily cron (/api/sync).

alter table public.shares add column if not exists deleted_at timestamptz;
alter table public.shares add column if not exists deleted_by text;
alter table public.photo_requests add column if not exists deleted_at timestamptz;
alter table public.photo_requests add column if not exists deleted_by text;

create index if not exists shares_deleted_at_idx on public.shares (deleted_at) where deleted_at is not null;
create index if not exists photo_requests_deleted_at_idx on public.photo_requests (deleted_at) where deleted_at is not null;

-- Binned requests don't count towards the "new reply" badge (0013 + deleted_at).
create or replace function public.unseen_request_answers(owner text)
returns bigint
language sql stable as $$
  select count(*)
  from public.photo_requests
  where requested_by = owner
    and status in ('fulfilled', 'declined')
    and resolved_at is not null
    and resolved_at > coalesce(requester_seen_at, 'epoch'::timestamptz)
    and deleted_at is null;
$$;

-- A binned link's counters don't move (0003 / 0006 + deleted_at).
create or replace function public.touch_share(tok text)
returns void
language sql
as $$
  update public.shares set view_count = view_count + 1, last_viewed_at = now() where token = tok and deleted_at is null;
$$;

create or replace function public.record_share_download(tok text, files int default 1)
returns void
language sql
as $$
  update public.shares
  set download_count = download_count + 1,
      downloaded_files = downloaded_files + greatest(files, 0),
      last_downloaded_at = now()
  where token = tok and deleted_at is null;
$$;
