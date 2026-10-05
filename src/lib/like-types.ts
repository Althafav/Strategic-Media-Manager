/** Client-safe like types. */
export type LikeState = {
  count: number;
  mine: boolean;
  /** Admin only: who liked it, as display names in like order. Never sent to team members. */
  by?: string[];
};

/** Keyed by `itemKey` (`<event slug>/<item id>`). */
export type LikeMap = Record<string, LikeState>;

/** How the password login's likes are named in `by`. */
export const ADMIN_LIKER = "Admin";
