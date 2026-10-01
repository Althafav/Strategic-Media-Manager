/** Client-safe photo request types and labels (the queries live in requests.ts, which is server-only). */
export const REQUEST_STATUSES = ["pending", "in_progress", "fulfilled", "declined"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: "New",
  in_progress: "In progress",
  fulfilled: "Fulfilled",
  declined: "Declined",
};

export const isOpen = (status: RequestStatus) => status === "pending" || status === "in_progress";

export const MAX_REQUEST_LENGTH = 2000;
export const MAX_REQUEST_ITEMS = 200;

/**
 * A photo (or folder) picked in the selection bar and attached to a request (migration 0012).
 * `path`: the folder it was picked from, relative to the event root. Missing on requests made before it existed.
 */
export type RequestItem = { id: string; name: string; kind: "file" | "folder"; path?: string[] };

export type PhotoRequestRow = {
  id: string;
  event_id: string;
  requested_by: string;
  message: string;
  /** The common folder of the picked items, or the folder "Request photos" was used in. */
  folder_path: string[];
  /** Picked items; null for a message-only request, absent before migration 0012. */
  items?: RequestItem[] | null;
  status: RequestStatus;
  coordinator_note: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  /** Migration 0013: when the requester last saw their Sent tab. */
  requester_seen_at?: string | null;
};

export const isRequestStatus = (v: unknown): v is RequestStatus => REQUEST_STATUSES.includes(v as RequestStatus);

/** Answered after the requester last looked. Never before migration 0013 (the column is absent, not null). */
export const isUnseenAnswer = (r: PhotoRequestRow) =>
  r.requester_seen_at !== undefined &&
  !isOpen(r.status) &&
  !!r.resolved_at &&
  (!r.requester_seen_at || Date.parse(r.resolved_at) > Date.parse(r.requester_seen_at));

/**
 * Window event fired when a page has shown the viewer their new requests or replies, so the header badge (in the
 * root layout, which client navigation doesn't re-render) can drop them straight away.
 */
export const REQUESTS_SEEN_EVENT = "smm:requests-seen";
export type RequestsSeen = { inbox?: boolean; sent?: boolean; reply?: boolean };

/** Longest shared leading part of several folder paths (the folder that contains them all). */
export function commonPath(paths: string[][]): string[] {
  if (!paths.length) return [];
  const out: string[] = [];
  for (let i = 0; paths.every((p) => i < p.length && p[i] === paths[0][i]); i++) out.push(paths[0][i]);
  return out;
}

/** How many different folders the items were picked from. */
export const folderCount = (items: RequestItem[], fallback: string[]) =>
  new Set(items.map((i) => (i.path ?? fallback).join("/"))).size;
