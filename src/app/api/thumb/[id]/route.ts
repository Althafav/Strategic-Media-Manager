import { resolveItemAccess } from "@/lib/access";
import { ZOOM_PX } from "@/lib/format";
import { getThumbUrl, isValidId } from "@/lib/onedrive/client";

/** Redirects to a fresh signed thumbnail. `?s=` is the bounding box in px. */
export async function GET(req: Request, ctx: RouteContext<"/api/thumb/[id]">) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const event = await resolveItemAccess(params, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  const size = Math.min(Math.max(Number(params.get("s")) || 400, 64), ZOOM_PX);
  const url = await getThumbUrl(event.share_url, id, size).catch(() => null);
  if (!url) return new Response(null, { status: 404 });
  return new Response(null, { status: 302, headers: { location: url, "cache-control": "private, max-age=900" } });
}
