"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { setFolderCover } from "@/lib/covers";
import { getEvent } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import { getFolder, isValidId } from "@/lib/onedrive/client";

/** Admin only: makes `itemId` the cover of `folderId`, or clears the pick (`itemId` null). */
export async function setFolderCoverAction(eventSlug: string, folderId: string, itemId: string | null): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!isValidId(folderId) || (itemId !== null && !isValidId(itemId))) return { error: "Invalid item." };
  const event = await getEvent(eventSlug);
  if (!event) return { error: "Event not found." };
  if (itemId) {
    // Only an image directly inside the folder can be its cover.
    const { items } = await getFolder(event.share_url, [], folderId);
    if (!items.some((i) => i.id === itemId && i.kind === "file" && i.isImage)) return { error: "That photo isn't in this folder." };
  }
  try {
    await setFolderCover(event.id, folderId, itemId, "admin");
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (/folder_covers/.test(message)) {
      return { error: "Covers need supabase/migrations/0016_folder_covers.sql. Run it in the Supabase SQL editor." };
    }
    return { error: message || "Could not save the cover." };
  }
  revalidatePath(`/e/${encodeURIComponent(event.slug)}`, "layout");
  return {};
}

export type CoverBrowse = {
  folders: { id: string; name: string; childCount: number }[];
  images: { id: string; name: string; thumb: string }[];
  /** Images past the first page aren't sent; the picker says so. */
  more: number;
};

const PICKER_IMAGES = 200;

/** Admin only: one folder of an event (its root when `folderId` is null) for the Settings cover picker. */
export async function browseEventCoverAction(slug: string, folderId: string | null): Promise<CoverBrowse | { error: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (folderId !== null && !isValidId(folderId)) return { error: "Invalid folder." };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found." };
  try {
    const { items } = folderId ? await getFolder(event.share_url, [], folderId) : await getFolder(event.share_url, []);
    const images = items.filter((i) => i.kind === "file" && i.isImage);
    return {
      folders: items.filter((i) => i.kind === "folder").map((i) => ({ id: i.id, name: i.name, childCount: i.childCount ?? 0 })),
      images: images.slice(0, PICKER_IMAGES).map((i) => ({ id: i.id, name: i.name, thumb: thumbSrc({ event: slug, id: i.id }, 300) })),
      more: Math.max(0, images.length - PICKER_IMAGES),
    };
  } catch (e) {
    return { error: (e as Error).message || "Could not open the folder." };
  }
}

/**
 * Admin only: the event's cover (its root folder's cover), picked from any folder of the event.
 * `folderId` is where the photo was picked, used to check the photo belongs to the event. `itemId` null clears it.
 */
export async function setEventCoverAction(slug: string, folderId: string | null, itemId: string | null): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if ((folderId !== null && !isValidId(folderId)) || (itemId !== null && !isValidId(itemId))) return { error: "Invalid item." };
  const event = await getEvent(slug);
  if (!event?.root_id) return { error: "Event not found." };
  if (itemId) {
    const { items } = folderId ? await getFolder(event.share_url, [], folderId) : await getFolder(event.share_url, []);
    if (!items.some((i) => i.id === itemId && i.kind === "file" && i.isImage)) return { error: "That photo isn't in this event." };
  }
  try {
    await setFolderCover(event.id, event.root_id, itemId, "admin");
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (/folder_covers/.test(message)) {
      return { error: "Covers need supabase/migrations/0016_folder_covers.sql. Run it in the Supabase SQL editor." };
    }
    return { error: message || "Could not save the cover." };
  }
  revalidatePath("/");
  revalidatePath("/settings");
  return {};
}
