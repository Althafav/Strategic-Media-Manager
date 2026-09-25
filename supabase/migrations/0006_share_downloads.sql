-- Download counts for share links. One download = one click on Download (a single file or a zip);
-- downloaded_files adds up how many files those downloads contained. Team downloads are not counted.

alter table public.shares add column if not exists download_count int not null default 0;
alter table public.shares add column if not exists downloaded_files int not null default 0;
alter table public.shares add column if not exists last_downloaded_at timestamptz;

-- Counts a download without a read-modify-write race.
create or replace function public.record_share_download(tok text, files int default 1)
returns void
language sql
as $$
  update public.shares
  set download_count = download_count + 1,
      downloaded_files = downloaded_files + greatest(files, 0),
      last_downloaded_at = now()
  where token = tok;
$$;
