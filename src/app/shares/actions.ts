"use server";

import { getSession } from "@/lib/auth";
import { isValidId } from "@/lib/onedrive/client";
import { getVisibleEvent } from "@/lib/events";
import { isExpired, isItemShare, type LinkOption } from "@/lib/share-types";
import { addShareItems, createShare, deleteShare, EXPIRY_OPTIONS, listShares, MAX_SHARE_ITEMS, ownerFilter, shareOwner, type ShareRow } from "@/lib/shares";

const EXPIRED = "Your session has expired. Log in again.";

export type CreateShareState = {
  error?: string;
  created?: ShareRow;
  /** Items were added to an existing link instead. `at` makes each result distinct. */
  added?: { token: string; name: string; count: number; skipped: number; at: number };
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The picked-items links of one event that the Share dialog can add to: your own, or all of them for the admin. */
export async function listOwnItemLinksAction(eventSlug: string): Promise<{ links: LinkOption[] }> {
  const session = await getSession();
  const event = session && (await getVisibleEvent(eventSlug));
  // Private events: only the admin shares, so nobody else is offered a link to add to.
  if (!session || !event || (event.hidden && session.role !== "admin")) return { links: [] };
  const shares = await listShares({ eventId: event.id, createdBy: ownerFilter(session) }).catch(() => []);
  return {
    links: shares
      .filter((s) => isItemShare(s) && !isExpired(s))
      .map((s) => ({ id: s.id, name: s.label || s.folder_name, count: s.item_ids!.length })),
  };
}

export async function createShareLink(_prev: CreateShareState, form: FormData): Promise<CreateShareState> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  if (form.get("consent") !== "yes") {
    return { error: "Tick the box to confirm you take responsibility for sharing these files." };
  }

  const folderId = String(form.get("folderId") ?? "");
  const expiry = String(form.get("expiry") ?? "30");
  const folderPath = stringList(form.get("folderPath"));
  const itemIds = form.has("itemIds") ? [...new Set(stringList(form.get("itemIds")))] : null;
  if (itemIds) {
    if (!itemIds.length) return { error: "Select at least one item." };
    if (itemIds.length > MAX_SHARE_ITEMS) return { error: `A link can hold up to ${MAX_SHARE_ITEMS} items.` };
    if (!itemIds.every(isValidId)) return { error: "Invalid selection." };
    if (folderId && !isValidId(folderId)) return { error: "Invalid folder." };
  } else if (!isValidId(folderId)) return { error: "Invalid folder." };

  // "Add to a link you made" in the Share dialog: same consent and checks, no new link.
  const addTo = String(form.get("addTo") ?? "");
  if (addTo) {
    if (!itemIds || !UUID.test(addTo)) return { error: "Invalid selection." };
    // Only from an event this person can open (private events, canSeeEvent).
    const event = await getVisibleEvent(String(form.get("event") ?? ""));
    if (!event) return { error: "Event not found." };
    try {
      const result = await addShareItems({
        id: addTo,
        itemIds,
        event,
        createdBy: ownerFilter(session),
        allImages: form.get("allImages") === "yes",
      });
      if (!result.ok) return { error: result.error };
      const { share, added } = result;
      return { added: { token: share.token, name: share.label || share.folder_name, count: added, skipped: itemIds.length - added, at: Date.now() } };
    } catch (e) {
      return { error: (e as Error).message || "Could not add to the link." };
    }
  }

  if (!EXPIRY_OPTIONS.some((o) => o.value === expiry)) return { error: "Pick when the link expires." };
  const label = String(form.get("label") ?? "").trim();
  if (!label) return { error: "Say who this link is for." };

  try {
    const created = await createShare({
      eventSlug: String(form.get("event") ?? ""),
      folderId: folderId || null,
      itemIds: itemIds ?? undefined,
      folderPath,
      folderName: String(form.get("folderName") ?? "").slice(0, 200) || "Shared folder",
      label,
      expiry,
      createdBy: shareOwner(session),
    });
    return { created };
  } catch (e) {
    const message = (e as Error).message ?? "";
    if (/created_by/.test(message)) {
      return { error: "Share links need supabase/migrations/0008_share_owner.sql. Run it in the Supabase SQL editor." };
    }
    // item_ids / nullable folder_id arrive with migration 0004.
    if (itemIds && /item_ids|folder_id/.test(message)) {
      return { error: "Sharing selected items needs supabase/migrations/0004_share_items.sql. Run it in the Supabase SQL editor." };
    }
    return { error: message || "Could not create the link." };
  }
}

function stringList(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch {}
  return [];
}

/** Team members can revoke only their own links; the admin can revoke any. Revoked links go to the admin's recycle bin. */
export async function revokeShareLink(id: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  try {
    const removed = await deleteShare(id, ownerFilter(session), shareOwner(session));
    return removed ? {} : { error: "Link not found, or it was created by someone else." };
  } catch (e) {
    return { error: (e as Error).message || "Could not revoke the link." };
  }
}
