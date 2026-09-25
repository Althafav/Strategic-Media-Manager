import { resolveItemAccess } from "@/lib/access";
import { getCoverUrl, isValidId } from "@/lib/onedrive/client";

/** Redirects to a thumbnail of the first image found inside a folder. */
export async function GET(req: Request, ctx: RouteContext<"/api/cover/[id]">) {
  const { id } = await ctx.params;
  const event = await resolveItemAccess(new URL(req.url).searchParams, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  const url = await getCoverUrl(event.share_url, id).catch(() => null);
  if (!url) return new Response(null, { status: 404, headers: { "cache-control": "public, max-age=600" } });
  // Signed URL lives ~hours; let the browser reuse the redirect briefly.
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, max-age=900" } });
}
