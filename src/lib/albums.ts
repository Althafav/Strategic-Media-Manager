import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { listEvents, type EventRow } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import { pickedItem, type NodeRow } from "@/lib/nodes";
import { isImagePath } from "@/lib/image-compress";
import { isValidId } from "@/lib/onedrive/client";
import type { MediaItem } from "@/lib/onedrive/types";
import { shareOwner } from "@/lib/shares";
import { listUsers, normalizeEmail } from "@/lib/users";
import { MAX_ALBUM_ITEMS, MAX_ALBUM_NAME, type AlbumPick, type AlbumRow, type AlbumSummary } from "@/lib/album-types";

/**
 * Albums (tables albums + album_items, migration 0021). Server-only.
 * A team member's own collection of picked items, from any events and folders; nothing is copied in OneDrive.
 * Only the owner (created_by = shareOwner) changes an album. Team members listed in shared_with may open and download
 * it. Every reader still needs to see the item's event (canSeeEvent): items from private events they can't see are
 * left out, so albums never widen access.
 */
export { MAX_ALBUM_ITEMS, type AlbumPick, type AlbumRow, type AlbumSummary } from "@/lib/album-types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ALBUMS_MIGRATION = "Albums need supabase/migrations/0021_albums.sql. Run it in the Supabase SQL editor.";
const NOT_FOUND = "Album not found. It may have been deleted.";

type AlbumItemRow = { event_id: string; item_id: string; name: string; kind: "file" | "folder"; path: string[]; added_at: string };

const migrationError = (e: { message?: string } | null) => (e && /album/.test(e.message ?? "") ? new Error(ALBUMS_MIGRATION) : e);

export const isAlbumOwner = (session: Session, album: Pick<AlbumRow, "created_by">) => album.created_by === shareOwner(session);

export function canOpenAlbum(session: Session, album: Pick<AlbumRow, "created_by" | "shared_with">): boolean {
  return isAlbumOwner(session, album) || (!!session.email && album.shared_with.includes(session.email.toLowerCase()));
}

const withCount = (rows: (AlbumRow & { album_items?: { count: number }[] })[]): AlbumSummary[] =>
  rows.map(({ album_items, ...a }) => ({ ...a, count: album_items?.[0]?.count ?? 0 }));

