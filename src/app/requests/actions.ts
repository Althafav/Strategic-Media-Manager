"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth";
import { getEvent } from "@/lib/events";
import { isRequestStatus, type RequestItem } from "@/lib/request-types";
import { createRequest, deleteRequest, INBOX_SEEN_COOKIE, markRequestSeen, markSentSeen, updateRequest } from "@/lib/requests";

const EXPIRED = "Your session has expired. Log in again.";

export type CreateRequestState = { error?: string; sent?: number; values?: { message: string } };

export async function createRequestAction(_prev: CreateRequestState, form: FormData): Promise<CreateRequestState> {
  const message = String(form.get("message") ?? "");
  const values = { message };
  const session = await getSession();
  if (!session) return { error: EXPIRED, values };
  const event = await getEvent(String(form.get("event") ?? ""));
  if (!event) return { error: "Event not found. It may have been removed.", values };

  const result = await createRequest(session, {
    event,
    message,
    folderPath: stringList(form.get("folderPath")),
    items: itemList(form.get("items")),
  });
  if (!result.ok) return { error: result.error, values };
  revalidatePath("/requests");
  return { sent: Date.now() };
}

/**
 * Clears what the viewer has just seen from the header badge: the Inbox up to the newest request it showed
 * (`inboxUpTo`), every answer on the Sent tab (`sent`), or the answer to one request (`id`).
 */
export async function markRequestsSeenAction(seen: { inboxUpTo?: string; sent?: boolean; id?: string }): Promise<void> {
  const session = await getSession();
  if (!session) return;
  const upTo = Date.parse(String(seen.inboxUpTo ?? ""));
  // +1ms: Postgres keeps microseconds, so the newest request must not count as newer than itself. Never ahead of
  // now, so a forged value can't hide requests that arrive later.
  if (!Number.isNaN(upTo)) {
    (await cookies()).set(INBOX_SEEN_COOKIE, new Date(Math.min(upTo + 1, Date.now())).toISOString(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  if (seen.sent) await markSentSeen(session).catch(() => {});
  if (seen.id) await markRequestSeen(session, String(seen.id)).catch(() => {});
  // No revalidate: refreshing would drop the page's "New reply" highlights. The badge clears client-side (MarkSeen).
}

export async function deleteRequestAction(id: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  const error = await deleteRequest(session, String(id));
  if (error) return { error };
  revalidatePath("/requests");
  return {};
}

export async function updateRequestAction(id: string, status: string, note: string): Promise<{ error?: string }> {
  const session = await getSession();
  if (!session) return { error: EXPIRED };
  if (!isRequestStatus(status)) return { error: "Pick a status." };
  const error = await updateRequest(session, { id: String(id), status, note: String(note ?? "") });
  if (error) return { error };
  revalidatePath("/requests");
  return {};
}

function stringList(value: FormDataEntryValue | null): string[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (Array.isArray(parsed) && parsed.every((s) => typeof s === "string")) return parsed;
  } catch {}
  return [];
}

function itemList(value: FormDataEntryValue | null): RequestItem[] {
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((i): RequestItem[] => {
      if (!i || typeof i.id !== "string" || typeof i.name !== "string") return [];
      const path =
        Array.isArray(i.path) && i.path.length <= 20 && i.path.every((p: unknown) => typeof p === "string" && p.length <= 255)
          ? (i.path as string[])
          : undefined;
      return [{ id: i.id, name: i.name, kind: i.kind === "folder" ? "folder" : "file", ...(path ? { path } : {}) }];
    });
  } catch {
    return [];
  }
}
