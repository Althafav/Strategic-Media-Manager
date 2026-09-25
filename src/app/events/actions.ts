"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { checkAdminKey } from "@/lib/admin";
import { requireSession } from "@/lib/auth";
import { createEvent, deleteEvent } from "@/lib/events";
import { runDeltaSync } from "@/lib/sync/delta-sync";

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

export type RemoveEventState = { error?: string };

/** Removes the event and its search index. Files in OneDrive are not touched. */
export async function removeEvent(_prev: RemoveEventState, form: FormData): Promise<RemoveEventState> {
  const denied = (await requireSession()) ?? checkAdminKey(form.get("adminKey"));
  if (denied) return { error: denied };
  const removed = await deleteEvent(String(form.get("slug") ?? ""));
  if (!removed) return { error: "Event not found. It may already have been removed." };
  redirect("/");
}
