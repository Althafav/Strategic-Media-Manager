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

export const isExpired = (s: Pick<ShareRow, "expires_at">) => !!s.expires_at && Date.parse(s.expires_at) <= Date.now();
