/** Share-link types and helpers that are safe to import from client components. */
export type ShareRow = {
  id: string;
  token: string;
  event_id: string;
  /** Null only for item links built from search results spanning folders. */
  folder_id: string | null;
  folder_path: string[];
  folder_name: string;
  label: string | null;
  expires_at: string | null;
  created_at: string;
  last_viewed_at: string | null;
  view_count: number;
  /** Downloads (a file or a zip) through the link. Missing before migration 0006. */
  download_count?: number;
  /** Files in those downloads, added up. */
  downloaded_files?: number;
  last_downloaded_at?: string | null;
  /** Set when the link shares picked items instead of the whole folder. Missing before migration 0004. */
  item_ids?: string[] | null;
  /** "admin", or the SSO user's email. Null for links made before migration 0008. */
  created_by?: string | null;
  /** Set while the link is in the admin's recycle bin (migration 0018). */
  deleted_at?: string | null;
  deleted_by?: string | null;
};

/** Most items one link may carry (each is looked up when the link is opened). */
export const MAX_SHARE_ITEMS = 500;

/** Most files a visitor's copied selection link may carry: they travel in the URL, ~60 characters each. */
export const MAX_PICK_ITEMS = 100;

/** One file in a visitor's selection link: its id and the signature the share page issued for it. */
export type SharePick = { id: string; sig: string };

// Ids are `[A-Za-z0-9!_-]` and signatures base64url, so "." and "," can't appear inside either.
const PICK_RE = /^[A-Za-z0-9!_-]+\.[A-Za-z0-9_-]+$/;

/** A view of some files of a share link, `/s/<token>?i=<id>.<sig>,…`. It opens nothing the link itself doesn't. */
export const picksHref = (token: string, picks: SharePick[]) =>
  `/s/${token}?i=${picks.map((p) => `${p.id}.${p.sig}`).join(",")}`;

/** Reads `?i=`. Null when malformed or over the cap. The caller must still check every signature (`verifyItem`). */
export function parsePicks(raw: string): SharePick[] | null {
  const pairs = raw.split(",");
  if (pairs.length > MAX_PICK_ITEMS) return null;
  const picks = new Map<string, SharePick>();
  for (const pair of pairs) {
    if (!PICK_RE.test(pair)) return null;
    const [id, sig] = pair.split(".");
    picks.set(id, { id, sig });
  }
  return [...picks.values()];
}

/** A picked-items link the Share dialog can add to. */
export type LinkOption = { id: string; name: string; count: number };

export const isItemShare =(s: Pick<ShareRow, "item_ids">) => !!s.item_ids?.length;

export const EXPIRY_OPTIONS = [
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "never", label: "Never" },
] as const;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "3 downloads (412 files)"; "2 downloads" when every download was one file. Null before migration 0006. */
export function downloadSummary(s: Pick<ShareRow, "download_count" | "downloaded_files">): string | null {
  if (s.download_count === undefined) return null;
  const downloads = count(s.download_count, "download", "downloads");
  const files = s.downloaded_files ?? 0;
  return files > s.download_count ? `${downloads} (${count(files, "file", "files")})` : downloads;
}

export const isExpired = (s: Pick<ShareRow, "expires_at">) => !!s.expires_at && Date.parse(s.expires_at) <= Date.now();
