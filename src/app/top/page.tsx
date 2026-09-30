import Link from "next/link";
import { redirect } from "next/navigation";
import { Gallery } from "@/components/gallery";
import { getSession } from "@/lib/auth";
import { db, isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import type { LikeMap } from "@/lib/like-types";
import { likedByOwner, topLiked } from "@/lib/likes";
import { nodeToItem, type NodeRow } from "@/lib/nodes";
import type { MediaItem } from "@/lib/onedrive/types";
import { shareOwner } from "@/lib/shares";

export const dynamic = "force-dynamic";
export const metadata = { title: "Most liked · Strategic Media Manager" };

const LIMIT = 100;

export default async function TopLikedPage({ searchParams }: PageProps<"/top">) {
  const session = await getSession();
  if (!session) redirect("/login?next=/top");
  if (!isIndexConfigured()) return <Notice title="Likes aren't set up yet" body="Connect Supabase to enable likes." />;

  const raw = (await searchParams).e;
  const events = await listEvents();
  const current = events.find((e) => e.slug === raw) ?? null;

  const rows = await topLiked(current?.id, LIMIT).catch(() => null);
  if (!rows) {
    return <Notice title="Likes aren't set up yet" body="Run supabase/migrations/0010_photo_likes.sql in the Supabase SQL editor." />;
  }

  const slugs = new Map(events.map((e) => [e.id, e.slug]));
  const ids = [...new Set(rows.map((r) => r.item_id))];
  const [nodes, mine] = await Promise.all([
    ids.length ? db().from("nodes").select("*").in("id", ids).then(({ data }) => (data ?? []) as NodeRow[]) : [],
    likedByOwner(shareOwner(session), ids).catch(() => new Set<string>()),
  ]);
  const byKey = new Map(nodes.map((n) => [`${n.event_id}/${n.id}`, n]));

  const items: MediaItem[] = [];
  const likes: LikeMap = {};
  for (const r of rows) {
    const slug = slugs.get(r.event_id);
    if (!slug) continue;
    const node = byKey.get(`${r.event_id}/${r.item_id}`);
    items.push(node ? nodeToItem(node, slug) : notIndexed(r.item_id, slug));
    likes[`${slug}/${r.item_id}`] = { count: r.likes, mine: mine.has(`${r.event_id}/${r.item_id}`) };
  }

  const chip = (active: boolean) =>
    `h-7 px-2.5 rounded-[5px] text-sm inline-flex items-center ${active ? "bg-accent text-accent-foreground" : "text-subtle hover:text-foreground"}`;

  return (
    <>
      <div className="pt-10">
        <h1 className="display text-4xl md:text-5xl text-balance">Most liked{current ? ` in ${current.title}` : ""}</h1>
        {events.length > 1 && (
          <nav aria-label="Event" className="mt-4 inline-flex flex-wrap rounded-md border border-border bg-surface p-0.5">
            <Link href="/top" className={chip(!current)} aria-current={!current ? "page" : undefined}>
              All events
            </Link>
            {events.map((e) => (
              <Link
                key={e.id}
                href={`/top?e=${encodeURIComponent(e.slug)}`}
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
          folderName={current ? `Most liked ${current.title}` : "Most liked"}
          items={items}
          listedOrder="Most liked"
          canShare
          showDetails={session.role === "admin"}
          likes={likes}
        />
      ) : (
        <p className="py-24 text-center text-subtle">No likes yet. Tap the heart on a photo to like it.</p>
      )}
    </>
  );
}

/** A liked item the index doesn't have yet (not synced, or since deleted in OneDrive). */
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
