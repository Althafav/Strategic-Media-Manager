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
};

/** Most items one link may carry (each is looked up when the link is opened). */
export const MAX_SHARE_ITEMS = 500;

export const isItemShare = (s: Pick<ShareRow, "item_ids">) => !!s.item_ids?.length;

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
