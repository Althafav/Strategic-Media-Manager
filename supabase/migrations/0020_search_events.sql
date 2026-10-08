-- Search filter by several events: search_nodes takes `evs uuid[]` (null = every visible event).
-- Hidden events still need their id in `visible`; `evs` only narrows the results further.

drop function if exists public.search_nodes(text, int, uuid, uuid[]);
create or replace function public.search_nodes(q text, lim int default 200, ev uuid default null, visible uuid[] default null, evs uuid[] default null)
returns setof public.nodes language sql stable as $$
  select n.* from public.nodes n
  join public.events e on e.id = n.event_id and (not e.hidden or e.id = any(visible))
  where (ev is null or n.event_id = ev)
    and (evs is null or n.event_id = any(evs))
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
