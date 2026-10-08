import { after } from "next/server";
import { resolveItemAccess } from "@/lib/access";
import { recordItemDownloads } from "@/lib/downloads";
import { getDownloadUrl, isValidId, NotFoundError } from "@/lib/onedrive/client";
import { recordDownload } from "@/lib/shares";

/**
 * Redirects to a fresh pre-authenticated OneDrive download URL, so file bytes
 * go straight from OneDrive to the browser. `?json=1` returns the URL instead
 * (used by the zip builder to refresh expired links).
 * Every redirect counts as a download of the file (and, on share links, of the link), except `?stream=1`
 * (the lightbox video player, the compress dialog's source). `?count=1` only counts, returning 204
 * (the compress dialog's Download button).
 */
export async function GET(req: Request, ctx: RouteContext<"/api/download/[id]">) {
  const { id } = await ctx.params;
  const params = new URL(req.url).searchParams;
  const event = await resolveItemAccess(params, id);
  if (!isValidId(id)) return new Response("Bad request", { status: 400 });
  if (!event) return new Response("Forbidden", { status: 403 });
  const token = params.get("t");
  if (params.has("count")) {
    after(() => recordItemDownloads(event.id, [id]).catch(() => {}));
    if (token) after(() => recordDownload(token).catch(() => {}));
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }
  try {
    const url = await getDownloadUrl(event.share_url, id);
    if (params.has("json")) {
      return Response.json({ url }, { headers: { "cache-control": "no-store" } });
    }
    if (!params.has("stream")) {
      after(() => recordItemDownloads(event.id, [id]).catch(() => {}));
      if (token) after(() => recordDownload(token).catch(() => {}));
    }
    return new Response(null, { status: 302, headers: { location: url, "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof NotFoundError) return new Response("Not found", { status: 404 });
    throw e;
  }
}