/** The viewer's own albums and the ones shared with them, most recently changed first. */
export async function listAlbums(session: Session): Promise<{ own: AlbumSummary[]; shared: AlbumSummary[] }> {
  const select = "*, album_items(count)";
  const [own, shared] = await Promise.all([
    db().from("albums").select(select).eq("created_by", shareOwner(session)).order("updated_at", { ascending: false }),
    session.email
      ? db().from("albums").select(select).contains("shared_with", [session.email.toLowerCase()]).order("updated_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (own.error || shared.error) throw migrationError(own.error ?? shared.error);
  return { own: withCount(own.data ?? []), shared: withCount(shared.data ?? []) };
}

/** Just the viewer's own albums (id + name), for the "Add to album" picker. */
export async function listOwnAlbums(session: Session): Promise<Pick<AlbumRow, "id" | "name">[]> {
  const { data, error } = await db()
    .from("albums")
    .select("id, name")
    .eq("created_by", shareOwner(session))
    .order("updated_at", { ascending: false });
  if (error) throw migrationError(error);
  return data ?? [];
}

/** The album if this viewer may open it (owner or shared with), else null. */
export async function getAlbum(session: Session, id: string): Promise<AlbumRow | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db().from("albums").select("*").eq("id", id).maybeSingle();
  if (error) throw migrationError(error);
  return data && canOpenAlbum(session, data as AlbumRow) ? (data as AlbumRow) : null;
}

/**
 * The album's items as gallery items, in the order they were added, limited to `events` (the viewer's visible
 * events). `hidden` counts the items left out because the viewer can't see their event.
 */
export async function albumMedia(albumId: string, events: EventRow[]): Promise<{ items: MediaItem[]; hidden: number }> {
  const { data, error } = await db()
    .from("album_items")
    .select("event_id, item_id, name, kind, path, added_at")
    .eq("album_id", albumId)
    .order("added_at", { ascending: true })
    .limit(MAX_ALBUM_ITEMS);
  if (error) throw migrationError(error);
  const rows = (data ?? []) as AlbumItemRow[];
  const slugById = new Map(events.map((e) => [e.id, e.slug]));
  const visible = rows.filter((r) => slugById.has(r.event_id));

  const nodes = new Map<string, NodeRow>();
  const ids = [...new Set(visible.map((r) => r.item_id))];
  for (let i = 0; i < ids.length; i += 150) {
    const { data: found } = await db().from("nodes").select("*").in("id", ids.slice(i, i + 150));
    for (const n of (found ?? []) as NodeRow[]) nodes.set(`${n.event_id}/${n.id}`, n);
  }

  const items = visible.map((r) =>
    pickedItem({ id: r.item_id, name: r.name, kind: r.kind }, slugById.get(r.event_id)!, r.path, nodes.get(`${r.event_id}/${r.item_id}`)),
  );
  return { items, hidden: rows.length - visible.length };
}

/** A cover thumbnail per album: its first photo the viewer may see. Keyed by album id. */
export async function albumCovers(albumIds: string[], events: EventRow[]): Promise<Record<string, string>> {
  const slugById = new Map(events.map((e) => [e.id, e.slug]));
  const out: Record<string, string> = {};
  await Promise.all(
    albumIds.map(async (id) => {
      const { data } = await db()
        .from("album_items")
        .select("event_id, item_id, name")
        .eq("album_id", id)
        .eq("kind", "file")
        .order("added_at", { ascending: true })
        .limit(20);
      const first = (data ?? []).find((r) => slugById.has(r.event_id) && isImagePath(r.name));
      if (first) out[id] = thumbSrc({ event: slugById.get(first.event_id)!, id: first.item_id }, 400);
    }),
  );
  return out;
}

export type AlbumResult = { ok: true; album: AlbumRow } | { ok: false; error: string };

function cleanAlbumName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, MAX_ALBUM_NAME);
}

export async function createAlbum(session: Session, name: string): Promise<AlbumResult> {
  const clean = cleanAlbumName(name);
  if (!clean) return { ok: false, error: "Give the album a name." };
  const { data, error } = await db().from("albums").insert({ name: clean, created_by: shareOwner(session) }).select("*").single();
  if (error) return { ok: false, error: migrationError(error)?.message ?? "Could not create the album." };
  return { ok: true, album: data as AlbumRow };
}

/** The album if this session owns it; the error to show otherwise. */
async function ownedAlbum(session: Session, id: string): Promise<AlbumResult> {
  if (!UUID.test(id)) return { ok: false, error: NOT_FOUND };
  const { data, error } = await db().from("albums").select("*").eq("id", id).maybeSingle();
  if (error) return { ok: false, error: migrationError(error)?.message ?? NOT_FOUND };
  if (!data) return { ok: false, error: NOT_FOUND };
  if (!isAlbumOwner(session, data as AlbumRow)) return { ok: false, error: "Only the person who made this album can change it." };
  return { ok: true, album: data as AlbumRow };
}

const touch = (id: string) => db().from("albums").update({ updated_at: new Date().toISOString() }).eq("id", id);

/**
 * Adds picks to one of the session's albums. `visibleEvents` are the events this session may see: picks from any
 * other event are refused. Items already in the album are skipped. Returns how many were new.
 */
