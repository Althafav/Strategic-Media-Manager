/** Client-safe album types and limits (the queries live in albums.ts, which is server-only). */
export type AlbumRow = {
  id: string;
  name: string;
  /** shareOwner() of the creator: "admin" or the SSO user's email. */
  created_by: string;
  /** Team members' emails who may open and download the album (not change it). */
  shared_with: string[];
  created_at: string;
  updated_at: string;
};

/** An album with its item count, for lists. */
export type AlbumSummary = AlbumRow & { count: number };

export const MAX_ALBUM_ITEMS = 1000;
export const MAX_ALBUM_NAME = 120;
/** Picks sent in one "Add to album" (the selection bar's limit is the album's). */
export type AlbumPick = { event: string; id: string; name: string; kind: "file" | "folder"; path: string[] };
