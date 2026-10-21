-- Last activity of each SSO team member, shown on /users. Set by proxy.ts (touchSeen in lib/users.ts)
-- at most every 5 minutes per user, so it's "last active", not live presence.
alter table public.app_users
  add column if not exists last_seen_at timestamptz;
