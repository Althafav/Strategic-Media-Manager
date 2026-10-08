import { Gallery } from "@/components/gallery";
import { isAdmin } from "@/lib/auth";
import { db, isIndexConfigured } from "@/lib/db";
import { listVisibleEvents } from "@/lib/events";
import { nodeToItem, type NodeRow } from "@/lib/nodes";

export const dynamic = "force-dynamic";

const LIMIT = 300;

export async function generateMetadata({ searchParams }: PageProps<"/search">) {
  const { q } = await searchParams;
  return { title: `${typeof q === "string" ? q : "Search"} · Strategic Media Manager` };
}

export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const params = await searchParams;
  const q = (typeof params.q === "string" ? params.q : "").trim().slice(0, 100);

  if (!isIndexConfigured()) {
    return <Notice title="Search isn't set up yet" body="Connect Supabase and run the first index sync to enable search." />;
  }
  if (q.length < 2) return <Notice title="Search" body="Type at least two characters." />;

  const events = await listVisibleEvents();
  // Event filter `?e=<slug>&e=<slug>`; slugs the viewer can't see are dropped. Kept in the events' own order.
  const wanted = new Set([params.e ?? []].flat());
  const selected = events.filter((e) => wanted.has(e.slug));
  // Private events the viewer may see. Passed only when there are some, so search works before migration 0019.
  const visible = events.filter((e) => e.hidden).map((e) => e.id);
  const rows = await searchNodes(q, visible, selected.map((e) => e.id));
  const slugs = new Map(events.map((e) => [e.id, e.slug]));
  const items = rows.filter((r) => slugs.has(r.event_id)).map((r) => nodeToItem(r, slugs.get(r.event_id)!));

  const where = selected.length ? ` in ${selected.map((e) => e.title).join(", ")}` : "";

  return (
    <>
      <div className="pt-10">
        <h1 className="display text-4xl md:text-5xl text-balance">
          Results for &ldquo;{q}&rdquo;{where}
        </h1>
        {items.length === LIMIT && <p className="text-subtle text-sm mt-1">Showing the first {LIMIT} matches. Refine your search to narrow down.</p>}
      </div>
      {items.length ? (
        <Gallery
          key={selected.map((e) => e.slug).join(",") || "all"}
          path={[]}
          folderName={`Search ${q}`}
          items={items}
          listedOrder="Relevance"
          canShare
          showDetails={await isAdmin()}
        />
      ) : (
        <p className="py-24 text-center text-subtle">
          No file or folder names{selected.length ? " in the selected events" : ""} contain &ldquo;{q}&rdquo;. Try a shorter
          part of the name{selected.length ? " or more events" : ""}.
        </p>
      )}
    </>
  );
}

/**
 * Runs the `search_nodes` RPC, limited to `evs` when given. Before migration 0020 the RPC has no `evs`, so it
 * falls back to one call per event and merges them by rank, folders first.
 */
async function searchNodes(q: string, visible: string[], evs: string[]): Promise<NodeRow[]> {
  const base = { q, lim: LIMIT, ...(visible.length ? { visible } : {}) };
  const { data, error } = await db().rpc("search_nodes", { ...base, ...(evs.length ? { evs } : {}) });
  if (!error) return data as NodeRow[];
  if (!evs.length || error.code !== "PGRST202") throw error;

  const parts = await Promise.all(
    evs.map(async (ev) => {
      const res = await db().rpc("search_nodes", { ...base, ev });
      if (res.error) throw res.error;
      return res.data as NodeRow[];
    }),
  );
  // Interleave so one busy event can't fill every slot before the others get any.
  const merged = Array.from({ length: Math.max(...parts.map((p) => p.length)) }, (_, i) => parts.map((p) => p[i]))
    .flat()
    .filter(Boolean);
  return [...merged.filter((r) => r.kind === "folder"), ...merged.filter((r) => r.kind !== "folder")].slice(0, LIMIT);
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="py-24 text-center">
      <h1 className="display text-3xl">{title}</h1>
      <p className="text-subtle mt-1">{body}</p>
    </div>
  );
}
