# Strategic Media Manager

Browse, search, preview and download event media stored in a OneDrive "Anyone with the link" share. OneDrive is the only file storage. This app reads metadata and never copies files.

## How it works

| Concern | Approach |
| --- | --- |
| Events | Each event is a row in Supabase `events` with its own share link. Add at `/events/new`, remove with the trash icon on the event card (both need `ADMIN_KEY`) |
| Share links | **Share** on any folder creates a private link (`/s/<token>`) for people outside the team: view + download that folder and its subfolders only, no login. Pick an expiry (7/30/90 days or never); manage and revoke at `/shares`. To share only some photos, select them and click **Share** in the selection bar (works in folders and search results; one photo opens as a large view). Needs migrations `0003_shares.sql` and `0004_share_items.sql`. `/shares` shows views and downloads per link (a file or a zip counts as one download, with the total files); download counts need `0006_share_downloads.sql` |
| Access | `src/lib/onedrive/session.ts`: share link → guest cookie → `RenderListDataAsStream` → `driveAccessToken` (~5h, auto-refreshed) → OneDrive v2.0 drive API |
| Browse | Live folder listings (`getFolder`), cached in memory for 5 min |
| Thumbnails / previews | Pre-signed OneDrive transform URLs, loaded directly by the browser. The lightbox shows 1920px previews and swaps in 3840px ones when zoomed; it also has swipe, slideshow (Space), details (I), full screen (F) and **Share** for the open photo |
| Single download | `/api/download/[id]` issues a 302 to a pre-authenticated OneDrive URL, so bytes never touch our server |
| Folder / selection download | `/api/manifest` returns direct URLs; the browser streams them into a zip (`client-zip`) and writes it to disk via the File System Access API |
| Search | Supabase index filled by the OneDrive **delta** feed (`src/lib/sync/delta-sync.ts`), resumable and incremental. Each event card shows index status (items indexed, last update, or why the last sync failed); the refresh icon runs **Sync now**. Migration `0005_sync_lock.sql` stops cron, CLI and Sync now from running the same event at once |

> The guest-link API is not an official Microsoft API. If AIM IT later grants an Entra app, swap `session.ts` for Graph app-only auth; nothing else needs to change.

## Setup

1. Create a Supabase project and run the SQL files in `supabase/migrations/` in order, in the SQL editor.
2. Create `.env.local`:

   ```bash
   SUPABASE_URL=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ADMIN_KEY=...      # required to add or remove events
   AUTH_EMAIL=admin@strategic.ae   # shared team login
   AUTH_PASSWORD=...  # changing it logs everyone out
   AUTH_SECRET=...    # random 32+ chars, signs the session cookie
   CRON_SECRET=...    # protects /api/sync
   ```

3. `npm install && npm run dev`, then use **Add event** and paste a OneDrive folder link shared with "Anyone with the link".

A new event is indexed for search in the background right after it is added. `npm run sync` syncs every event from the CLI: the first pass takes about 3 min per 23k items, and later runs fetch only changes.

In production, Vercel Cron calls `/api/sync` once a day at 22:00 UTC (02:00 Dubai), which works on every Vercel plan. It keeps search up to date with files added in OneDrive later, and finishes large first syncs. Browsing doesn't depend on it: folders are read live. For fresher search in between, use **Sync now** on the event card. On the Pro plan you can sync more often, e.g. `"*/30 * * * *"`. The cron needs `CRON_SECRET` set in the Vercel project; Vercel sends it automatically.

Removing an event deletes it and its search index from the app only. Files in OneDrive are never modified.
