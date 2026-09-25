"use server";

import { requireSession } from "@/lib/auth";
import { isValidId } from "@/lib/onedrive/client";
import { createShare, deleteShare, EXPIRY_OPTIONS, MAX_SHARE_ITEMS, type ShareRow } from "@/lib/shares";

export type CreateShareState = { error?: string; created?: ShareRow };

export async function createShareLink(_prev: CreateShareState, form: FormData): Promise<CreateShareState> {
  const denied = await requireSession();
  if (denied) return { error: denied };

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
  if (!EXPIRY_OPTIONS.some((o) => o.value === expiry)) return { error: "Pick when the link expires." };

  try {
    const created = await createShare({
      eventSlug: String(form.get("event") ?? ""),
      folderId: folderId || null,
      itemIds: itemIds ?? undefined,
      folderPath,
      folderName: String(form.get("folderName") ?? "").slice(0, 200) || "Shared folder",
      label: String(form.get("label") ?? ""),
      expiry,
    });
    return { created };
  } catch (e) {
    const message = (e as Error).message ?? "";
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

export async function revokeShareLink(id: string): Promise<{ error?: string }> {
  const denied = await requireSession();
  if (denied) return { error: denied };
  try {
    await deleteShare(id);
    return {};
  } catch (e) {
    return { error: (e as Error).message || "Could not revoke the link." };
  }
}
