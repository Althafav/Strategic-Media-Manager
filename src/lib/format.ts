export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago". Pass `now` from the server so the text doesn't shift at hydration. */
export function timeAgo(iso: string, now = Date.now()): string {
  const mins = Math.floor((now - Date.parse(iso)) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} ago`;
}

/** Strips private-use characters OneDrive sometimes leaves in synced names. */
export function cleanName(name: string): string {
  return name.replace(/[-]/g, "").trim();
}

/** Appends encoded path segments to a base URL such as `/e/<slug>` or `/s/<token>`. */
export function folderHref(base: string, path: string[] = []): string {
  return `${base}${path.map((s) => `/${encodeURIComponent(s)}`).join("")}`;
}

/** URL for a folder inside an event, given path segments relative to the event root. */
export function browseHref(event: string, path: string[] = []): string {
  return folderHref(`/e/${encodeURIComponent(event)}`, path);
}

export const shareHref = (token: string, path: string[] = []) => folderHref(`/s/${token}`, path);

/** `t`/`sig` are set on items seen through a share link (see lib/shares.ts). */
export type Ref = { event: string; id: string; t?: string; sig?: string };

const refQuery = (r: Ref) => `e=${encodeURIComponent(r.event)}${r.t ? `&t=${r.t}&sig=${r.sig}` : ""}`;

export const itemKey = (r: Ref) => `${r.event}/${r.id}`;
export const downloadHref = (r: Ref) => `/api/download/${r.id}?${refQuery(r)}`;
export const coverSrc = (r: Ref) => `/api/cover/${r.id}?${refQuery(r)}`;
export const thumbSrc = (r: Ref, size: number) => `/api/thumb/${r.id}?${refQuery(r)}&s=${size}`;

/** Largest preview we ask OneDrive for (sharp when zoomed in, ~0.5 MB, far below an original). */
export const ZOOM_PX = 3840;

/**
 * The same preview at `px`: `/api/thumb` URLs take `s=`, OneDrive transform URLs take `width`/`height`.
 * Null when the URL can't be resized.
 */
export function resizedPreview(preview: string, px = ZOOM_PX): string | null {
  if (preview.startsWith("/api/thumb/")) return preview.replace(/([?&]s=)\d+/, `$1${px}`);
  try {
    const u = new URL(preview);
    if (!u.searchParams.has("width")) return null;
    u.searchParams.set("width", String(px));
    u.searchParams.set("height", String(px));
    return u.toString();
  } catch {
    return null;
  }
}
