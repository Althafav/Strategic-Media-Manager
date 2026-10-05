@AGENTS.md

# Strategic Media Manager

Internal web app for browsing, searching, previewing and downloading event media (photos/videos) that lives in
OneDrive for Business folders shared as **"Anyone with the link"**. OneDrive is the only file storage: the app
reads metadata and hands the browser pre-authenticated OneDrive URLs for **originals** (download/zip). It never
stores or proxies file bytes. **Thumbnails/previews go through `/api/thumb`** (not embedded raw), so raw OneDrive
URLs stay out of page HTML and every image load re-checks the share token — see `SECURITY.md`.

Stack: Next.js 16 (App Router, Turbopack, `src/proxy.ts`), React 19, Tailwind v4, Supabase (Postgres via the
service-role key only), `client-zip`, lucide icons, Vercel Analytics + Speed Insights (in `layout.tsx`). Hosted on
Vercel. No test suite yet. `SECURITY.md` is the human-readable security overview; keep it in step with the model below.

## Commands

```bash
npm run dev         # dev server (the preview config in ../.claude/launch.json uses autoPort; 3000 is often taken)
npm run typecheck   # tsc --noEmit (run `npx next typegen` first if PageProps/RouteContext types are missing)
npm run lint        # eslint
npm run sync        # index every event into Supabase from the CLI (resumable delta sync)
npm run build
```

Verify changes with `typecheck` + `lint`, then in the browser preview. For quick one-off checks, write a
throwaway `scripts/tmp-*.ts`, run it with `npx tsx --env-file=.env.local scripts/tmp-x.ts < /dev/null`, and delete it.
The package is CommonJS, so wrap top-level `await` in `async function main()`.

Load test (against `next build && next start`, not `next dev`; mints its own cookies, prints no secrets):
`npx tsx --env-file=.env.local scripts/loadtest.ts [baseUrl] [users] [seconds] < /dev/null`.

## Layout

```
src/proxy.ts                    auth gate for every request (login cookie + active SSO user, share-link bypass, view counting)
src/lib/onedrive/session.ts     guest-link -> drive access token (the ONLY place that knows the unofficial chain)
src/lib/onedrive/client.ts      drive API calls: getFolder, getCoverUrl, getThumbUrl, getDownloadUrl, buildManifest
src/lib/events.ts               events table (create validates the link by opening it), 30s in-process cache
src/lib/auth.ts                 HMAC-signed session cookie with a role: admin (password login) or user (SSO); requireAdmin/requireSession
src/lib/users.ts                app_users allowlist for Microsoft SSO (admin-managed), 30s in-process cache
src/lib/sso.ts                  AIM Congress SSO broker URL + state cookie (the returned ?email= is unsigned, see file comment)
src/lib/shares.ts               private share links (server-only: db + node:crypto)
src/lib/share-types.ts          client-safe share types/helpers (EXPIRY_OPTIONS, isExpired, formatDate)
src/lib/share-emails.ts         share-link email gate: signed per-link cookie, canViewShare, share_emails queries (server-only)
src/lib/access.ts               decides which event a media API request may read (session or signed share item)
src/lib/format.ts               URL builders: browseHref, shareHref, downloadHref, coverSrc, thumbSrc (carry t/sig)
src/lib/zip-download.ts         browser-side zip: /api/manifest -> fetch OneDrive URLs -> (optional compress) -> client-zip -> disk
src/lib/image-compress.ts       browser-side resize/re-encode (createImageBitmap + canvas; JPG/WebP/PNG); UI in components/compress-dialog.tsx
src/lib/selection-store.ts      cross-folder selection kept in sessionStorage (`smm:selection`), subscribe/getSelection store
src/lib/nodes.ts                `nodes` index row type + NodeRow -> MediaItem for the search/top pages
src/lib/email.ts                best-effort sendEmail via the AIM Congress generic email API (never throws; server-only)
src/lib/sync/delta-sync.ts      OneDrive delta feed -> Supabase `nodes` (resumable cursor + `locked_until` lease in `event_sync`)
src/lib/sync/status.ts          per-event index status for the event cards (server-only), plain-language sync errors
src/app/e/[slug]/[[...path]]    event folder browser (team)
src/app/s/[token]/[[...path]]   shared folder / picked-items view (external, no login; email gate first: s/[token]/email-gate.tsx + actions.ts)
src/app/share-emails            admin-only: emails entered at share links, filter ?share=<token>, CSV export (export/route.ts)
src/app/shares                  list/revoke share links (own links; admin sees all + creator) + server actions
src/app/events                  add/remove event server actions, /events/new form
src/app/login                   login page (Microsoft button + admin password form) + login/logout actions
src/app/api/auth/sso, sso-login Microsoft SSO start (sets state cookie) and broker callback (creates user session)
src/app/users                   admin-only: add/remove SSO users, approve/reject pending access requests
src/app/requests                photo requests: Inbox tab (event's coordinator; admin sees all) / Sent tab (own requests), /requests/[id] shows the picked photos in the Gallery
src/lib/requests.ts             photo_requests queries + canHandle (server-only); client-safe types/labels in request-types.ts
src/app/settings                admin-only: rename events, set each event's marketing coordinator
src/app/search                  index search (Supabase `search_nodes` RPC)
src/app/top                     most liked photos (`top_liked` RPC, event filter `?e=`); likes live in `photo_likes` via `lib/likes.ts` + `app/likes/actions.ts`
src/app/api/{download,thumb,cover}/[id], api/manifest   media APIs (302s to OneDrive / JSON)
src/app/api/sync                Vercel Cron entry (Bearer CRON_SECRET), daily 22:00 UTC via vercel.json, maxDuration 300
supabase/migrations/            SQL, run MANUALLY by the user in the Supabase SQL editor, in order
```

