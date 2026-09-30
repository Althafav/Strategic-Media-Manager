"use server";

import { getSession } from "@/lib/auth";
import { getEvent } from "@/lib/events";
import type { LikeState } from "@/lib/like-types";
import { setLike } from "@/lib/likes";
import { isValidId } from "@/lib/onedrive/client";
import { shareOwner } from "@/lib/shares";

/** Team only: share-link visitors have no session. `like` is the wanted state, so repeated clicks can't double-count. */
export async function setLikeAction(eventSlug: string, itemId: string, like: boolean): Promise<LikeState | { error: string }> {
  const session = await getSession();
  if (!session) return { error: "Your session has expired. Log in again." };
  if (!isValidId(itemId)) return { error: "Invalid item." };
  const event = await getEvent(eventSlug);
  if (!event) return { error: "Event not found." };
  try {
    return { count: await setLike(event.id, itemId, shareOwner(session), like), mine: like };
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (/photo_likes/.test(message)) {
      return { error: "Likes need supabase/migrations/0010_photo_likes.sql. Run it in the Supabase SQL editor." };
    }
    return { error: message || "Could not save the like." };
  }
}
