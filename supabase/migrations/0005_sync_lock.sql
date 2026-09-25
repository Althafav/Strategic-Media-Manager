-- Lease so the cron job, the CLI and "Sync now" never advance the same event's delta cursor at once.
-- A sync sets locked_until a little past its time budget and clears it when done, so a crashed run frees itself.

alter table public.event_sync add column if not exists locked_until timestamptz;
