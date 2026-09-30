import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { listEvents, type EventRow } from "@/lib/events";
import { MAX_REQUEST_LENGTH, type PhotoRequestRow, type RequestStatus } from "@/lib/request-types";
import { shareOwner } from "@/lib/shares";

/**
 * Photo requests (table photo_requests, migration 0011). Server-only.
 * A team member asks for photos from an event; the event's coordinator (events.coordinator_email, set by the admin)
 * sees them in /requests and answers with a status and a note. The admin sees and can answer every request.
 */
export { STATUS_LABEL, type PhotoRequestRow, type RequestStatus } from "@/lib/request-types";

/** Whether this session coordinates the event: the admin, or the user the admin assigned. */
export function canHandle(session: Session, event: Pick<EventRow, "coordinator_email">): boolean {
  return session.role === "admin" || (!!session.email && event.coordinator_email === session.email);
}

/** Ids of the events whose requests this session handles; null means all (the admin). */
async function handledEventIds(session: Session): Promise<string[] | null> {
  if (session.role === "admin") return null;
  return (await listEvents({ includeHidden: true })).filter((e) => canHandle(session, e)).map((e) => e.id);
}

export async function isCoordinator(session: Session): Promise<boolean> {
  const ids = await handledEventIds(session);
  return ids === null || ids.length > 0;
}

export type CreateRequestResult = { ok: true } | { ok: false; error: string };

export async function createRequest(
  session: Session,
  input: { event: EventRow; message: string; folderPath: string[] },
): Promise<CreateRequestResult> {
  const message = input.message.trim();
  if (!message) return { ok: false, error: "Describe the photos you need." };
  if (message.length > MAX_REQUEST_LENGTH) return { ok: false, error: `Keep the message under ${MAX_REQUEST_LENGTH} characters.` };
  if (!input.event.coordinator_email) return { ok: false, error: "This event has no coordinator yet. Ask the admin to assign one." };

  const { error } = await db()
    .from("photo_requests")
    .insert({
      event_id: input.event.id,
      requested_by: shareOwner(session),
      message,
      folder_path: input.folderPath.slice(0, 50),
    });
  if (error) return { ok: false, error: migrationHint(error.message) ?? error.message };
  return { ok: true };
}

/** Requests for the events this session coordinates, newest first. */
export async function listAssigned(session: Session): Promise<PhotoRequestRow[]> {
  const ids = await handledEventIds(session);
  if (ids?.length === 0) return [];
  let query = db().from("photo_requests").select("*").order("created_at", { ascending: false }).limit(500);
  if (ids) query = query.in("event_id", ids);
  const { data, error } = await query;
  if (error) throw error;
  return data as PhotoRequestRow[];
}

/** Requests this session made, newest first. */
export async function listMine(session: Session): Promise<PhotoRequestRow[]> {
  const { data, error } = await db()
    .from("photo_requests")
    .select("*")
    .eq("requested_by", shareOwner(session))
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return data as PhotoRequestRow[];
}

/** New (unanswered) requests waiting for this session. Drives the header badge. */
export async function pendingCountFor(session: Session): Promise<number> {
  const ids = await handledEventIds(session);
  if (ids?.length === 0) return 0;
  let query = db().from("photo_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (ids) query = query.in("event_id", ids);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** Only the admin or the event's coordinator may answer. Returns an error message, or null on success. */
export async function updateRequest(
  session: Session,
  input: { id: string; status: RequestStatus; note: string },
): Promise<string | null> {
  const note = input.note.trim();
  if (note.length > MAX_REQUEST_LENGTH) return `Keep the note under ${MAX_REQUEST_LENGTH} characters.`;

  const { data: row, error: readErr } = await db().from("photo_requests").select("event_id").eq("id", input.id).maybeSingle();
  if (readErr) return readErr.message;
  const event = row && (await listEvents({ includeHidden: true })).find((e) => e.id === row.event_id);
  if (!event) return "Request not found. It may have been removed.";
  if (!canHandle(session, event)) return "Only this event's coordinator can answer this request.";

  const now = new Date().toISOString();
  const done = input.status === "fulfilled" || input.status === "declined";
  const { error } = await db()
    .from("photo_requests")
    .update({
      status: input.status,
      coordinator_note: note || null,
      updated_at: now,
      resolved_at: done ? now : null,
      resolved_by: done ? shareOwner(session) : null,
    })
    .eq("id", input.id);
  return error ? error.message : null;
}

function migrationHint(message: string): string | null {
  return /photo_requests|coordinator_email/.test(message)
    ? "Photo requests need supabase/migrations/0011_photo_requests.sql. Run it in the Supabase SQL editor."
    : null;
}
