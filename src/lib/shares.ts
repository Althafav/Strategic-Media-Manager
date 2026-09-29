import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEvent, listEvents, type EventRow } from "@/lib/events";
import { isExpired, type ShareRow } from "@/lib/share-types";

/**
 * Private view links. The token in `/s/<token>` grants view + download access to
 * one folder subtree, or to a hand-picked set of items (`item_ids`). Media requests made from a shared page carry `t` (the token)
 * and `sig` (an HMAC of token + item id, issued only for items inside the share),
 * so nobody can reach other files by guessing ids.
 */
export { EXPIRY_OPTIONS, isExpired, isItemShare, MAX_SHARE_ITEMS, type ShareRow } from "@/lib/share-types";

// Short in-process cache so thumbnails don't each hit the database; revoke clears it.
const cache = new Map<string, { at: number; value: { share: ShareRow; event: EventRow } | null }>();
const TTL_MS = 15_000;

export async function getActiveShare(token: string): Promise<{ share: ShareRow; event: EventRow } | null> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  const hit = cache.get(token);
  let value = hit && Date.now() - hit.at < TTL_MS ? hit.value : undefined;
  if (value === undefined) {
    const { data, error } = await db().from("shares").select("*").eq("token", token).maybeSingle();
    if (error) throw error;
    const share = data as ShareRow | null;
    const event = share ? (await listEvents({ includeHidden: true })).find((e) => e.id === share.event_id) : null;
    value = share && event ? { share, event } : null;
    if (cache.size > 1000) cache.clear();
    cache.set(token, { at: Date.now(), value });
  }
  return value && !isExpired(value.share) ? value : null;
}

export async function createShare(input: {
  eventSlug: string;
  folderId: string | null;
  /** Share just these items instead of the whole folder. */
  itemIds?: string[];
  folderPath: string[];
  folderName: string;
  label: string;
  expiry: string;
  /** shareOwner() of the session creating it. */
  createdBy: string;
}): Promise<ShareRow> {
  const event = await getEvent(input.eventSlug);
  if (!event) throw new Error("Event not found.");
  const days = Number(input.expiry);
  const expires_at = input.expiry === "never" || !days ? null : new Date(Date.now() + days * 86_400_000).toISOString();
  const { data, error } = await db()
    .from("shares")
    .insert({
      token: randomBytes(18).toString("base64url"),
      event_id: event.id,
      folder_id: input.folderId,
      folder_path: input.folderPath,
      folder_name: input.folderName,
      ...(input.itemIds?.length ? { item_ids: input.itemIds } : {}),
      label: input.label.trim().slice(0, 120) || null,
      expires_at,
      created_by: input.createdBy,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as ShareRow;
}

/** `createdBy` limits the list to one owner's links (team members); omit it for the admin's view of all. */
export async function listShares(filter: { eventId?: string; folderId?: string; createdBy?: string } = {}): Promise<ShareRow[]> {
  let query = db().from("shares").select("*").order("created_at", { ascending: false });
  if (filter.createdBy) query = query.eq("created_by", filter.createdBy);
  if (filter.eventId) query = query.eq("event_id", filter.eventId);
  if (filter.folderId) query = query.eq("folder_id", filter.folderId);
  const { data, error } = await query;
  if (error) throw error;
  return data as ShareRow[];
}

/** With `createdBy`, only deletes the link if that owner made it. Returns false when nothing was deleted. */
export async function deleteShare(id: string, createdBy?: string): Promise<boolean> {
  let query = db().from("shares").delete().eq("id", id);
  if (createdBy) query = query.eq("created_by", createdBy);
  const { data, error } = await query.select("token");
  if (error) throw error;
  for (const row of data ?? []) cache.delete(row.token);
  return !!data?.length;
}

/** What `created_by` stores for a session. */
export function shareOwner(session: Session): string {
  return session.role === "admin" ? "admin" : session.email!;
}

/** The owner filter for listing/revoking: none for the admin (sees all), the user's own email otherwise. */
export function ownerFilter(session: Session): string | undefined {
  return session.role === "admin" ? undefined : shareOwner(session);
}

export async function recordView(token: string) {
  await db().rpc("touch_share", { tok: token });
}

/** One download from a share link (a file, or a zip of `files` files). Fails before migration 0006; callers ignore that. */
export async function recordDownload(token: string, files = 1) {
  const { error } = await db().rpc("record_share_download", { tok: token, files });
  if (error) throw error;
}

function signingKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET must be set to use share links.");
  return secret;
}

export function signItem(token: string, id: string): string {
  return createHmac("sha256", signingKey()).update(`share:${token}:${id}`).digest("base64url").slice(0, 22);
}

export function verifyItem(token: string, id: string, sig: string | null): boolean {
  if (!sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(signItem(token, id));
  return a.length === b.length && timingSafeEqual(a, b);
}
