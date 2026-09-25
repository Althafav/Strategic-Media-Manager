@AGENTS.md

# Strategic Media Manager

Internal web app for browsing, searching, previewing and downloading event media (photos/videos) that lives in
OneDrive for Business folders shared as **"Anyone with the link"**. OneDrive is the only file storage: the app
reads metadata and hands the browser pre-authenticated OneDrive URLs. It never stores or proxies file bytes.

Stack: Next.js 16 (App Router, Turbopack, `src/proxy.ts`), React 19, Tailwind v4, Supabase (Postgres via the
service-role key only), `client-zip`, lucide icons. No test suite yet.

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

## Layout

```
src/proxy.ts                    auth gate for every request (login cookie, share-link bypass, view counting)
src/lib/onedrive/session.ts     guest-link -> drive access token (the ONLY place that knows the unofficial chain)
src/lib/onedrive/client.ts      drive API calls: getFolder, getCoverUrl, getThumbUrl, getDownloadUrl, buildManifest
src/lib/events.ts               events table (create validates the link by opening it), 30s in-process cache
src/lib/auth.ts                 shared team login: credentials from env, HMAC-signed session cookie
src/lib/admin.ts                ADMIN_KEY check for add/remove event
src/lib/shares.ts               private share links (server-only: db + node:crypto)
src/lib/share-types.ts          client-safe share types/helpers (EXPIRY_OPTIONS, isExpired, formatDate)
src/lib/access.ts               decides which event a media API request may read (session or signed share item)
src/lib/format.ts               URL builders: browseHref, shareHref, downloadHref, coverSrc, thumbSrc (carry t/sig)
src/lib/zip-download.ts         browser-side zip: /api/manifest -> fetch OneDrive URLs -> client-zip -> disk
src/lib/sync/delta-sync.ts      OneDrive delta feed -> Supabase `nodes` (resumable cursor + `locked_until` lease in `event_sync`)
src/lib/sync/status.ts          per-event index status for the event cards (server-only), plain-language sync errors
src/app/e/[slug]/[[...path]]    event folder browser (team)
src/app/s/[token]/[[...path]]   shared folder / picked-items view (external, no login)
src/app/shares                  list/revoke all share links + server actions
src/app/events                  add/remove event server actions, /events/new form
src/app/login                   login page + login/logout actions
src/app/search                  index search (Supabase `search_nodes` RPC)
src/app/api/{download,thumb,cover}/[id], api/manifest   media APIs (302s to OneDrive / JSON)
src/app/api/sync                Vercel Cron entry (Bearer CRON_SECRET)
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

1. **Team login**: `proxy.ts` redirects pages to `/login?next=` and returns 401 on `/api/*` unless the
   `smm_session` cookie verifies. Credentials come from `AUTH_EMAIL`/`AUTH_PASSWORD`. The HMAC key is
   `AUTH_SECRET:AUTH_PASSWORD`, so changing the password logs everyone out.
2. **Server actions must check the session themselves** (`requireSession()`). Next docs warn that proxy coverage
   can silently disappear. Add/remove event also requires `ADMIN_KEY` (user decision).
3. **Share links** (`/s/<token>`): a random 24-char token row in `shares` (expiry, revocable, `view_count`).
   - Two kinds: a whole folder (`item_ids` null), or hand-picked items from the selection bar (`item_ids`, up to
     500). Picked items are loaded with `getItems` (folder listing first, then per-id). On item links only
     picked folders can be opened: the first path segment must name one.
   - The share page signs every item it renders: `sig = HMAC(AUTH_SECRET, "share:<token>:<id>")`.
   - Media APIs accept `?t=&sig=` without login, and `resolveItemAccess` verifies both.
   - The manifest expands only signed items and signs its output entries.
   - Any new UI that passes item refs around must keep `t`/`sig` (use the `Ref` type from `format.ts`).
   - `proxy.ts` lets `/s/*` through, and lets media APIs through only when `t` is present.
   - Views are counted once per browser session via a session cookie scoped to `/s/<token>`.
   - `getActiveShare` caches for 15s per instance, so revocation may lag up to 15s across servers.
   - Share lookups must fail closed (`.catch(() => null)`).
4. `next` redirect targets must be same-site relative paths (`safeNext` in `login/actions.ts`).

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
- Dates rendered on both server and client use a fixed locale (`en-GB`) to avoid hydration mismatches.
- `AGENTS.md` is regenerated by `next dev`. Leave it and the `@AGENTS.md` import in place.

## Environment (`.env.local`, never print values)

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_KEY`, `AUTH_EMAIL`, `AUTH_PASSWORD`, `AUTH_SECRET`,
`CRON_SECRET`. Restart the dev server after changing them.

## Database

Migrations `0001_init` → `0002_events` → `0003_shares` → `0004_share_items` → `0005_sync_lock` are applied by hand in Supabase. There is no CLI or DB URL
here; DDL can't be run from the app. Tables:
- `events`
- `event_sync` (delta cursor)
- `nodes` (search index, PK `(event_id, id)`, `path` filled by `refresh_paths`)
- `shares`

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
- Login has only a 500ms delay against guessing. The shared password must be strong in production.
- Very large "Download folder" manifests are built in one request (limit 25k files, 300s).
- `search_nodes` doesn't escape `%`/`_` in the query.
- Nothing is committed to git yet beyond the create-next-app initial commit.
