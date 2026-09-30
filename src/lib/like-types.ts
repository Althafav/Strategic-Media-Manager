/** Client-safe like types. */
export type LikeState = { count: number; mine: boolean };

/** Keyed by `itemKey` (`<event slug>/<item id>`). */
export type LikeMap = Record<string, LikeState>;