export async function addToAlbum(
  session: Session,
  albumId: string,
  picks: AlbumPick[],
  visibleEvents: EventRow[],
): Promise<{ ok: true; album: AlbumRow; added: number } | { ok: false; error: string }> {
  if (!picks.length) return { ok: false, error: "Select at least one item." };
  if (picks.length > MAX_ALBUM_ITEMS) return { ok: false, error: `An album can hold up to ${MAX_ALBUM_ITEMS} items.` };
  if (!picks.every((p) => isValidId(p.id))) return { ok: false, error: "Invalid selection." };
  const idBySlug = new Map(visibleEvents.map((e) => [e.slug, e.id]));
  if (!picks.every((p) => idBySlug.has(p.event))) return { ok: false, error: "Some items come from an event you can't open." };

  const owned = await ownedAlbum(session, albumId);
  if (!owned.ok) return owned;

  const rows = [
    ...new Map(
      picks.map((p) => [
        `${p.event}/${p.id}`,
        {
          album_id: albumId,
          event_id: idBySlug.get(p.event)!,
          item_id: p.id,
          name: p.name.slice(0, 300),
          kind: p.kind,
          path: p.path.slice(0, 50).map((s) => s.slice(0, 300)),
        },
      ]),
    ).values(),
  ];

  const { count, error: countErr } = await db()
    .from("album_items")
    .select("item_id", { count: "exact", head: true })
    .eq("album_id", albumId);
  if (countErr) return { ok: false, error: migrationError(countErr)?.message ?? "Could not add to the album." };
  // Worst case: none of the picks are in the album yet.
  if ((count ?? 0) + rows.length > MAX_ALBUM_ITEMS) {
    return { ok: false, error: `An album can hold up to ${MAX_ALBUM_ITEMS} items. It has ${count} already; select fewer.` };
  }

  const { data, error } = await db()
    .from("album_items")
    .upsert(rows, { onConflict: "album_id,event_id,item_id", ignoreDuplicates: true })
    .select("item_id");
  if (error) return { ok: false, error: migrationError(error)?.message ?? "Could not add to the album." };
  await touch(albumId);
  return { ok: true, album: owned.album, added: data?.length ?? 0 };
}

/** Takes items out of the session's album (`refs` carry event slugs). Nothing in OneDrive changes. */
export async function removeFromAlbum(session: Session, albumId: string, refs: { event: string; id: string }[]): Promise<string | null> {
  const owned = await ownedAlbum(session, albumId);
  if (!owned.ok) return owned.error;
  const idBySlug = new Map((await listEvents({ includeHidden: true })).map((e) => [e.slug, e.id]));
  const byEvent = new Map<string, string[]>();
  for (const r of refs) {
    const eventId = idBySlug.get(r.event);
    if (eventId && isValidId(r.id)) byEvent.set(eventId, [...(byEvent.get(eventId) ?? []), r.id]);
  }
  for (const [eventId, ids] of byEvent) {
    const { error } = await db().from("album_items").delete().eq("album_id", albumId).eq("event_id", eventId).in("item_id", ids);
    if (error) return error.message;
  }
  await touch(albumId);
  return null;
}

export async function renameAlbum(session: Session, albumId: string, name: string): Promise<string | null> {
  const clean = cleanAlbumName(name);
  if (!clean) return "Give the album a name.";
  const owned = await ownedAlbum(session, albumId);
  if (!owned.ok) return owned.error;
  const { error } = await db().from("albums").update({ name: clean, updated_at: new Date().toISOString() }).eq("id", albumId);
  return error?.message ?? null;
}

/** Deletes the album for everyone it was shared with. The photos stay in OneDrive. */
export async function deleteAlbum(session: Session, albumId: string): Promise<string | null> {
  const owned = await ownedAlbum(session, albumId);
  if (!owned.ok) return owned.error;
  const { error } = await db().from("albums").delete().eq("id", albumId);
  return error?.message ?? null;
}

/** Sets who else may open the album: active team members only (not the owner). */
export async function setAlbumSharing(session: Session, albumId: string, emails: string[]): Promise<string | null> {
  const owned = await ownedAlbum(session, albumId);
  if (!owned.ok) return owned.error;
  const active = new Set((await listUsers()).filter((u) => u.status !== "pending").map((u) => u.email));
  const wanted = [...new Set(emails.map(normalizeEmail))].filter((e) => e !== session.email?.toLowerCase());
  // People removed from Users since they were added stay allowed to be unticked, but can't be added anew.
  const kept = wanted.filter((e) => active.has(e) || owned.album.shared_with.includes(e));
  if (kept.length !== wanted.length) return "Pick team members from the list.";
  const { error } = await db()
    .from("albums")
    .update({ shared_with: kept.slice(0, 200), updated_at: new Date().toISOString() })
    .eq("id", albumId);
  return error?.message ?? null;
}
