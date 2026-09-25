import { isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { runDeltaSync, type SyncResult } from "@/lib/sync/delta-sync";

export const maxDuration = 300;

/** Invoked by Vercel Cron (Authorization: Bearer $CRON_SECRET). Syncs events within one time budget. */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!isIndexConfigured()) return Response.json({ error: "Index not configured" }, { status: 503 });

  const deadline = Date.now() + 250_000;
  const results: Record<string, SyncResult | { error: string }> = {};
  for (const event of await listEvents({ includeHidden: true })) {
    const budgetMs = deadline - Date.now();
    if (budgetMs < 5_000) break;
    try {
      results[event.slug] = await runDeltaSync(event, { budgetMs });
    } catch (e) {
      results[event.slug] = { error: (e as Error).message };
    }
  }
  return Response.json(results);
}
