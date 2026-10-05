-- Folder covers picked by the admin (lightbox "Set as cover"). One photo per folder; it must be a direct child
-- of that folder. Folders without a row get the automatic cover (first image in name order, see getCoverUrl).

create table if not exists public.folder_covers (
  event_id  uuid not null references public.events (id) on delete cascade,
  folder_id text not null,
  item_id   text not null,
  set_by    text not null,
  set_at    timestamptz not null default now(),
  primary key (event_id, folder_id)
);

alter table public.folder_covers enable row level security;
