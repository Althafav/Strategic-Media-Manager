import { db } from "@/lib/db";
import type { EventRow } from "@/lib/events";
import { timeAgo } from "@/lib/format";

/**
 * - `running`: a sync holds the lock right now
 * - `pending`: never synced
 * - `indexing`: the first full pass is part-way (cron or "Sync now" continues it)
 * - `error`: the last run failed
 * - `stale`: complete, but not refreshed for a while (cron not running?)
 * - `ok`: complete and recent
 */
export type SyncState = "running" | "pending" | "indexing" | "error" | "stale" | "ok";
export type SyncStatus = { state: SyncState; label: string; detail?: string };

type SyncRow = {
  event_id: string;
  next_link: string | null;
  delta_link: string | null;
  last_run_at: string | null;
  last_error: string | null;
  locked_until?: string | null; // added by migration 0005
};

const STALE_MS = 2 * 86_400_000;
const nf = new Intl.NumberFormat("en-GB");

/** One status per event id, for the event cards. */
export async function getSyncStatuses(events: EventRow[]): Promise<Map<string, SyncStatus>> {
  if (!events.length) return new Map();
  const ids = events.map((e) => e.id);
  const [{ data, error }, counts] = await Promise.all([
    db().from("event_sync").select("*").in("event_id", ids),
    Promise.all(
      ids.map(async (id) => {
        const { count } = await db().from("nodes").select("id", { count: "exact", head: true }).eq("event_id", id);
        return [id, count ?? 0] as const;
      }),
    ),
  ]);
  if (error) throw error;
  const rows = new Map((data as SyncRow[]).map((r) => [r.event_id, r]));
  const indexed = new Map(counts);
  const now = Date.now();
  return new Map(ids.map((id) => [id, describe(rows.get(id), indexed.get(id) ?? 0, now)]));
}

function describe(row: SyncRow | undefined, count: number, now: number): SyncStatus {
  const items = `${nf.format(count)} ${count === 1 ? "item" : "items"}`;
  if (row?.locked_until && Date.parse(row.locked_until) > now) {
    return { state: "running", label: count ? `Syncing now, ${items} indexed so far` : "Syncing now" };
  }
  if (!row?.last_run_at) return { state: "pending", label: "Not indexed for search yet" };
  const when = timeAgo(row.last_run_at, now);
  if (row.last_error) {
    return { state: "error", label: `Sync failed ${when}: ${describeSyncError(row.last_error)}`, detail: row.last_error };
  }
  if (row.next_link || !row.delta_link) {
    return { state: "indexing", label: `Indexing for search, ${items} so far (continues automatically)` };
  }
  if (now - Date.parse(row.last_run_at) > STALE_MS) {
    return { state: "stale", label: `Search index last updated ${when}. New files may be missing from search.` };
  }
  return { state: "ok", label: `${items} searchable, updated ${when}` };
}

/** Plain-language reason for a stored sync error. */
export function describeSyncError(message: string): string {
  if (/Share link returned (401|403|404)|FedAuth|shared folder path|Drive access token/.test(message)) {
    return "the OneDrive link may have expired or is no longer shared with “Anyone with the link”.";
  }
  if (/\b(429|503)\b/.test(message)) return "OneDrive is throttling requests. The next sync will retry.";
  if (/Drive API (401|403)/.test(message)) return "OneDrive refused access to the folder.";
  return "OneDrive returned an unexpected error.";
}
