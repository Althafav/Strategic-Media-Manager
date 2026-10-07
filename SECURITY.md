# Security overview

Strategic Media Manager is an internal app over event media stored in OneDrive for Business folders
shared as **"Anyone with the link."** OneDrive is the only file store; the app reads metadata and,
for originals, hands the browser pre-authenticated OneDrive URLs. This note records the access model
and the deliberate trade-offs. See the "Security model" and "Known gaps" sections of `CLAUDE.md` for
the authoritative per-layer rules.

## What is and isn't sent to the browser

- **The OneDrive event guest link (`events.share_url`) is never sent to the browser.** It is the
  "Anyone with the link" URL to a whole folder tree, so a leak would bypass every app control. It is
  used only server-side: the media API routes, the `/e` and `/s` **server** components,
  `lib/events.ts`, `lib/onedrive/session.ts`, `lib/sync/delta-sync.ts`. Pages pass only `event.slug`
  to client components. (The `shareUrl` built in `components/share-link-actions.tsx` is the app's own
  `/s/<token>` link, not the OneDrive link.)
- **Thumbnails and previews are app-mediated.** Every image loads through `/api/thumb` (and folder
  covers through `/api/cover`). These routes re-check the request on each load — a logged-in session,
  or a share link's `?t=&sig=` verified by `resolveItemAccess` — and then 302 to a fresh, short-lived
  OneDrive transform URL. No raw OneDrive URL is embedded in page HTML. `lib/format.ts` `withPreviews`
  builds these URLs; `lib/onedrive/client.ts` `toMediaItem` deliberately emits only a `hasThumb` flag.
- **Originals (download + zip) are served by direct OneDrive URL** — see the accepted residual below.

## Access control

- `src/proxy.ts` gates every request: pages redirect to `/login`, APIs return 401, unless the
  `smm_session` cookie verifies. Media APIs are let through without a session only when `?t=` is
  present, and the real check still runs in the route.
- Share links (`/s/<token>`): a random token row in `shares` (revocable, expiring). The share page
  signs each item it renders, `sig = HMAC(AUTH_SECRET, "share:<token>:<id>")`; media requests carry
  `?t=&sig=` and `lib/access.ts` `resolveItemAccess` verifies both. Sigs can't be forged, and a
  token only ever resolves items within its own event's drive.
- Email gate (`lib/share-emails.ts`, migration 0014): a share page shows only an email form, and
  loads nothing from OneDrive, until the visitor submits their full name and email. That sets the httpOnly cookie
  `smm_gate_<token>` = `HMAC(AUTH_SECRET, "gate:<token>")` (path `/`, 30 days). The page,
  `resolveItemAccess` and `/api/manifest` all require it (`canViewShare`), or a team session. So a
  copied `?t=&sig=` URL doesn't work in a browser that never passed the gate. Emails aren't verified,
  and each link stores at most 2,000 distinct emails. Only the admin can read them (`/share-emails`).
- Private events (migration 0019): an event marked private is visible only to the admin and the team members the
  admin picked (`events.viewer_emails`). Anyone else gets "not found" on the event page, from the media APIs and from
  the zip manifest, and the event is left out of the home page, search and most liked (`canSeeEvent` in `lib/events.ts`).
  Share links bypass this on purpose: existing links keep working, and only the admin can create new ones.
- Path traversal is blocked: `getFolder` rejects `.`, `..` and slashes, and resolves relative to the
  share's `folder_id`, so a visitor cannot climb above the shared folder.
- Fails closed: share lookups `.catch(() => null)`; revoked/expired shares resolve to `null` → 403.
- Revoked links stay in the admin's recycle bin (`/bin`) for 30 days (`deleted_at` set, denied like a missing link)
  and are deleted for good by the nightly cron. Restoring one makes the same URL work again until its original expiry.

## Accepted trade-offs

- **Download and zip URLs are direct OneDrive URLs.** `/api/download` re-checks `t`/`sig` and counts
  the download (per link and per file) on each click before it 302s to `@content.downloadUrl`; `/api/manifest` returns those
  URLs for client-side zipping (`client-zip` must fetch bytes straight from OneDrive via CORS).
  Because the bytes come from OneDrive, not the app, **a URL that has already been handed out keeps
  working until OneDrive's own expiry (~hours), even after the share is revoked.** Proxying these
  bytes through the app is not viable: originals and videos are large, Vercel functions have size/time
  limits (folder manifests already cap at 25k files / 300s), and it would break client-zip. This
  applies to originals only — thumbnails/previews are app-mediated (above) and revoke at once.
- **Share-cache revocation lag:** `getActiveShare` caches 15s per instance, so a revoke can take up
  to 15s to be seen across servers.
- **Event slug visibility:** the slug appears in share-page media URLs (`?e=<slug>`). It is not
  secret-grade and grants nothing on its own — access still requires a session or a valid `t`+`sig`.
- Broader known gaps (the unsigned SSO `?email=`, the 500ms login delay, the unofficial guest-link
  API) are tracked in `CLAUDE.md` → "Known gaps / next steps."
