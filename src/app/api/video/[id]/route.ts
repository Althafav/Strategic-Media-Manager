import { resolveItemAccess } from "@/lib/access";
import { getVideoStreamUrl, isValidId, NotFoundError } from "@/lib/onedrive/client";

/**
 * Redirects to OneDrive's live 1080p stream (DASH manifest) of a video, for computers that can't decode the
 * original (e.g. 4K HEVC 4:2:2). The URLs carry a tempauth for this item only. Not counted as a download.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/video/[id]">) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const event = await resolveItemAccess(params, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  try {
    const url = await getVideoStreamUrl(event.share_url, id);
    if (!url) return new Response("Not found", { status: 404 });
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
