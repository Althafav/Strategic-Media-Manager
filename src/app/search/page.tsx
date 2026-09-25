import { Gallery } from "@/components/gallery";
import { db, isIndexConfigured } from "@/lib/db";
import { listEvents } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import type { MediaItem } from "@/lib/onedrive/types";

export const dynamic = "force-dynamic";

type NodeRow = {
  id: string;
  event_id: string;
  name: string;
  kind: "folder" | "file";
  size: number;
  child_count: number | null;
  mime: string | null;
  is_image: boolean;
  is_video: boolean;
  width: number | null;
  height: number | null;
  taken_at: string | null;
  camera: string | null;
  modified_at: string | null;
  path: string | null;
};

export async function generateMetadata({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  return { title: `${typeof q === "string" ? q : "Search"} · Strategic Media Manager` };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const raw = (await searchParams).q;
  const q = (typeof raw === "string" ? raw : "").trim().slice(0, 100);

  if (!isIndexConfigured()) {
    return <Notice title="Search isn't set up yet" body="Connect Supabase and run the first index sync to enable search." />;
  }
  if (q.length < 2) return <Notice title="Search" body="Type at least two characters." />;

  const { data, error } = await db().rpc("search_nodes", { q, lim: 300 });
  if (error) throw error;
  const slugs = new Map((await listEvents()).map((e) => [e.id, e.slug]));
  const items = (data as NodeRow[]).filter((r) => slugs.has(r.event_id)).map((r) => toItem(r, slugs.get(r.event_id)!));

  return (
    <>
      <div className="pt-10">
        <h1 className="display text-4xl md:text-5xl text-balance">Results for &ldquo;{q}&rdquo;</h1>
        {items.length === 300 && <p className="text-subtle text-sm mt-1">Showing the first 300 matches. Refine your search to narrow down.</p>}
      </div>
      {items.length ? (
        <Gallery path={[]} folderName={`Search ${q}`} items={items} listedOrder="Relevance" canShare />
      ) : (
        <p className="py-24 text-center text-subtle">No file or folder names contain &ldquo;{q}&rdquo;. Try a shorter part of the name.</p>
      )}
    </>
  );
}

function toItem(r: NodeRow, event: string): MediaItem {
  const hasThumb = r.is_image || r.is_video;
  return {
    id: r.id,
    event,
    name: r.name,
    kind: r.kind,
    size: Number(r.size),
    childCount: r.child_count ?? undefined,
    mime: r.mime ?? undefined,
    isImage: r.is_image,
    isVideo: r.is_video,
    width: r.width ?? undefined,
    height: r.height ?? undefined,
    takenAt: r.taken_at ?? undefined,
    camera: r.camera ?? undefined,
    modifiedAt: r.modified_at ?? undefined,
    thumb: hasThumb ? thumbSrc({ event, id: r.id }, 400) : undefined,
    preview: hasThumb ? thumbSrc({ event, id: r.id }, 1920) : undefined,
    location: r.path ? r.path.split("/") : [],
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
