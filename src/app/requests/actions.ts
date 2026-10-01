"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { getEvent } from "@/lib/events";
import { isRequestStatus, type RequestItem } from "@/lib/request-types";
import { createRequest, updateRequest } from "@/lib/requests";

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
