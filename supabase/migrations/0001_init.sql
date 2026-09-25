-- Metadata index of the OneDrive share. Files themselves stay in OneDrive.
create extension if not exists pg_trgm;

create table if not exists public.nodes (
  id          text primary key,            -- OneDrive item id
  parent_id   text,
  name        text not null,
  kind        text not null check (kind in ('folder', 'file')),
  size        bigint not null default 0,
  child_count int,
  mime        text,
  is_image    boolean not null default false,
  is_video    boolean not null default false,
  width       int,
  height      int,
  taken_at    timestamptz,
  camera      text,
  modified_at timestamptz,
  path        text,                        -- parent folders relative to share root, '/'-joined
  synced_at   timestamptz not null default now()
);

create index if not exists nodes_parent_idx on public.nodes (parent_id);
create index if not exists nodes_name_trgm on public.nodes using gin (lower(name) gin_trgm_ops);
create index if not exists nodes_path_trgm on public.nodes using gin (lower(path) gin_trgm_ops);

create table if not exists public.sync_state (
  id          int primary key default 1 check (id = 1),
  next_link   text,                        -- mid-sync resume point
  delta_link  text,                        -- completed-sync change cursor
  last_run_at timestamptz,
  last_error  text
);
insert into public.sync_state (id) values (1) on conflict do nothing;

-- Only the server (service role) touches these tables for now.
alter table public.nodes enable row level security;
alter table public.sync_state enable row level security;

-- Recomputes relative folder paths for every node from the parent chain.
create or replace function public.refresh_paths(root_id text)
returns void language sql as $$
  with recursive tree as (
    select id, ''::text as child_path
    from public.nodes where id = root_id
    union all
    select n.id,
           case when t.child_path = '' then n.name else t.child_path || '/' || n.name end
    from public.nodes n join tree t on n.parent_id = t.id
  ), parents as (
    select n.id, coalesce(t.child_path, '') as path
    from public.nodes n left join tree t on t.id = n.parent_id
  )
  update public.nodes n set path = p.path
  from parents p where p.id = n.id and n.path is distinct from p.path;
$$;

create or replace function public.search_nodes(q text, lim int default 200)
returns setof public.nodes language sql stable as $$
  select * from public.nodes
  where lower(name) like '%' || lower(q) || '%'
     or lower(path) like '%' || lower(q) || '%'
  order by
    (kind = 'folder') desc,
    (lower(name) like '%' || lower(q) || '%') desc,
    similarity(lower(name), lower(q)) desc,
    name
  limit lim;
$$;
