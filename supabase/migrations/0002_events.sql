-- Multiple events, each backed by its own OneDrive share link.
-- The index is a rebuildable cache, so existing rows are cleared and resynced.

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  share_url   text not null unique,
  root_id     text,
  root_name   text,
  item_count  int,
  size        bigint,
  sort        int not null default 0,
  hidden      boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.event_sync (
  event_id    uuid primary key references public.events (id) on delete cascade,
  next_link   text,
  delta_link  text,
  last_run_at timestamptz,
  last_error  text
);

alter table public.events enable row level security;
alter table public.event_sync enable row level security;

truncate public.nodes;
drop table if exists public.sync_state;

alter table public.nodes add column if not exists event_id uuid not null references public.events (id) on delete cascade;
alter table public.nodes drop constraint if exists nodes_pkey;
alter table public.nodes add primary key (event_id, id);
create index if not exists nodes_event_parent_idx on public.nodes (event_id, parent_id);
drop index if exists public.nodes_parent_idx;

create or replace function public.refresh_paths(ev uuid, root_id text)
returns void language sql as $$
  with recursive tree as (
    select id, ''::text as child_path
    from public.nodes where event_id = ev and id = root_id
    union all
    select n.id,
           case when t.child_path = '' then n.name else t.child_path || '/' || n.name end
    from public.nodes n join tree t on n.parent_id = t.id
    where n.event_id = ev
  ), parents as (
    select n.id, coalesce(t.child_path, '') as path
    from public.nodes n left join tree t on t.id = n.parent_id
    where n.event_id = ev
  )
  update public.nodes n set path = p.path
  from parents p where n.event_id = ev and p.id = n.id and n.path is distinct from p.path;
$$;
drop function if exists public.refresh_paths(text);

drop function if exists public.search_nodes(text, int);
create or replace function public.search_nodes(q text, lim int default 200, ev uuid default null)
returns setof public.nodes language sql stable as $$
  select n.* from public.nodes n
  join public.events e on e.id = n.event_id and not e.hidden
  where (ev is null or n.event_id = ev)
    and n.parent_id is not null                      -- skip each share's root folder
    and (lower(n.name) like '%' || lower(q) || '%'
      or lower(n.path) like '%' || lower(q) || '%')
  order by
    (n.kind = 'folder') desc,
    (lower(n.name) like '%' || lower(q) || '%') desc,
    similarity(lower(n.name), lower(q)) desc,
    n.name
  limit lim;
$$;
