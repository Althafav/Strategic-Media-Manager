-- Emails that share-link visitors enter before they can see the shared files (the email gate on /s/<token>).
-- One row per link + email; repeat visits bump last_seen_at and visit_count. Only the admin reads them.

create table if not exists public.share_emails (
  id            bigint generated always as identity primary key,
  share_id      uuid references public.shares (id) on delete set null, -- null once the link is deleted
  share_token   text not null,
  share_label   text,                     -- the link's label or folder name when the email was given
  event_id      uuid references public.events (id) on delete cascade,
  email         text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  visit_count   int not null default 1,
  unique (share_token, email)
);

create index if not exists share_emails_last_seen_idx on public.share_emails (last_seen_at desc);

alter table public.share_emails enable row level security;

-- Records one submission without a read-modify-write race. Returns false (and stores nothing) when the link
-- already has `cap` distinct emails and this one is new, so a script can't fill the table through one link.
create or replace function public.record_share_email(tok text, mail text, cap int default 2000)
returns boolean
language plpgsql
as $$
declare
  s public.shares%rowtype;
begin
  select * into s from public.shares where token = tok;
  if not found then return false; end if;

  update public.share_emails
  set last_seen_at = now(), visit_count = visit_count + 1
  where share_token = tok and email = mail;
  if found then return true; end if;

  if (select count(*) from public.share_emails where share_token = tok) >= cap then return false; end if;

  insert into public.share_emails (share_id, share_token, share_label, event_id, email)
  values (s.id, tok, coalesce(s.label, s.folder_name), s.event_id, mail)
  on conflict (share_token, email) do update
    set last_seen_at = now(), visit_count = public.share_emails.visit_count + 1;
  return true;
end;
$$;
