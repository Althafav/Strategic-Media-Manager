import { db } from "@/lib/db";
import { forgetEvents, type EventRow } from "@/lib/events";
import { PERSON_DIST, toVector, unpackEmbedding, type FaceIndexStatus, type Person, type PhotoFace, type ScanResult } from "@/lib/face-types";
import type { NodeRow } from "@/lib/nodes";
import type { ShareRow } from "@/lib/share-types";

/**
 * Face index for "Find my photos" (migration 0023), server-only. Rows are written from a team member's browser
 * (app/faces/actions.ts) and read by the share page's search (app/s/[token]/actions.ts). Only embeddings are
 * stored, never images; a guest's selfie embedding is compared here and dropped.
 */

export const MIGRATION_0023 = "Run supabase/migrations/0023_face_index.sql in the Supabase SQL editor first.";
export const MIGRATION_0024 = "Run supabase/migrations/0024_face_people.sql in the Supabase SQL editor first.";
export const MIGRATION_0025 = "Run supabase/migrations/0025_face_scan.sql in the Supabase SQL editor first.";
const missing = (e: { message?: string; code?: string }) =>
  e.code === "PGRST202" || e.code === "PGRST205" || e.code === "42P01" || e.code === "42883" || /face_|match_faces|unscanned_images/.test(e.message ?? "");

/** Null before migration 0023. */
export async function getFaceIndexStatus(eventId: string): Promise<FaceIndexStatus | null> {
  const { data, error } = await db().rpc("face_index_status", { ev: eventId });
  if (error) {
    if (missing(error)) return null;
    throw error;
  }
  const row = (data as { images: number; scanned: number; faces: number }[])[0];
  return { images: Number(row?.images ?? 0), scanned: Number(row?.scanned ?? 0), faces: Number(row?.faces ?? 0) };
}

export async function unscannedImages(eventId: string, limit: number): Promise<NodeRow[]> {
  const { data, error } = await db().rpc("unscanned_images", { ev: eventId, lim: limit });
  if (error) throw missing(error) ? new Error(MIGRATION_0023) : error;
  return data as NodeRow[];
}

/**
 * Stores scanned photos (replacing earlier faces of the same photos). Ids no longer in the index (deleted since
 * the batch was handed out) are skipped. Returns the number of photos stored.
 */
export async function saveScans(eventId: string, results: ScanResult[]): Promise<number> {
  const ids = [...new Set(results.map((r) => r.id))];
  if (!ids.length) return 0;
  const { data: live, error: liveError } = await db().from("nodes").select("id").eq("event_id", eventId).in("id", ids);
  if (liveError) throw liveError;
  const keep = new Set((live ?? []).map((r) => r.id as string));
  const rows = results.filter((r) => keep.has(r.id));
  if (!rows.length) return 0;

  const faces = rows.flatMap((r) =>
    r.failed
      ? []
      : r.faces.flatMap((f, i) => {
          const v = unpackEmbedding(f.embedding);
          return v ? [{ event_id: eventId, item_id: r.id, face_idx: i, embedding: toVector(v), box: f.box }] : [];
        }),
  );
  const scans = rows.map((r) => ({
    event_id: eventId,
    item_id: r.id,
    faces: r.failed ? -1 : faces.filter((f) => f.item_id === r.id).length,
    scanned_at: new Date().toISOString(),
  }));

  const stored = rows.map((r) => r.id);
  const del = await db().from("face_embeddings").delete().eq("event_id", eventId).in("item_id", stored);
  if (del.error) throw missing(del.error) ? new Error(MIGRATION_0023) : del.error;
  const up = await db().from("face_scans").upsert(scans);
  if (up.error) throw up.error;
  if (faces.length) {
    const ins = await db().from("face_embeddings").insert(faces);
    if (ins.error) {
      // Don't leave these photos marked as scanned without their faces: they'd never be scanned again.
      await db().from("face_scans").delete().eq("event_id", eventId).in("item_id", stored);
      throw ins.error;
    }
    // Group the new faces into people. Best effort: a failure here (or migration 0024 not run yet) must not
    // lose the scan, and the faces are picked up by the next batch's call.
    const grouped = await db().rpc("assign_face_people", { ev: eventId, max_dist: PERSON_DIST });
    if (grouped.error && !missing(grouped.error)) console.error("assign_face_people failed", grouped.error.message);
  }
  return rows.length;
}

/** "Delete face index": drops every scan, face and person of the event (admin only, checked by the caller). */
export async function deleteFaceIndex(eventId: string): Promise<void> {
  const { error } = await db().from("face_scans").delete().eq("event_id", eventId);
  if (error) throw missing(error) ? new Error(MIGRATION_0023) : error;
  // Before migration 0024 there is no people table: nothing to clear.
  await db().from("face_people").delete().eq("event_id", eventId);
}

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

