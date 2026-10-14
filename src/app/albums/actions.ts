"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import {
  addToAlbum,
  createAlbum,
  deleteAlbum,
  listOwnAlbums,
  removeFromAlbum,
  renameAlbum,
  setAlbumSharing,
  type AlbumPick,
  type AlbumRow,
} from "@/lib/albums";
import { listVisibleEvents } from "@/lib/events";

const EXPIRED = "Your session has expired. Log in again.";

/** The session's own albums, for the "Add to album" picker (loaded when it opens). */
export async function listOwnAlbumsAction(): Promise<{ albums?: Pick<AlbumRow, "id" | "name">[]; error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  try {
    return { albums: await listOwnAlbums(session) };
  } catch (e) {
    return { error: (e as Error).message || "Could not load your albums." };
  }
}

export type AddToAlbumState = { error?: string; added?: { album: Pick<AlbumRow, "id" | "name">; count: number; at: number } };

/** Adds the picked items to an album, or to a new one when `album` is "new" (named by `name`). */
export async function addToAlbumAction(_prev: AddToAlbumState, form: FormData): Promise<AddToAlbumState> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const picks = pickList(form.get("items"));
  if (!picks) return { error: "Invalid selection." };
  if (!picks.length) return { error: "Select at least one item." };

  let albumId = String(form.get("album") ?? "");
  if (albumId === "new") {
    const created = await createAlbum(session, String(form.get("name") ?? ""));
    if (!created.ok) return { error: created.error };
    albumId = created.album.id;
  }
  const result = await addToAlbum(session, albumId, picks, await listVisibleEvents());
  if (!result.ok) return { error: result.error };
  revalidatePath("/albums");
  return { added: { album: { id: result.album.id, name: result.album.name }, count: result.added, at: Date.now() } };
}

export async function createAlbumAction(_prev: { error?: string }, form: FormData): Promise<{ error?: string; id?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const created = await createAlbum(session, String(form.get("name") ?? ""));
  if (!created.ok) return { error: created.error };
  revalidatePath("/albums");
  return { id: created.album.id };
}

export async function removeFromAlbumAction(albumId: string, refs: { event: string; id: string }[]): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  if (!Array.isArray(refs) || !refs.every((r) => typeof r?.event === "string" && typeof r?.id === "string")) {
    return { error: "Invalid selection." };
  }
  const error = await removeFromAlbum(session, albumId, refs);
  if (error) return { error };
  revalidatePath(`/albums/${albumId}`);
  return {};
}

export async function renameAlbumAction(albumId: string, name: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const error = await renameAlbum(session, albumId, String(name ?? ""));
  if (error) return { error };
  revalidatePath(`/albums/${albumId}`);
  return {};
}

export async function shareAlbumAction(albumId: string, emails: string[]): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  if (!Array.isArray(emails) || !emails.every((e) => typeof e === "string")) return { error: "Pick team members from the list." };
  const error = await setAlbumSharing(session, albumId, emails);
  if (error) return { error };
  revalidatePath(`/albums/${albumId}`);
  return {};
}

export async function deleteAlbumAction(albumId: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const error = await deleteAlbum(session, albumId);
  if (error) return { error };
  revalidatePath("/albums");
  return {};
}

function pickList(value: FormDataEntryValue | null): AlbumPick[] | null {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return null;
    const ok = parsed.every(
      (p) =>
        typeof p?.event === "string" &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        (p.kind === "file" || p.kind === "folder") &&
        Array.isArray(p.path) &&
        p.path.every((s: unknown) => typeof s === "string"),
    );
    return ok ? (parsed as AlbumPick[]) : null;
  } catch {
    return null;
  }
}
