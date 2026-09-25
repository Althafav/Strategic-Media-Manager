import { resolveItemAccess } from "@/lib/access";
import { getDownloadUrl, isValidId, NotFoundError } from "@/lib/onedrive/client";

/**
 * Redirects to a fresh pre-authenticated OneDrive download URL, so file bytes
 * go straight from OneDrive to the browser. `?json=1` returns the URL instead
 * (used by the zip builder to refresh expired links).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/download/[id]">) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const event = await resolveItemAccess(params, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  try {
    const url = await getDownloadUrl(event.share_url, id);
    if (params.has("json")) {
      return Response.json({ url }, { headers: { "cache-control": "no-store" } });
    }
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
