"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { checkAdminKey } from "@/lib/admin";
import { requireSession } from "@/lib/auth";
import { createEvent, deleteEvent, getEvent } from "@/lib/events";
import { runDeltaSync, SyncBusyError } from "@/lib/sync/delta-sync";
import { describeSyncError } from "@/lib/sync/status";

export type AddEventState = { error?: string; values?: { title: string; shareUrl: string } };

export async function addEvent(_prev: AddEventState, form: FormData): Promise<AddEventState> {
  const title = String(form.get("title") ?? "");
  const shareUrl = String(form.get("shareUrl") ?? "");
  const values = { title, shareUrl };

  const denied = (await requireSession()) ?? checkAdminKey(form.get("adminKey"));
  if (denied) return { error: denied, values };
  if (!title.trim()) return { error: "Give the event a name.", values };

  const result = await createEvent({ title, shareUrl });
  if (!result.ok) return { error: result.error, values };

  // Index the new event for search in the background; the cron resumes it if this is cut short.
  const event = result.event;
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
  const denied = (await requireSession()) ?? checkAdminKey(form.get("adminKey"));
  if (denied) return { error: denied };
  const removed = await deleteEvent(String(form.get("slug") ?? ""));
  if (!removed) return { error: "Event not found. It may already have been removed." };
  redirect("/");
}
