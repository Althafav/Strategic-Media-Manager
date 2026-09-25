export function formatBytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i >= 2 ? 1 : 0)} ${units[i]}`;
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
