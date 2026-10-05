import { resolveItemAccess } from "@/lib/access";
import { getEventCovers } from "@/lib/covers";
import { getCoverUrl, isValidId } from "@/lib/onedrive/client";

/** Redirects to a folder's cover: the admin's pick, else the first image found inside it. */
export async function GET(req: Request, ctx: RouteContext<"/api/cover/[id]">) {
  const { id } = await ctx.params;
  const event = await resolveItemAccess(new URL(req.url).searchParams, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  const pinned = await getEventCovers(event.id).catch(() => ({}));
  const url = await getCoverUrl(event.share_url, id, pinned).catch(() => null);
  if (!url) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=600" } });
  // Signed URL lives ~hours; let the browser reuse the redirect briefly.
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, max-age=900" } });
}
