-- Photo requests for hand-picked photos: the selection bar's "Request" stores the picked items here,
-- as [{ "id": <OneDrive item id>, "name": <file name>, "kind": "file" | "folder" }]. Null for message-only requests.

alter table public.photo_requests
  add column if not exists items jsonb
  check (items is null or (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 200));
