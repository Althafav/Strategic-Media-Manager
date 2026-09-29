-- Access requests: an unknown Microsoft account that tries to sign in is stored as 'pending'
-- until an admin approves it on /users. Existing rows stay 'active'.
alter table public.app_users
  add column if not exists status text not null default 'active' check (status in ('active', 'pending')),
  add column if not exists requested_at timestamptz;
