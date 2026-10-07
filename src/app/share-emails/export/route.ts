import { isAdmin } from "@/lib/auth";
import { listEvents } from "@/lib/events";
import { listShareEmails } from "@/lib/share-emails";
import { binnedShareIds } from "@/lib/shares";

/** Admin-only CSV of share link emails. `?share=<token>` limits it to one link. */
export async function GET(req: Request) {
  if (!(await isAdmin())) return new Response("Not found", { status: 404 });
  const share = new URL(req.url).searchParams.get("share") || undefined;
  const [rows, events, binned] = await Promise.all([
    listShareEmails({ shareToken: share }).catch(() => null),
    listEvents({ includeHidden: true }).catch(() => []),
    binnedShareIds(),
  ]);
  if (!rows) return new Response("Run migration 0014_share_emails.sql first.", { status: 503 });
  const eventTitle = new Map(events.map((e) => [e.id, e.title]));

  const lines = [
    ["Name", "Email", "Link", "Event", "Link deleted", "First visit", "Last visit", "Visits"],
    ...rows.map((r) => [
      r.name ?? "",
      r.email,
      r.share_label ?? "",
      (r.event_id && eventTitle.get(r.event_id)) || "",
      r.share_id && !binned.has(r.share_id) ? "no" : "yes",
      r.first_seen_at,
      r.last_seen_at,
      String(r.visit_count),
    ]),
  ].map((cells) => cells.map(csvCell).join(","));

  const date = new Date().toISOString().slice(0, 10);
  return new Response(`﻿${lines.join("\r\n")}\r\n`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="share-link-emails-${date}.csv"`,
      "cache-control": "no-store",
    },
  });
}

/** Quotes every cell, and defuses values a spreadsheet would run as a formula (visitors typed the emails). */
function csvCell(value: string) {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}
