"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin, requireSession } from "@/lib/auth";
import { createEvent, deleteEvent, getEvent, listEvents, renameEvent, reorderEvents, setCoordinator } from "@/lib/events";
import { isAllowedUser, normalizeEmail } from "@/lib/users";
import { runDeltaSync, SyncBusyError } from "@/lib/sync/delta-sync";
import { describeSyncError } from "@/lib/sync/status";

export type AddEventState = { error?: string; values?: { title: string; shareUrl: string; coordinator: string } };

export async function addEvent(_prev: AddEventState, form: FormData): Promise<AddEventState> {
  const title = String(form.get("title") ?? "");
  const shareUrl = String(form.get("shareUrl") ?? "");
  const coordinator = normalizeEmail(String(form.get("coordinator") ?? ""));
  const values = { title, shareUrl, coordinator };

  const denied = await requireAdmin();
  if (denied) return { error: denied, values };
  if (!title.trim()) return { error: "Give the event a name.", values };
  if (coordinator && !(await isAllowedUser(coordinator))) return { error: "Pick an active user from the Users list.", values };

  const result = await createEvent({ title, shareUrl });
  if (!result.ok) return { error: result.error, values };

  // Index the new event for search in the background; the cron resumes it if this is cut short.
  const event = result.event;
  // Optional. The event is already saved, so a failure here (e.g. migration 0011 not run) only skips the coordinator.
  if (coordinator) await setCoordinator(event.id, coordinator).catch((e) => console.error(`Coordinator not set for ${event.slug}`, e));
  after(() => runDeltaSync(event).catch((e) => console.error(`Initial sync failed for ${event.slug}`, e)));

  redirect(`/e/${encodeURIComponent(event.slug)}`);
}

export type SyncEventState = { message?: string; error?: string };

/**
 * Brings one event's search index up to date. Only reads OneDrive, so any logged-in member may run it.
 * Waits briefly (an incremental sync usually takes seconds); a long first pass continues in the background.
 */
export async function syncEvent(_prev: SyncEventState, form: FormData): Promise<SyncEventState> {
  const denied = await requireSession();
  if (denied) return { error: denied };
  const event = await getEvent(String(form.get("slug") ?? ""));
  if (!event) return { error: "Event not found. It may have been removed." };

  try {
    const r = await runDeltaSync(event, { budgetMs: 20_000 });
    if (!r.complete) {
      after(() => runDeltaSync(event).catch((e) => console.error(`Background sync failed for ${event.slug}`, e)));
      return { message: "Still indexing. It continues in the background." };
    }
    const changes = r.upserted + r.deleted;
    return { message: changes ? "Search index updated." : "Already up to date." };
  } catch (e) {
    if (e instanceof SyncBusyError) return { error: "A sync is already running for this event. Try again in a few minutes." };
    return { error: `Sync failed: ${describeSyncError((e as Error).message)}` };
  } finally {
    revalidatePath("/");
  }
}

export type RemoveEventState = { error?: string };

/** Removes the event and its search index. Files in OneDrive are not touched. */
export async function removeEvent(_prev: RemoveEventState, form: FormData): Promise<RemoveEventState> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const removed = await deleteEvent(String(form.get("slug") ?? ""));
  if (!removed) return { error: "Event not found. It may already have been removed." };
  redirect("/");
}

/** Assigns (or clears, with an empty email) the event's marketing coordinator. Admin only; must be an active user. */
export async function setEventCoordinator(slug: string, email: string): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  const coordinator = email ? normalizeEmail(email) : null;
  if (coordinator && !(await isAllowedUser(coordinator))) return { error: "Pick an active user from the Users list." };
  try {
    await setCoordinator(event.id, coordinator);
  } catch (e) {
    return { error: (e as Error).message || "Could not change the coordinator." };
  }
  revalidatePath("/");
  revalidatePath("/settings");
  revalidatePath(`/e/${encodeURIComponent(slug)}`, "layout");
  return {};
}

/** Renames the event (display name only; its URL doesn't change). Admin only. */
export async function renameEventAction(slug: string, title: string): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!title.trim()) return { error: "Give the event a name." };
  const event = await getEvent(slug);
  if (!event) return { error: "Event not found. It may have been removed." };
  try {
    await renameEvent(event.id, title);
  } catch (e) {
    return { error: (e as Error).message || "Could not rename the event." };
  }
  revalidatePath("/", "layout");
  return {};
}

/** Saves the display order of events (slugs in the new order, first = top). Admin only. */
export async function reorderEventsAction(slugs: string[]): Promise<{ error?: string }> {
  const denied = await requireAdmin();
  if (denied) return { error: denied };
  if (!Array.isArray(slugs) || new Set(slugs).size !== slugs.length) return { error: "Invalid order." };
  const bySlug = new Map((await listEvents({ includeHidden: true })).map((e) => [e.slug, e.id]));
  const ids = slugs.map((s) => bySlug.get(s));
  if (ids.some((id) => !id)) return { error: "An event was removed. Reload the page and try again." };
  try {
    await reorderEvents(ids as string[]);
  } catch (e) {
    return { error: (e as Error).message || "Could not save the order." };
  }
  revalidatePath("/", "layout");
  return {};
}
