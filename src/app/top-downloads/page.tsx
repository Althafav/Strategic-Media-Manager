import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { db, isIndexConfigured } from "@/lib/db";
import { topDownloaded } from "@/lib/downloads";
import { listEvents } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import { nodeToItem, type NodeRow } from "@/lib/nodes";
import type { MediaItem } from "@/lib/onedrive/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Most downloaded · Strategic Media Manager" };

const LIMIT = 100;

/** Admin only: the most-downloaded files, counting team and share-link downloads (migration 0015). */
export default async function TopDownloadsPage({ searchParams }: PageProps<"/top-downloads">) {
  const session = await getSession();
  if (!session) redirect("/login?next=/top-downloads");
  if (session.role !== "admin") notFound();
  if (!isIndexConfigured()) return <Notice title="Downloads aren't set up yet" body="Connect Supabase to count downloads." />;

  const raw = (await searchParams).e;
  const events = await listEvents({ includeHidden: true });
  const current = events.find((e) => e.slug === raw) ?? null;

  const rows = await topDownloaded(current ? [current.id] : events.map((e) => e.id), LIMIT).catch(() => null);
  if (!rows) {
    return <Notice title="Downloads aren't set up yet" body="Run supabase/migrations/0015_item_downloads.sql in the Supabase SQL editor." />;
  }

  const slugs = new Map(events.map((e) => [e.id, e.slug]));
  const ids = [...new Set(rows.map((r) => r.item_id))];
  const nodes = ids.length
    ? await db().from("nodes").select("*").in("id", ids).then(({ data }) => (data ?? []) as NodeRow[])
    : [];
  const byKey = new Map(nodes.map((n) => [`${n.event_id}/${n.id}`, n]));

  const items: MediaItem[] = [];
  const downloads: Record<string, number> = {};
  for (const r of rows) {
    const slug = slugs.get(r.event_id);
    if (!slug) continue;
    const node = byKey.get(`${r.event_id}/${r.item_id}`);
    items.push(node ? nodeToItem(node, slug) : notIndexed(r.item_id, slug));
    downloads[`${slug}/${r.item_id}`] = r.downloads;
  }

  const chip = (active: boolean) =>
    `h-7 px-2.5 rounded-[5px] text-sm inline-flex items-center ${active ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground"}`;

  return (
    <>
      <div className="pt-10">
        <h1 className="display text-4xl md:text-5xl text-balance">Most downloaded{current ? ` in ${current.title}` : ""}</h1>
        <p className="text-subtle mt-1">Team and share-link downloads. A zip counts once for every file in it.</p>
        {events.length > 1 && (
          <nav aria-label="Event" className="mt-4 inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5">
            <Link href="/top-downloads" className={chip(!current)} aria-current={!current ? "page" : undefined}>
              All events
            </Link>
            {events.map((e) => (
              <Link
                key={e.id}
                href={`/top-downloads?e=${encodeURIComponent(e.slug)}`}
                className={chip(current?.id === e.id)}
                aria-current={current?.id === e.id ? "page" : undefined}
              >
                {e.title}
              </Link>
            ))}
          </nav>
        )}
      </div>
      {items.length ? (
        <Gallery
          key={current?.slug ?? "all"}
          path={[]}
          folderName={current ? `Most downloaded ${current.title}` : "Most downloaded"}
          items={items}
          listedOrder="Most downloaded"
          canShare
          showDetails
          downloads={downloads}
        />
      ) : (
        <p className="py-24 text-center text-subtle">No downloads yet.</p>
      )}
    </>
  );
}

/** A downloaded item the index doesn't have yet (not synced, or since deleted in OneDrive). */
function notIndexed(id: string, event: string): MediaItem {
  return {
    id,
    event,
    name: "Not indexed yet",
    kind: "file",
    size: 0,
    isImage: true,
    isVideo: false,
    thumb: thumbSrc({ event, id }, 400),
    preview: thumbSrc({ event, id }, 1920),
  };
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-24 text-center">
      <h1 className="display text-3xl">{title}</h1>
      <p className="text-subtle mt-1">{body}</p>
    </div>
  );
}
