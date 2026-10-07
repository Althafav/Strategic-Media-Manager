import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { isAdmin } from "@/lib/auth";
import { listEvents } from "@/lib/events";
import { shareHref } from "@/lib/format";
import { listShareEmails } from "@/lib/share-emails";
import { binnedShareIds } from "@/lib/shares";
import { formatDate } from "@/lib/share-types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Share link emails · Strategic Media Manager" };

/** Admin-only: the emails visitors entered to open share links (the email gate, lib/share-emails.ts). */
export default async function ShareEmailsPage({ searchParams }: PageProps<"/share-emails">) {
  if (!(await isAdmin())) notFound();
  const { share } = await searchParams;
  const shareToken = typeof share === "string" && share ? share : undefined;
  const [rows, events, binned] = await Promise.all([
    listShareEmails({ shareToken }).catch(() => null),
    listEvents({ includeHidden: true }).catch(() => []),
    binnedShareIds(),
  ]);
  const eventTitle = new Map(events.map((e) => [e.id, e.title]));
  const exportHref = `/share-emails/export${shareToken ? `?share=${encodeURIComponent(shareToken)}` : ""}`;

  return (
    <div className="max-w-4xl">
      <div className="pt-10 mb-6 flex flex-wrap items-end gap-4">
        <div className="flex-1 min-w-64">
          <h1 className="display text-5xl">Share link emails</h1>
          <p className="text-subtle mt-1">
            Visitors enter their name and email before a share link shows anything. Only you can see this list.
          </p>
        </div>
        {rows && rows.length > 0 && (
          // A plain link: the route answers with a CSV attachment.
          <a
            href={exportHref}
            className="h-9 px-3 rounded-md bg-accent text-accent-foreground text-sm font-medium inline-flex items-center gap-2"
          >
            <Download className="size-4" /> Export CSV
          </a>
        )}
      </div>

      {shareToken && (
        <p className="text-sm mb-4">
          Showing one link.{" "}
          <Link href="/share-emails" className="underline">
            Show all links
          </Link>
        </p>
      )}

      {rows === null ? (
        <p className="text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Email collection isn&apos;t set up yet. Run <code>supabase/migrations/0014_share_emails.sql</code> in the Supabase
          SQL editor.
        </p>
      ) : rows.length === 0 ? (
        <p className="py-16 text-center text-subtle">No one has opened a share link yet.</p>
      ) : (
        <>
          <p className="text-sm text-subtle mb-2">
            {rows.length} {rows.length === 1 ? "entry" : "entries"}
          </p>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
            {rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="flex-1 min-w-56">
                  <p className="font-medium truncate">{r.name || r.email}</p>
                  {r.name && <p className="text-sm truncate">{r.email}</p>}
                  <p className="text-sm text-subtle truncate">
                    {r.share_id && !binned.has(r.share_id) ? (
                      <Link href={shareHref(r.share_token)} className="hover:underline">
                        {r.share_label ?? "Share link"}
                      </Link>
                    ) : (
                      <span>{r.share_label ?? "Share link"} (deleted)</span>
                    )}
                    {r.event_id && eventTitle.get(r.event_id) ? `, ${eventTitle.get(r.event_id)}` : ""}
                  </p>
                </div>
                <div className="text-xs text-subtle w-48">
                  <p>First visit {formatDate(r.first_seen_at)}</p>
                  <p>
                    Last visit {formatDate(r.last_seen_at)}
                    {r.visit_count > 1 ? `, ${r.visit_count} times` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