## OneDrive guest API: hard-won rules (don't "simplify" these)

- Access chain (session.ts): GET the share link with manual redirects to collect the `FedAuth` cookie and the folder
  path (`onedrive.aspx?id=`), then POST `/_api/contextinfo` to get a form digest, then POST
  `RenderListDataAsStream` and read `ListSchema[".driveAccessToken"]`. That is a bearer token for
  `/_api/v2.0/drives/{id}`, valid about 5h. `drive()` invalidates the token and retries once on 401/403, and backs
  off on 429/503.
- **Path-addressed `/children` is rejected.** Resolve the item by path first (`/items/{base}:/a/b:`), then list
  `/items/{id}/children`.
- **`@odata.nextLink` / `deltaLink` point at a `/personal/...` host path where the token is rejected.** Keep only
  their query string and rebuild the URL on our own base (see `listAll` and `delta-sync.ts`).
- `search` is denied for guests, so search goes through the Supabase index. Delta works.
- Thumbnail URLs are pre-signed transform URLs. Resize them by setting `width`/`height` (`sizedThumb`).
- `@content.downloadUrl` is pre-authenticated, CORS `*` and range-capable, so the browser downloads and zips
  directly.
- Item ids must pass `isValidId`. Path segments `.`/`..`/containing slashes are rejected in `getFolder`.
- The delta feed repeats items: row count > unique ids is normal.

## Security model (keep all layers)

1. **Login**: `proxy.ts` redirects pages to `/login?next=` and returns 401 on `/api/*` unless the
   `smm_session` cookie verifies (`verifyActiveSession`). The HMAC key is `AUTH_SECRET:AUTH_PASSWORD`, so changing
   the password logs everyone out. Two roles:
   - **admin**: the email/password form (`AUTH_EMAIL`/`AUTH_PASSWORD`). Only the admin manages users (`/users`),
     adds/removes events, and sees photo details (lightbox Details panel and meta line, `showDetails`).
   - **user**: Microsoft SSO via the AIM Congress broker. Allowed only if the email is in `app_users`; checked
     at login and on every request (`getSession` and the proxy), so removal signs them out within the 30s cache.
     The broker's `?email=` is unsigned (accepted trade-off); the `smm_sso` state cookie from `/api/auth/sso` must
     be present on the callback. The broker's firewall rejects localhost redirects: test on a deployed URL.
   - Old tokens without `role`: an email means user, no email means admin.
2. **Server actions must check the session themselves** (`requireSession()`, or `requireAdmin()` for events and
   users). Next docs warn that proxy coverage can silently disappear.
