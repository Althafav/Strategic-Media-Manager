import { cookies } from "next/headers";
import type { Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { appBaseUrl } from "@/lib/sso";
import { listEvents, type EventRow } from "@/lib/events";
import { thumbSrc } from "@/lib/format";
import { nodeToItem, type NodeRow } from "@/lib/nodes";
import { isValidId } from "@/lib/onedrive/client";
import type { MediaItem } from "@/lib/onedrive/types";
import {
  MAX_REQUEST_ITEMS,
  MAX_REQUEST_LENGTH,
  type PhotoRequestRow,
  type RequestItem,
  type RequestStatus,
} from "@/lib/request-types";
import { formatDate } from "@/lib/share-types";
import { shareOwner } from "@/lib/shares";

/**
 * Photo requests (table photo_requests, migrations 0011-0013). Server-only.
 * A team member asks for photos from an event; the event's coordinator (events.coordinator_email, set by the admin)
 * sees them in the /requests Inbox and answers with a status and a note. The admin sees and can answer every request.
 */
export { STATUS_LABEL, type PhotoRequestRow, type RequestItem, type RequestStatus } from "@/lib/request-types";

const OPEN: RequestStatus[] = ["pending", "in_progress"];
const ANSWERED: RequestStatus[] = ["fulfilled", "declined"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  input: { event: EventRow; message: string; folderPath: string[]; items?: RequestItem[] },
): Promise<CreateRequestResult> {
  const items = input.items?.length ? input.items : null;
  if (items && items.length > MAX_REQUEST_ITEMS) return { ok: false, error: `A request can hold up to ${MAX_REQUEST_ITEMS} items.` };
  if (items && !items.every((i) => isValidId(i.id))) return { ok: false, error: "Invalid selection." };
  // With picked photos the message is optional.
  const message = input.message.trim() || (items ? `Requested ${items.length} selected ${items.length === 1 ? "item" : "items"}.` : "");
  if (!message) return { ok: false, error: "Describe the photos you need." };
  if (message.length > MAX_REQUEST_LENGTH) return { ok: false, error: `Keep the message under ${MAX_REQUEST_LENGTH} characters.` };
  if (!input.event.coordinator_email) return { ok: false, error: "This event has no coordinator yet. Ask the admin to assign one." };

  const owner = shareOwner(session);
  if (items) {
    const duplicate = await openRequestCovering(owner, input.event.id, items.map((i) => i.id));
    if (duplicate) {
      return { ok: false, error: `You already requested these on ${formatDate(duplicate.created_at)}, and that request is still open. See Requests.` };
    }
  }

  const { data: created, error } = await db()
    .from("photo_requests")
    .insert({
      event_id: input.event.id,
      requested_by: owner,
      message,
      folder_path: input.folderPath.slice(0, 50),
      // Only sent when there are items, so message-only requests keep working before migration 0012.
      ...(items
        ? { items: items.map(({ id, name, kind, path }) => ({ id, name: name.slice(0, 300), kind, ...(path ? { path } : {}) })) }
        : {}),
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: migrationHint(error.message) ?? error.message };

  // Notify the coordinator. Best-effort: the request is already saved, so a mail failure doesn't fail it.
  const base = await appBaseUrl();
  // The email API's firewall rejects bodies containing a localhost URL, so dev submissions go out without the link.
  const href = `${base}/requests/${created.id}`;
  const link = /^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(base) ? "" : `<p><a href="${escapeHtml(href)}">View and answer the request</a></p>`;
  await sendEmail({
    to: input.event.coordinator_email,
    subject: `Photo request for ${input.event.title}`,
    body:
      `<p>${escapeHtml(session.email ?? "The admin")} requested photos from ${escapeHtml(input.event.title)}:</p>` +
      `<p>${escapeHtml(message).replace(/\r?\n/g, "<br>")}</p>${link}`,
  });
  return { ok: true };
}

/** An open request by this owner, in this event, that already holds every one of `ids`. */
async function openRequestCovering(owner: string, eventId: string, ids: string[]): Promise<PhotoRequestRow | null> {
  const { data, error } = await db()
    .from("photo_requests")
    .select("*")
    .eq("requested_by", owner)
    .eq("event_id", eventId)
    .in("status", OPEN)
    .not("items", "is", null)
    .limit(200);
  if (error) return null; // a convenience check: never block a request because it failed
  return (
    (data as PhotoRequestRow[]).find((r) => {
      const held = new Set(r.items?.map((i) => i.id));
      return ids.every((id) => held.has(id));
    }) ?? null
  );
}

/**
 * Requests for the events this session coordinates: every open one (oldest first, so nothing waits unnoticed)
 * and the latest answered ones.
 */
export async function listAssigned(session: Session): Promise<{ open: PhotoRequestRow[]; answered: PhotoRequestRow[] }> {
  const ids = await handledEventIds(session);
  if (ids?.length === 0) return { open: [], answered: [] };
  const scoped = (statuses: RequestStatus[]) => {
    const query = db().from("photo_requests").select("*").in("status", statuses);
    return ids ? query.in("event_id", ids) : query;
  };
  const [open, answered] = await Promise.all([
    scoped(OPEN).order("created_at", { ascending: true }),
    scoped(ANSWERED).order("resolved_at", { ascending: false }).limit(100),
  ]);
  if (open.error) throw open.error;
  if (answered.error) throw answered.error;
  return { open: open.data as PhotoRequestRow[], answered: answered.data as PhotoRequestRow[] };
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

/** One request, if this session may see it: the requester, the event's coordinator, or the admin. */
export async function getRequest(session: Session, id: string): Promise<{ request: PhotoRequestRow; event: EventRow } | null> {
  if (!UUID.test(id)) return null;
  const { data, error } = await db().from("photo_requests").select("*").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const request = data as PhotoRequestRow;
  const event = (await listEvents({ includeHidden: true })).find((e) => e.id === request.event_id);
  if (!event) return null;
  return request.requested_by === shareOwner(session) || canHandle(session, event) ? { request, event } : null;
}

/**
 * When this browser last opened the Inbox. Kept in a cookie rather than the database because the admin and the
 * coordinator see the same requests, and one of them opening the Inbox mustn't clear the other's badge.
 */
export const INBOX_SEEN_COOKIE = "smm_inbox_seen";

export async function inboxSeenAt(): Promise<string | undefined> {
  const value = (await cookies()).get(INBOX_SEEN_COOKIE)?.value;
  return value && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}

/** New (unanswered) requests waiting for this session, only those sent after `since` when given (the header badge). */
export async function pendingCountFor(session: Session, since?: string): Promise<number> {
  const ids = await handledEventIds(session);
  if (ids?.length === 0) return 0;
  let query = db().from("photo_requests").select("id", { count: "exact", head: true }).eq("status", "pending");
  if (ids) query = query.in("event_id", ids);
  if (since) query = query.gt("created_at", since);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

/** This session's requests answered since they last opened Sent (migration 0013). Part of the header badge. */
export async function unseenAnswersFor(session: Session): Promise<number> {
  const { data, error } = await db().rpc("unseen_request_answers", { owner: shareOwner(session) });
  if (error) throw error;
  return Number(data ?? 0);
}

/** The requester has now seen every answer so far (migration 0013). */
export async function markSentSeen(session: Session): Promise<void> {
  const { error } = await db()
    .from("photo_requests")
    .update({ requester_seen_at: new Date().toISOString() })
    .eq("requested_by", shareOwner(session))
    .in("status", ANSWERED);
  if (error) throw error;
}

/** The requester has seen the answer to this one request (opened its page). */
export async function markRequestSeen(session: Session, id: string): Promise<void> {
  if (!UUID.test(id)) return;
  const { error } = await db()
    .from("photo_requests")
    .update({ requester_seen_at: new Date().toISOString() })
    .eq("id", id)
    .eq("requested_by", shareOwner(session))
    .in("status", ANSWERED);
  if (error) throw error;
}

/** Only the admin or the event's coordinator may answer. Returns an error message, or null on success. */
export async function updateRequest(
  session: Session,
  input: { id: string; status: RequestStatus; note: string },
): Promise<string | null> {
  const note = input.note.trim();
  if (note.length > MAX_REQUEST_LENGTH) return `Keep the note under ${MAX_REQUEST_LENGTH} characters.`;
  if (!UUID.test(input.id)) return "Request not found. It may have been removed.";

  const { data: row, error: readErr } = await db().from("photo_requests").select("event_id").eq("id", input.id).maybeSingle();
  if (readErr) return readErr.message;
  const event = row && (await listEvents({ includeHidden: true })).find((e) => e.id === row.event_id);
  if (!event) return "Request not found. It may have been removed.";
  if (!canHandle(session, event)) return "Only this event's coordinator can answer this request.";

  const now = new Date().toISOString();
  const done = ANSWERED.includes(input.status);
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

/**
 * Removes an answered request for everyone: the requester, the event's coordinator or the admin may do it. Open
 * requests can't be deleted (decline them first). Returns an error message, or null on success.
 */
export async function deleteRequest(session: Session, id: string): Promise<string | null> {
  if (!UUID.test(id)) return "Request not found. It may have been removed.";
  const { data: row, error: readErr } = await db()
    .from("photo_requests")
    .select("event_id, status, requested_by")
    .eq("id", id)
    .maybeSingle();
  if (readErr) return readErr.message;
  if (!row) return "Request not found. It may have been removed.";
  const event = (await listEvents({ includeHidden: true })).find((e) => e.id === row.event_id);
  const allowed = row.requested_by === shareOwner(session) || (!!event && canHandle(session, event));
  if (!allowed) return "Only the requester or this event's coordinator can delete this request.";
  if (!ANSWERED.includes(row.status as RequestStatus)) return "Only answered requests can be deleted.";

  // Status filter again: if someone reopened it meanwhile, nothing is deleted.
  const { error } = await db().from("photo_requests").delete().eq("id", id).in("status", ANSWERED);
  return error ? error.message : null;
}

const VIDEO_EXT =/\.(mp4|mov|m4v|avi|mkv|webm|wmv|mts|3gp)$/i;

/**
 * The picked items of each request as gallery items, so the gallery and lightbox can show them. Details come from
 * the search index; items it doesn't have yet (not synced) fall back to what the request stored. Keyed by request id.
 */
export async function requestMedia(rows: PhotoRequestRow[], events: EventRow[]): Promise<Map<string, MediaItem[]>> {
  const slugById = new Map(events.map((e) => [e.id, e.slug]));
  const ids = [...new Set(rows.flatMap((r) => r.items?.map((i) => i.id) ?? []))];
  const nodes = new Map<string, NodeRow>();
  for (let i = 0; i < ids.length; i += 150) {
    const { data } = await db().from("nodes").select("*").in("id", ids.slice(i, i + 150));
    for (const n of (data ?? []) as NodeRow[]) nodes.set(`${n.event_id}/${n.id}`, n);
  }

  const out = new Map<string, MediaItem[]>();
  for (const r of rows) {
    const event = slugById.get(r.event_id);
    if (!event || !r.items?.length) continue;
    out.set(
      r.id,
      r.items.map((i) => {
        // Where the item lives: the index knows best, then the folder stored with the pick, then the request's folder.
        const location = i.path ?? r.folder_path;
        const node = nodes.get(`${r.event_id}/${i.id}`);
        if (node) return node.path == null ? { ...nodeToItem(node, event), location } : nodeToItem(node, event);
        const isVideo = i.kind === "file" && VIDEO_EXT.test(i.name);
        const ref = { event, id: i.id };
        return {
          id: i.id,
          event,
          name: i.name,
          kind: i.kind,
          size: 0,
          isImage: i.kind === "file" && !isVideo,
          isVideo,
          thumb: i.kind === "file" ? thumbSrc(ref, 400) : undefined,
          preview: i.kind === "file" ? thumbSrc(ref, 1920) : undefined,
          location,
        };
      }),
    );
  }
  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function migrationHint(message: string): string | null {
  if (/items/.test(message)) {
    return "Requesting selected photos needs supabase/migrations/0012_photo_request_items.sql. Run it in the Supabase SQL editor.";
  }
  return /photo_requests|coordinator_email/.test(message)
    ? "Photo requests need supabase/migrations/0011_photo_requests.sql. Run it in the Supabase SQL editor."
    : null;
}
