-- Who created each share link: 'admin' (password login) or the SSO user's email.
-- Null = created before this was tracked. Team members see only their own links; the admin sees all.

alter table public.shares add column if not exists created_by text;

create index if not exists shares_created_by_idx on public.shares (created_by);
