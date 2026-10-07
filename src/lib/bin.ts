import { db } from "@/lib/db";

/**
 * The admin's recycle bin (migration 0018): revoked share links and deleted photo requests keep their row with
 * `deleted_at` set. The admin restores or purges them on /bin; the daily cron purges anything older than BIN_DAYS.
 * Server-only.
 */
export const BIN_DAYS = 30;

const TABLES = ["shares", "photo_requests"] as const;
type BinCounts = Record<(typeof TABLES)[number], number>;

/** Whole days left before a binned row is purged (0 means it goes at the next cron run). */
export function daysLeft(deletedAt: string): number {
  return Math.max(0, Math.ceil((Date.parse(deletedAt) + BIN_DAYS * 86_400_000 - Date.now()) / 86_400_000));
}

/** Deletes binned rows older than BIN_DAYS. Never throws: before migration 0018 the cron just reports the error. */
export async function purgeExpiredBin(): Promise<BinCounts | { error: string }> {
  const cutoff = new Date(Date.now() - BIN_DAYS * 86_400_000).toISOString();
  try {
    return await purge((table) => db().from(table).delete().lt("deleted_at", cutoff).select("id"));
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Deletes everything in the bin for good. Admin only (checked by the caller). */
export function emptyBin(): Promise<BinCounts> {
  return purge((table) => db().from(table).delete().not("deleted_at", "is", null).select("id"));
}

async function purge(
  run: (table: (typeof TABLES)[number]) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<BinCounts> {
  const counts = { shares: 0, photo_requests: 0 };
  for (const table of TABLES) {
    const { data, error } = await run(table);
    if (error) throw new Error(error.message);
    counts[table] = data?.length ?? 0;
  }
  return counts;
}
