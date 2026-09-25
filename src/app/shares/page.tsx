import Link from "next/link";
import { CopyLinkButton, RevokeLinkButton, ShareStatus } from "@/components/share-link-actions";
import { listEvents } from "@/lib/events";
import { browseHref, cleanName } from "@/lib/format";
import { downloadSummary, formatDate, isItemShare } from "@/lib/share-types";
import { listShares } from "@/lib/shares";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shared links · Strategic Media Manager" };

export default async function SharesPage() {
  const [shares, events] = await Promise.all([listShares().catch(() => null), listEvents({ includeHidden: true })]);
  const eventById = new Map(events.map((e) => [e.id, e]));

  return (
    <>
      <div className="pt-10">
        <h1 className="display text-5xl">Shared links</h1>
        <p className="text-subtle mt-1">
          Private view links given to people outside the team. Revoking a link cuts off access immediately.
        </p>
      </div>

      {shares === null ? (
        <p className="mt-6 text-sm rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
          Share links aren&apos;t set up yet. Run <code>supabase/migrations/0003_shares.sql</code> in the Supabase SQL
          editor.
        </p>
      ) : shares.length === 0 ? (
        <p className="py-24 text-center text-subtle">
          No shared links yet. Open a folder and click <strong>Share</strong>, or select photos and share just those.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-border rounded-lg border border-border bg-surface">
          {shares.map((s) => {
            const event = eventById.get(s.event_id);
            const where = [event?.title ?? "Unknown event", ...s.folder_path.map(cleanName)].join(" / ");
            const picked = s.item_ids?.length ?? 0;
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="flex-1 min-w-60">
                  <p className="font-medium truncate">{s.label || "Unnamed link"}</p>
                  <p className="text-sm truncate">
                    {isItemShare(s) ? `${s.folder_name} (${picked} picked ${picked === 1 ? "item" : "items"})` : "Whole folder"}
                  </p>
                  {event ? (
                    <Link
                      href={browseHref(event.slug, s.folder_path)}
                      className="text-sm text-subtle hover:text-foreground truncate block"
                    >
                      {where}
                    </Link>
                  ) : (
                    <p className="text-sm text-subtle truncate">{where}</p>
                  )}
                </div>
                <div className="text-xs text-subtle w-44">
                  <p>Created {formatDate(s.created_at)}</p>
                  <p>
                    <ShareStatus share={s} />
                  </p>
                </div>
                <div className="text-xs text-subtle w-32">
                  <p>
                    {s.view_count} {s.view_count === 1 ? "view" : "views"}
                  </p>
                  <p>{s.last_viewed_at ? `Last ${formatDate(s.last_viewed_at)}` : "Not opened yet"}</p>
                </div>
                {downloadSummary(s) && (
                  <div className="text-xs text-subtle w-40">
                    <p>{downloadSummary(s)}</p>
                    <p>{s.last_downloaded_at ? `Last ${formatDate(s.last_downloaded_at)}` : "Nothing downloaded yet"}</p>
                  </div>
                )}
                <div className="flex gap-2">
                  <CopyLinkButton token={s.token} label="Copy link" />
                  <RevokeLinkButton id={s.id} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
