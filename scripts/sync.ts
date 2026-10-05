// Full or incremental index sync for every event: npm run sync
// `npm run sync -- --full` drops the saved delta cursors and re-lists every event from scratch,
// e.g. after rows were deleted from `nodes` by hand (a delta cursor would never bring them back).
import { db } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { runDeltaSync } from "@/lib/sync/delta-sync";

const full = process.argv.includes("--full");

async function main() {
  for (const event of await listEvents({ includeHidden: true })) {
    const t0 = Date.now();
    const startedAt = new Date(t0).toISOString();
    if (full) {
      const { error } = await db().from("event_sync").update({ next_link: null, delta_link: null }).eq("event_id", event.id);
      if (error) throw error;
    }
    let total = { upserted: 0, deleted: 0, pages: 0 };
    for (;;) {
      const r = await runDeltaSync(event, { budgetMs: 60_000 });
      total = { upserted: total.upserted + r.upserted, deleted: total.deleted + r.deleted, pages: total.pages + r.pages };
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`[${event.slug}] pages=${total.pages} upserted=${total.upserted} deleted=${total.deleted} (${secs}s)`);
      if (r.complete) break;
    }
    if (full) {
      // The full pass re-stamped every live item; older rows are files that no longer exist.
      const { count, error } = await db()
        .from("nodes")
        .delete({ count: "exact" })
        .eq("event_id", event.id)
        .lt("synced_at", startedAt);
      if (error) throw error;
      if (count) console.log(`[${event.slug}] removed ${count} stale rows`);
    }
  }
  console.log("Sync complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
