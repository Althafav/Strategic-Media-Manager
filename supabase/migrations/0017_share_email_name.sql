-- The share-link email gate also asks for the visitor's full name. The latest name entered for an email wins.

alter table public.share_emails add column if not exists name text;

drop function if exists public.record_share_email(text, text, int);

create or replace function public.record_share_email(tok text, mail text, full_name text default null, cap int default 2000)
returns boolean
language plpgsql
as $$
declare
  s public.shares%rowtype;
begin
  select * into s from public.shares where token = tok;
  if not found then return false; end if;

  update public.share_emails
  set last_seen_at = now(), visit_count = visit_count + 1, name = coalesce(full_name, name)
  where share_token = tok and email = mail;
  if found then return true; end if;

  if (select count(*) from public.share_emails where share_token = tok) >= cap then return false; end if;

  insert into public.share_emails (share_id, share_token, share_label, event_id, email, name)
  values (s.id, tok, coalesce(s.label, s.folder_name), s.event_id, mail, full_name)
  on conflict (share_token, email) do update
    set last_seen_at = now(), visit_count = public.share_emails.visit_count + 1,
        name = coalesce(excluded.name, public.share_emails.name);
  return true;
end;
$$;
