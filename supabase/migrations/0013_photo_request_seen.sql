-- Tells requesters when their photo request has been answered.
-- requester_seen_at: when the requester last opened the Sent tab. An answer newer than that is "unseen"
-- and counts in the Requests badge.

alter table public.photo_requests add column if not exists requester_seen_at timestamptz;

create index if not exists photo_requests_requested_by_status_idx on public.photo_requests (requested_by, status);

-- PostgREST can't compare two columns, so the unseen count is a function.
create or replace function public.unseen_request_answers(owner text)
returns bigint
language sql stable as $$
  select count(*)
  from public.photo_requests
  where requested_by = owner
    and status in ('fulfilled', 'declined')
    and resolved_at is not null
    and resolved_at > coalesce(requester_seen_at, 'epoch'::timestamptz);
$$;
