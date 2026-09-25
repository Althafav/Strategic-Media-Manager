// Full or incremental index sync for every event: npm run sync
import { listEvents } from "@/lib/events";
import { runDeltaSync } from "@/lib/sync/delta-sync";

async function main() {
  for (const event of await listEvents({ includeHidden: true })) {
    const t0 = Date.now();
    let total = { upserted: 0, deleted: 0, pages: 0 };
    for (;;) {
      const r = await runDeltaSync(event, { budgetMs: 60_000 });
      total = { upserted: total.upserted + r.upserted, deleted: total.deleted + r.deleted, pages: total.pages + r.pages };
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`[${event.slug}] pages=${total.pages} upserted=${total.upserted} deleted=${total.deleted} (${secs}s)`);
      if (r.complete) break;
    }
  }
  console.log("Sync complete");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