type Box = [number, number, number, number];
type PersonRow = { id: string; name: string | null; hidden: boolean; photos: number; cover_item: string; cover_box: Box };

/** An event's people (migration 0024), most-photographed first. Throws before the migration. */
export async function listPeople(eventId: string, minPhotos = 2): Promise<Person[]> {
  const { data, error } = await db().rpc("list_face_people", { ev: eventId, min_photos: minPhotos });
  if (error) throw error;
  return (data as PersonRow[]).map((r) => ({
    id: r.id,
    name: r.name,
    hidden: r.hidden,
    photos: Number(r.photos),
    cover: { itemId: r.cover_item, box: r.cover_box },
  }));
}

/** One person of the event, or null. `cover` is null when none of their photos are left. */
export async function getPerson(eventId: string, personId: string): Promise<(Omit<Person, "cover" | "photos"> & { cover: Person["cover"] | null }) | null> {
  if (!isUuid(personId)) return null;
  const { data, error } = await db().from("face_people").select("id,name,hidden").eq("event_id", eventId).eq("id", personId).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const faces = await db().from("face_embeddings").select("item_id,box").eq("event_id", eventId).eq("person_id", personId);
  if (faces.error) throw faces.error;
  const area = (b: Box | null) => (b ? b[2] * b[3] : 0);
  const best = (faces.data as { item_id: string; box: Box | null }[]).reduce<{ item_id: string; box: Box | null } | null>(
    (a, b) => (!a || area(b.box) > area(a.box) ? b : a),
    null,
  );
  return { ...(data as { id: string; name: string | null; hidden: boolean }), cover: best?.box ? { itemId: best.item_id, box: best.box } : null };
}

/** The photos a person appears in, newest first. */
export async function personPhotos(eventId: string, personId: string): Promise<NodeRow[]> {
  const faces = await db().from("face_embeddings").select("item_id").eq("event_id", eventId).eq("person_id", personId);
  if (faces.error) throw faces.error;
  const ids = [...new Set((faces.data as { item_id: string }[]).map((f) => f.item_id))];
  const rows: NodeRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const res = await db().from("nodes").select("*").eq("event_id", eventId).in("id", ids.slice(i, i + 200));
    if (res.error) throw res.error;
    rows.push(...(res.data as NodeRow[]));
  }
  const when = (r: NodeRow) => r.taken_at ?? r.modified_at ?? "";
  return rows.sort((a, b) => when(b).localeCompare(when(a)));
}

/** The grouped faces in one photo, left to right. Hidden people are left out unless `includeHidden`. */
export async function itemFaces(eventId: string, itemId: string, includeHidden: boolean): Promise<PhotoFace[]> {
  const faces = await db().from("face_embeddings").select("box,person_id").eq("event_id", eventId).eq("item_id", itemId).not("person_id", "is", null);
  if (faces.error) throw missing(faces.error) || /person_id/.test(faces.error.message) ? new Error(MIGRATION_0024) : faces.error;
  const rows = (faces.data as { box: Box | null; person_id: string }[]).filter((f) => f.box);
  if (!rows.length) return [];
  const ids = [...new Set(rows.map((f) => f.person_id))];
  const [people, counts] = await Promise.all([
    db().from("face_people").select("id,name,hidden").in("id", ids),
    db().from("face_embeddings").select("person_id,item_id").eq("event_id", eventId).in("person_id", ids).limit(10000),
  ]);
  if (people.error) throw people.error;
  if (counts.error) throw counts.error;
  const byId = new Map((people.data as { id: string; name: string | null; hidden: boolean }[]).map((p) => [p.id, p]));
  const photos = new Map<string, Set<string>>();
  for (const c of counts.data as { person_id: string; item_id: string }[]) {
    if (!photos.has(c.person_id)) photos.set(c.person_id, new Set());
    photos.get(c.person_id)!.add(c.item_id);
  }
  return rows
    .filter((f) => byId.has(f.person_id) && (includeHidden || !byId.get(f.person_id)!.hidden))
    .map((f) => ({ personId: f.person_id, name: byId.get(f.person_id)!.name, photos: photos.get(f.person_id)?.size ?? 1, box: f.box! }))
    .sort((a, b) => a.box[0] - b.box[0]);
}

