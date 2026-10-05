import { db } from "@/lib/db";

/**
 * Per-file download counts (migration 0015). Server-only. Counted for team and share-link downloads;
 * shown to the team only. Reads fail soft so galleries still render before the migration runs.
 */

/** Ids per RPC call: a folder zip can list thousands of files. */
const CHUNK = 1000;

/** Adds one download to each item. Callers run it in `after()` and swallow errors. */
export async function recordItemDownloads(eventId: string, ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await db().rpc("record_item_downloads", { ev: eventId, ids: ids.slice(i, i + CHUNK) });
    if (error) throw error;
  }
}

/** Download counts for one event, keyed by `itemKey` (`<slug>/<id>`). */
export async function getEventDownloads(eventId: string, slug: string): Promise<Record<string, number>> {
  const { data, error } = await db().from("item_downloads").select("item_id,count").eq("event_id", eventId);
  if (error) return {};
  const counts: Record<string, number> = {};
  for (const row of data as { item_id: string; count: number | string }[]) counts[`${slug}/${row.item_id}`] = Number(row.count);
  return counts;
}
