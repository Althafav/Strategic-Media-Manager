import { db } from "@/lib/db";

/**
 * Folder covers picked by the admin (migration 0016). Server-only. Maps folder id -> cover item id.
 * Reads fail soft (empty) so covers fall back to the automatic pick before the migration runs.
 */

// A whole event's covers are a handful of rows; cached briefly because every folder tile asks.
const cache = new Map<string, { at: number; value: Promise<Record<string, string>> }>();
const TTL_MS = 30_000;

export function getEventCovers(eventId: string): Promise<Record<string, string>> {
  const hit = cache.get(eventId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  const value = (async () => {
    const { data, error } = await db().from("folder_covers").select("folder_id,item_id").eq("event_id", eventId);
    if (error) return {};
    return Object.fromEntries((data as { folder_id: string; item_id: string }[]).map((r) => [r.folder_id, r.item_id]));
  })();
  cache.set(eventId, { at: Date.now(), value });
  return value;
}

/** Picked covers of several events' root folders, keyed by folder id (the home page's event cards). */
export async function getRootCovers(rootIds: string[]): Promise<Record<string, string>> {
  if (!rootIds.length) return {};
  const { data, error } = await db().from("folder_covers").select("folder_id,item_id").in("folder_id", rootIds);
  if (error) return {};
  return Object.fromEntries((data as { folder_id: string; item_id: string }[]).map((r) => [r.folder_id, r.item_id]));
}

/** Sets a folder's cover, or clears it (`itemId` null) to go back to the automatic pick. */
export async function setFolderCover(eventId: string, folderId: string, itemId: string | null, by: string): Promise<void> {
  const table = db().from("folder_covers");
  const { error } = itemId
    ? await table.upsert({ event_id: eventId, folder_id: folderId, item_id: itemId, set_by: by, set_at: new Date().toISOString() })
    : await table.delete().match({ event_id: eventId, folder_id: folderId });
  cache.delete(eventId);
  if (error) throw error;
}
