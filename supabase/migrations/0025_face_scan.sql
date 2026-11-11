-- Face scanning per event: only events with face_scan on are scanned in the admin's browser, and only they offer
-- team "Find my photos" and People. Turning it off keeps the face data already saved.
alter table events add column if not exists face_scan boolean not null default false;

-- Events whose guests can already search keep being scanned.
update events set face_scan = true where face_search;