3. **Share links** (`/s/<token>`): a random 24-char token row in `shares` (expiry, revocable, `view_count`).
   - Two kinds: a whole folder (`item_ids` null), or hand-picked items from the selection bar (`item_ids`, up to
     500). Picked items are loaded with `getItems` (folder listing first, then per-id). On item links only
     picked folders can be opened: the first path segment must name one.
   - The share page signs every item it renders: `sig = HMAC(AUTH_SECRET, "share:<token>:<id>")`.
   - Media APIs accept `?t=&sig=` without login, and `resolveItemAccess` verifies both.
   - The manifest expands only signed items and signs its output entries.
   - Any new UI that passes item refs around must keep `t`/`sig` (use the `Ref` type from `format.ts`).
   - Thumbnails/previews are built by `withPreviews` (`format.ts`) as `/api/thumb` URLs carrying
     `t`/`sig`; `toMediaItem` emits only `hasThumb`. Never embed a raw OneDrive thumbnail URL in a page.
   - `proxy.ts` lets `/s/*` through, and lets media APIs through only when `t` is present.
   - **Email gate** (migration 0014, `lib/share-emails.ts`): a visitor must enter an email before the share
     page loads anything from OneDrive. `submitShareEmail` stores it in `share_emails` and sets the signed cookie
     `smm_gate_<token>` (path `/`, 30 days). The page, `resolveItemAccess` and `/api/manifest` require it via
     `canViewShare` (team sessions skip the gate, and nothing is recorded for them). Emails aren't verified,
     and each link stores at most 2,000 distinct ones. Only the admin sees them (`/share-emails`). Views are
     still counted on first open, before the gate.
   - Views are counted once per browser session via a session cookie scoped to `/s/<token>`.
   - Downloads are counted per click (`recordDownload`, migration 0006): `/api/download` redirects with `t`, and
     `/api/manifest` with `t` (one zip, plus its file count). Not counted: `?json=1` URL refreshes, and `?stream=1`
     (`streamHref`, the lightbox video player). Keep new playback uses on `streamHref`.
   - `getActiveShare` caches for 15s per instance, so revocation may lag up to 15s across servers.
   - Share lookups must fail closed (`.catch(() => null)`).
   - Ownership (migration 0008): `created_by` is `"admin"` or the SSO user's email (`shareOwner`). Team members
     list and revoke only their own links (`ownerFilter`); the admin sees and revokes all, with "Added by".
     Null = made before tracking.
4. `next` redirect targets must be same-site relative paths (`safeNext` in `lib/auth.ts`).

## Conventions

- Server-only modules (`db`, `node:crypto`, `shares.ts`, `auth.ts`) must never be imported by `"use client"`
  files. Put client-safe helpers in separate modules (`share-types.ts`, `format.ts`).
- Server components cannot call functions exported from `"use client"` files. Keep formatting helpers in
  shared modules.
- Every OneDrive call takes the event's `share_url` first. Events are addressed by `slug` in URLs and API
  `?e=` params.
- Pages that hit OneDrive are `force-dynamic`. Folder listings are memoised 5 min in memory (`memo`, keyed by
  share + base id + path).
