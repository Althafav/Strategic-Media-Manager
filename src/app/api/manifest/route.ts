import { getSession } from "@/lib/auth";
import { getEvent } from "@/lib/events";
import { buildManifest, isValidId, NotFoundError, type ManifestEntry } from "@/lib/onedrive/client";
import { getActiveShare, signItem, verifyItem } from "@/lib/shares";

type Ref = { event: string; id: string; sig?: string };

/**
 * POST { items: {event, id}[] } -> flat list of files (relative path, size, direct URL) for client-side zipping.
 * Share-link visitors call it with `?t=<token>` and signed items; only those folders are expanded.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { items?: unknown } | null;
  const refs = (Array.isArray(body?.items) ? body.items : []).filter(
    (r): r is Ref => typeof r?.event === "string" && typeof r?.id === "string" && isValidId(r.id),
  );
  if (!refs.length || refs.length > 5000) {
    return Response.json({ error: "Provide 1-5000 valid items" }, { status: 400 });
  }

  const files: ManifestEntry[] = [];
  try {
    const token = new URL(req.url).searchParams.get("t");
    if (token) {
      const active = await getActiveShare(token).catch(() => null);
      if (!active || !refs.every((r) => verifyItem(token, r.id, r.sig ?? null))) {
        return Response.json({ error: "This link has expired or was removed." }, { status: 403 });
      }
      await buildManifest(active.event.share_url, active.event.slug, refs.map((r) => r.id), files);
      // Everything listed is inside the shared folder; sign it so expired download URLs can be refreshed.
      for (const f of files) Object.assign(f, { t: token, sig: signItem(token, f.id) });
      return Response.json({ files }, { headers: { "cache-control": "no-store" } });
    }

    if (!(await getSession())) return Response.json({ error: "Not logged in" }, { status: 401 });
    for (const [slug, group] of Map.groupBy(refs, (r) => r.event)) {
      const event = await getEvent(slug);
      if (!event) return Response.json({ error: `Unknown event ${slug}` }, { status: 404 });
      await buildManifest(event.share_url, slug, group.map((r) => r.id), files);
    }
    return Response.json({ files }, { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return Response.json({ error: "Not found" }, { status: 404 });
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}