/** Admin only (checked by the caller). An empty name removes it. */
export async function updatePerson(eventId: string, personId: string, change: { name?: string | null; hidden?: boolean }): Promise<void> {
  if (!isUuid(personId)) throw new Error("Person not found.");
  const { error } = await db().from("face_people").update(change).eq("event_id", eventId).eq("id", personId);
  if (error) throw missing(error) ? new Error(MIGRATION_0024) : error;
}

/**
 * Whether the event's photos are face-scanned, with team "Find my photos" and People. Before migration 0025 only
 * the events with guest search on are scanned.
 */
export const scansFaces = (event: EventRow) => event.face_scan ?? !!event.face_search;

/** Admin only (checked by the caller). Guest search needs scanning, so it switches scanning on too. */
export async function setFaceSearch(eventId: string, on: boolean): Promise<void> {
  const { error } = await db().from("events").update({ face_search: on }).eq("id", eventId);
  if (error) throw /face_search/.test(error.message) ? new Error(MIGRATION_0023) : error;
  forgetEvents();
  if (on) await setFaceScan(eventId, true).catch(() => {}); // before 0025, face_search alone means scanning
}

/** Admin only (checked by the caller). Switching scanning off also switches guest search off; the face data is kept. */
export async function setFaceScan(eventId: string, on: boolean): Promise<void> {
  const { error } = await db()
    .from("events")
    .update(on ? { face_scan: true } : { face_scan: false, face_search: false })
    .eq("id", eventId);
  if (error) throw /face_scan/.test(error.message) ? new Error(MIGRATION_0025) : error;
  forgetEvents();
}

const joinPath = (path: string | null, name: string) => (path ? `${path}/${name}` : name);

/** What a share link covers, as match_faces scope arguments. Both null = the whole event. */
async function shareScope(event: EventRow, share: ShareRow): Promise<{ scope_paths: string[] | null; scope_ids: string[] | null }> {
  if (share.item_ids?.length) {
    const { data, error } = await db()
      .from("nodes")
      .select("id,name,kind,path")
      .eq("event_id", event.id)
      .in("id", share.item_ids);
    if (error) throw error;
    const rows = (data ?? []) as Pick<NodeRow, "id" | "name" | "kind" | "path">[];
    return {
      scope_ids: rows.filter((r) => r.kind === "file").map((r) => r.id),
      scope_paths: rows.filter((r) => r.kind === "folder").map((r) => joinPath(r.path, r.name)),
    };
  }
  if (!share.folder_id || share.folder_id === event.root_id) return { scope_paths: null, scope_ids: null };
  const { data } = await db().from("nodes").select("name,path").eq("event_id", event.id).eq("id", share.folder_id).maybeSingle();
  // The index row has the folder's current path; the share's own folder_path is from when it was made.
  const path = data && data.path !== null ? joinPath(data.path, data.name) : share.folder_path.join("/");
  return path ? { scope_paths: [path], scope_ids: null } : { scope_paths: null, scope_ids: null };
}

/** Photos inside the share with a face within `maxDist` of `embedding`, closest first. */
export async function matchShareFaces(
  event: EventRow,
  share: ShareRow,
  embedding: number[],
  maxDist: number,
): Promise<{ row: NodeRow; distance: number }[]> {
  return matchFaces(event, await shareScope(event, share), embedding, maxDist);
}

/** Photos anywhere in the event with a face within `maxDist` of `embedding`, closest first (team members). */
export function matchEventFaces(event: EventRow, embedding: number[], maxDist: number) {
  return matchFaces(event, { scope_paths: null, scope_ids: null }, embedding, maxDist);
}

async function matchFaces(
  event: EventRow,
  scope: { scope_paths: string[] | null; scope_ids: string[] | null },
  embedding: number[],
  maxDist: number,
): Promise<{ row: NodeRow; distance: number }[]> {
  if (scope.scope_ids && !scope.scope_ids.length && scope.scope_paths && !scope.scope_paths.length) return [];
  const { data, error } = await db().rpc("match_faces", {
    ev: event.id,
    q: toVector(embedding),
    max_dist: maxDist,
    lim: 500,
    ...scope,
  });
  if (error) throw missing(error) ? new Error(MIGRATION_0023) : error;
  const hits = data as { item_id: string; distance: number }[];
  if (!hits.length) return [];
  const rows: NodeRow[] = [];
  for (let i = 0; i < hits.length; i += 200) {
    const ids = hits.slice(i, i + 200).map((h) => h.item_id);
    const res = await db().from("nodes").select("*").eq("event_id", event.id).in("id", ids);
    if (res.error) throw res.error;
    rows.push(...(res.data as NodeRow[]));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return hits.flatMap((h) => {
    const row = byId.get(h.item_id);
    return row ? [{ row, distance: h.distance }] : [];
  });
}
