-- Team members allowed to sign in with Microsoft SSO. Managed by the admin on /users.
-- The admin itself uses the email/password login (AUTH_EMAIL / AUTH_PASSWORD) and is not in this table.

create table if not exists public.app_users (
  email         text primary key check (email = lower(email)),
  name          text,
  added_at      timestamptz not null default now(),
  last_login_at timestamptz
);

alter table public.app_users enable row level security;

insert into public.app_users (email) values ('althaf.umer@strategic.ae') on conflict do nothing;