- Visual design ("light table", see `globals.css`):
  - A neutral viewing-grey background (`bg-background`), white panels (`bg-surface`) and ink text. Keep
    neutral greys so photo colour reads true.
  - Primary actions use ink (`bg-accent` = ink).
  - Brand gold (`pencil`, #C99E2F) is reserved for selection: the grease-pencil `PencilMark` loop, the check,
    and the selection bar. Don't spread gold elsewhere.
  - Type is Archivo only. Use the `display` utility (condensed 70% width, bold) for titles; body text is normal
    width. No all-caps labels, no middle-dot meta strings.
  - Photos have square corners and 2px contact-sheet gutters. Corners are `rounded-md` for controls and
    `rounded-lg` for dialogs and panels.
  - Dialogs use native `<dialog>` + `showModal()`, and forms use `useActionState`. Match existing components.
- Image compression and zipping happen in the browser only; the server never touches file bytes. Compress is
  offered for images only (`isImagePath`).
- Slow side work after a response (initial/background sync, download counting, `touchLogin`) uses `after()` from
  `next/server` and must swallow its own errors.
- `/api/thumb` and `/api/cover` 302 with `private, max-age=900` (pre-signed URLs expire, so keep it short);
  download/manifest responses are `no-store`.
- Outgoing mail (`sendEmail`): a new photo request emails the event's coordinator. The API's firewall 403s Node's
  default User-Agent and rejects bodies containing localhost URLs, so dev mails go out without the link.
  Escape all user text with `escapeHtml`.
- Dates rendered on both server and client use a fixed locale (`en-GB`) to avoid hydration mismatches.
- `AGENTS.md` is regenerated by `next dev`. Leave it and the `@AGENTS.md` import in place.

## Environment (`.env.local`, never print values)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_EMAIL`, `AUTH_PASSWORD`, `AUTH_SECRET`, `CRON_SECRET`,
`SSO_LOGIN_URL` (optional, defaults to the broker), `APP_URL` (optional, defaults to the request host). Restart the dev server after changing them.

## Database

Migrations `0001_init` → `0002_events` → `0003_shares` → `0004_share_items` → `0005_sync_lock` → `0006_share_downloads` → `0007_app_users` → `0008_share_owner` → `0009_user_access_requests` → `0010_photo_likes` → `0011_photo_requests` → `0012_photo_request_items` → `0013_photo_request_seen` → `0014_share_emails` are applied by hand in Supabase. There is no CLI or DB URL
here; DDL can't be run from the app. Tables:
- `events`
- `event_sync` (delta cursor)
- `nodes` (search index, PK `(event_id, id)`, `path` filled by `refresh_paths`)
- `shares`
- `app_users` (SSO allowlist; `status` active/pending: unknown Microsoft sign-ins are stored as pending until an admin approves)
- `photo_likes` (one row per team member per liked item; owner = `shareOwner`; team only, never on share pages)
- `share_emails` (one row per link + email entered at the gate; `record_share_email` RPC upserts and enforces the cap; `share_id` set null when the link is deleted)
- `photo_requests` (a team member asks the event's coordinator for photos; `requested_by`/`resolved_by` = `shareOwner`).
  `events.coordinator_email` is the marketing coordinator: at most one per event, set only by the admin
  (`setEventCoordinator`, must be an active app_user) on /settings or the Add event form. /settings also renames
  events (`renameEventAction`; title only, the slug and links stay). Only the admin or that coordinator may answer (`canHandle`).
  `items` (0012) holds photos picked in the selection bar ("Request", event pages only): `[{id,name,kind,path}]`, up to 200;
  `path` is each item's own folder (a selection can span folders) and `folder_path` their common parent. Older rows
  lack `path`: fall back to `folder_path`. Requesting items already in one of your open requests is refused.
  `requester_seen_at` (0013) drives the "new reply" badge: `unseen_request_answers(owner)` RPC; opening Sent marks seen.

Deleting an event cascades to nodes, sync state and shares. RLS is on with no policies: only the service role
reads or writes.

## Environment quirks (Windows dev box)

- Shell commands that wait on stdin hang. Use `< /dev/null` with `tsx`/`python`, and never run bare `cat >` without
  a heredoc.
- ESM dynamic imports of absolute paths need `file://` URLs.

## Known gaps / next steps

- The guest-link API is unofficial and can break or be throttled. The long-term fix is Graph app-only auth
  (swap `session.ts`).
- The sync lock needs migration `0005_sync_lock`; until it runs, `runDeltaSync` proceeds unlocked. A busy event
  throws `SyncBusyError` (the CLI stops on it; cron reports it and moves on).
- `/api/sync` handles events sequentially, so a huge first sync can starve later events within one run.
- The event list cache (30s) and share cache (15s) are per instance.
- Login has only a 500ms delay against guessing. The admin password must be strong in production.
- SSO trusts the broker's unsigned `?email=`: someone who knows an allowed email could forge a login. Ask the
  broker for a signed token to close this.
- Very large "Download folder" manifests are built in one request (limit 25k files, 300s).
- `search_nodes` doesn't escape `%`/`_` in the query.
- The git repo root is `media-manager/` (the parent folder holds only `.claude/` + `.impeccable/` tooling).
- An `impeccable` design critique (`../.impeccable/critique/`) scored 25/40; open items include no `aria-live`
  for zip progress and no size shown before "Download folder".
