"use server";

import { revalidatePath } from "next/cache";
import { getSession, requireAdmin } from "@/lib/auth";
import { getEvent, getVisibleEvent, listEvents, type EventRow } from "@/lib/events";
import { EMBEDDING_DIM, LOOSE_DIST, MAX_FACES_PER_PHOTO, MAX_PERSON_NAME, unpackEmbedding, type FaceIndexStatus, type PhotoFace, type ScanResult } from "@/lib/face-types";
import {
  MIGRATION_0024,
  deleteFaceIndex,
  getFaceIndexStatus,
  itemFaces,
  matchEventFaces,
  saveScans,
  scansFaces,
  setFaceScan,
  setFaceSearch,
  unscannedImages,
  updatePerson,
} from "@/lib/face-index";
import type { FaceMatch } from "@/app/s/[token]/actions";
import { nodeToItem } from "@/lib/nodes";
import { isValidId } from "@/lib/onedrive/client";
import type { MediaItem } from "@/lib/onedrive/types";

/** Only the admin builds the face index. Null when the viewer may not. */
async function indexer(slug: string): Promise<EventRow | null> {
  const session = await getSession();
  if (session?.role !== "admin") return null;
  return getEvent(slug);
}

const DENIED = "Only the admin can scan faces.";

export async function faceIndexStatusAction(slug: string): Promise<{ status?: FaceIndexStatus; error?: string }> {
  const event = await indexer(slug);
  if (!event) return { error: DENIED };
  const status = await getFaceIndexStatus(event.id).catch(() => null);
  return status ? { status } : { error: "Run supabase/migrations/0023_face_index.sql in the Supabase SQL editor first." };
}

/** The next photos to scan, newest first, with /api/thumb previews (team session, no share token). */
export async function nextUnscannedAction(slug: string): Promise<{ items?: MediaItem[]; error?: string }> {
  const event = await indexer(slug);
  if (!event) return { error: DENIED };
  if (!scansFaces(event)) return { items: [] };
  try {
    return { items: (await unscannedImages(event.id, 24)).map((r) => nodeToItem(r, event.slug)) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const isFraction = (n: unknown) => typeof n === "number" && n >= 0 && n <= 1;

export async function saveFacesAction(slug: string, results: ScanResult[]): Promise<{ saved?: number; error?: string }> {
  const event = await indexer(slug);
  if (!event) return { error: DENIED };
  if (!Array.isArray(results) || results.length > 50) return { error: "Too many photos in one batch." };
  const clean = results.filter(
    (r) =>
      r &&
      isValidId(r.id) &&
      Array.isArray(r.faces) &&
      r.faces.length <= MAX_FACES_PER_PHOTO &&
      r.faces.every(
        (f) =>
          typeof f.embedding === "string" &&
          // base64 of EMBEDDING_DIM float32s
          f.embedding.length === Math.ceil((EMBEDDING_DIM * 4) / 3) * 4 &&
          Array.isArray(f.box) &&
          f.box.length === 4 &&
          f.box.every(isFraction),
      ),
  );
  if (clean.length !== results.length) return { error: "Some scan results were malformed." };
  try {
    return { saved: await saveScans(event.id, clean.map((r) => ({ id: r.id, faces: r.faces, failed: !!r.failed }))) };
  } catch (e) {
    const message = (e as Error).message ?? "";
    // The table still has the old 1024-number column: the new model's faces don't fit until 0024 runs.
    return { error: /dimensions/.test(message) ? MIGRATION_0024 : message };
  }
}

/** "Find my photos" for team members: photos in the event with a face like the embedding (never stored). */
export async function findMyPhotosTeamAction(slug: string, embedding: string): Promise<{ matches?: FaceMatch[]; error?: string }> {
  if (!(await getSession())) return { error: "Please sign in again." };
  const event = await getVisibleEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  if (!scansFaces(event)) return { error: "Face search is off for this event." };
  const v = unpackEmbedding(embedding);
  if (!v) return { error: "That face couldn't be read. Try another photo." };
  try {
    const hits = await matchEventFaces(event, v, LOOSE_DIST);
    return { matches: hits.map(({ row, distance }) => ({ item: nodeToItem(row, event.slug), distance })) };
  } catch (e) {
    return { error: (e as Error).message || "Face search isn't working right now. Try again in a moment." };
  }
}

/**
 * What the background scanner has left to do: events switched on for face search with photos not scanned yet, in
 * the app's event order. Admin only.
 */
export async function faceScanQueueAction(): Promise<{ events?: { slug: string; title: string; left: number }[] }> {
  const session = await getSession();
  if (session?.role !== "admin") return {};
  const events = (await listEvents({ includeHidden: true }).catch(() => [])).filter(scansFaces);
  const queue = await Promise.all(
    events.map(async (e) => {
      // Null before migration 0023, or when the count fails: nothing to scan.
      const status = await getFaceIndexStatus(e.id).catch(() => null);
      return { slug: e.slug, title: e.title, left: status ? Math.max(0, status.images - status.scanned) : 0 };
    }),
  );
  return { events: queue.filter((e) => e.left > 0) };
}

/** The grouped faces in one photo, for the lightbox's "People in this photo". Team members only. */
export async function itemFacesAction(slug: string, itemId: string): Promise<{ faces?: PhotoFace[] }> {
  const session = await getSession();
  if (!session || !isValidId(itemId)) return {};
  const event = await getVisibleEvent(slug);
  if (!event || !scansFaces(event)) return {};
  return { faces: await itemFaces(event.id, itemId, session.role === "admin").catch(() => []) };
}

/** Admin only: names a person on the People page (an empty name removes it). */
export async function renamePersonAction(slug: string, personId: string, name: string): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  const clean = String(name ?? "").trim().replace(/\s+/g, " ");
  if (clean.length > MAX_PERSON_NAME) return { error: `Keep the name under ${MAX_PERSON_NAME} characters.` };
  try {
    await updatePerson(event.id, personId, { name: clean || null });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return {};
}

/** Admin only: hides a person from the team's People view (or shows them again). */
export async function setPersonHiddenAction(slug: string, personId: string, hidden: boolean): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  try {
    await updatePerson(event.id, personId, { hidden: !!hidden });
  } catch (e) {
    return { error: (e as Error).message };
  }
  return {};
}

/** Admin only: face scanning, team "Find my photos" and People for one event. Off keeps the faces already found. */
export async function setFaceScanAction(slug: string, on: boolean): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  try {
    await setFaceScan(event.id, on);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Admin only: show or hide "Find my photos" on the event's share links (switches face search on too). */
export async function setFaceSearchAction(slug: string, on: boolean): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  try {
    await setFaceSearch(event.id, on);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Admin only: deletes the event's face index (it can be scanned again later). */
export async function deleteFaceIndexAction(slug: string): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  try {
    await deleteFaceIndex(event.id);
  } catch (e) {
    return { error: (e as Error).message };
  }
  revalidatePath("/settings");
  return {};
}
