-- Share links for hand-picked photos/files (not a whole folder).
-- item_ids null = the link shares the folder in folder_id; otherwise it shares exactly these items
-- (a selected folder among them is shared with its subfolders).

alter table public.shares add column if not exists item_ids text[];

-- Items picked from search results can come from several folders, so there may be no single folder.
alter table public.shares alter column folder_id drop not null;
