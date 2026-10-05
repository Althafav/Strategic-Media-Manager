import { db } from "@/lib/db";
import { ADMIN_LIKER, type LikeMap } from "@/lib/like-types";
import { listUsers } from "@/lib/users";

/**
 * Photo likes (migration 0010). Server-only. `owner` is `shareOwner(session)`: "admin" or the SSO email.
 * Reads fail soft so galleries still render before the migration runs.
 */

/**
 * Like counts for one event, keyed by `itemKey` (`<slug>/<id>`). A whole event's likes are small: team size × liked photos.
 * `withLikers` (admin only) also fills `by`.
 */
export async function getEventLikes(eventId: string, slug: string, owner: string, withLikers = false): Promise<LikeMap> {
  const [{ data, error }, names] = await Promise.all([
    db().from("photo_likes").select("item_id,owner").eq("event_id", eventId).order("liked_at"),
    withLikers ? likerNames() : null,
  ]);
  if (error) return {};
  const likes: LikeMap = {};
  for (const row of data as { item_id: string; owner: string }[]) {
    const like = (likes[`${slug}/${row.item_id}`] ??= { count: 0, mine: false });
    like.count++;
    if (row.owner === owner) like.mine = true;
    if (names) (like.by ??= []).push(likerName(row.owner, names));
  }
  return likes;
}

/** Admin only: who liked each of these items, as display names in like order, keyed `event_id/item_id`. */
export async function likersOf(itemIds: string[], eventId?: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!itemIds.length) return out;
  let query = db().from("photo_likes").select("event_id,item_id,owner").in("item_id", itemIds).order("liked_at");
  if (eventId) query = query.eq("event_id", eventId);
  const [{ data, error }, names] = await Promise.all([query, likerNames()]);
  if (error) throw error;
  for (const row of data as { event_id: string; item_id: string; owner: string }[]) {
    const key = `${row.event_id}/${row.item_id}`;
    out.set(key, [...(out.get(key) ?? []), likerName(row.owner, names)]);
  }
  return out;
}

/** Email → the name the admin gave the user. Empty before migration 0007, so likers show as emails. */
async function likerNames(): Promise<Map<string, string>> {
  const users = await listUsers().catch(() => []);
  return new Map(users.filter((u) => u.name).map((u) => [u.email, u.name!]));
}

function likerName(owner: string, names: Map<string, string>): string {
  return owner === "admin" ? ADMIN_LIKER : (names.get(owner) ?? owner);
}

/** Sets or clears one person's like (idempotent), then returns the item's new count. */
export async function setLike(eventId: string, itemId: string, owner: string, like: boolean): Promise<number> {
  const table = db().from("photo_likes");
  const { error } = like
    ? await table.upsert({ event_id: eventId, item_id: itemId, owner }, { ignoreDuplicates: true })
    : await table.delete().match({ event_id: eventId, item_id: itemId, owner });
  if (error) throw error;
  const { count, error: countError } = await db()
    .from("photo_likes")
    .select("*", { count: "exact", head: true })
    .match({ event_id: eventId, item_id: itemId });
  if (countError) throw countError;
  return count ?? 0;
}

export type TopLiked = { event_id: string; item_id: string; likes: number };

export async function topLiked(eventId?: string, limit = 100): Promise<TopLiked[]> {
  const { data, error } = await db().rpc("top_liked", { ev: eventId ?? null, lim: limit });
  if (error) throw error;
  return (data as TopLiked[]).map((r) => ({ ...r, likes: Number(r.likes) }));
}

/** Which of these items `owner` has liked, as `event_id/item_id` keys. */
export async function likedByOwner(owner: string, itemIds: string[]): Promise<Set<string>> {
  if (!itemIds.length) return new Set();
  const { data } = await db().from("photo_likes").select("event_id,item_id").eq("owner", owner).in("item_id", itemIds);
  return new Set((data ?? []).map((r) => `${r.event_id}/${r.item_id}`));
}
