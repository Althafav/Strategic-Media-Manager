-- Private events: events.hidden = true means only the admin and the emails in viewer_emails see the event.
-- viewer_emails holds lowercase app_users emails. Share links for a private event keep working.

alter table public.events add column if not exists viewer_emails text[] not null default '{}';

-- search_nodes / top_liked skip hidden events unless their id is passed in `visible`
-- (the app passes the private events the current viewer may see).
drop function if exists public.search_nodes(text, int, uuid);
create or replace function public.search_nodes(q text, lim int default 200, ev uuid default null, visible uuid[] default null)
returns setof public.nodes language sql stable as $$
  select n.* from public.nodes n
  join public.events e on e.id = n.event_id and (not e.hidden or e.id = any(visible))
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

drop function if exists public.top_liked(uuid, int);
create or replace function public.top_liked(ev uuid default null, lim int default 100, visible uuid[] default null)
returns table (event_id uuid, item_id text, likes bigint)
language sql stable as $$
  select l.event_id, l.item_id, count(*) as likes
  from public.photo_likes l
  join public.events e on e.id = l.event_id and (not e.hidden or e.id = any(visible))
  where ev is null or l.event_id = ev
  group by l.event_id, l.item_id
  order by likes desc, max(l.liked_at) desc
  limit lim;
$$;
