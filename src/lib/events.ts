import { getSession, type Session } from "@/lib/auth";
import { db } from "@/lib/db";
import { inspectShare } from "@/lib/onedrive/client";
import { isSupportedShareUrl } from "@/lib/onedrive/session";

export type EventRow = {
  id: string;
  slug: string;
  title: string;
  share_url: string;
  root_id: string | null;
  root_name: string | null;
  item_count: number | null;
  size: number | null;
  sort: number;
  hidden: boolean;
  created_at: string;
  /** Marketing coordinator for photo requests (migration 0011): an app_users email, at most one per event. */
  coordinator_email?: string | null;
  /** Private events (`hidden`): app_users emails, besides the admin, who may see it (migration 0019). */
  viewer_emails?: string[];
};

let cached: { at: number; rows: EventRow[] } | null = null;
const TTL_MS = 30_000;

export async function listEvents({ includeHidden = false } = {}): Promise<EventRow[]> {
  if (!cached || Date.now() - cached.at > TTL_MS) {
    const { data, error } = await db()
      .from("events")
      .select("*")
      .order("sort", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw error;
    cached = { at: Date.now(), rows: data as EventRow[] };
  }
  return includeHidden ? cached.rows : cached.rows.filter((e) => !e.hidden);
}

export async function getEvent(slug: string): Promise<EventRow | null> {
  return (await listEvents({ includeHidden: true })).find((e) => e.slug === slug) ?? null;
}

/**
 * Private events (`hidden`) are seen by the admin and the listed viewers only. A viewer removed from app_users stays
 * in `viewer_emails`: their session is rejected anyway, and adding them back restores their access.
 * Share links are not filtered here: an existing link to a private event keeps working.
 */
export function canSeeEvent(event: EventRow, session: Session | null): boolean {
  if (!session) return false;
  if (!event.hidden || session.role === "admin") return true;
  return !!session.email && (event.viewer_emails ?? []).includes(session.email.toLowerCase());
}

/** Events the logged-in viewer may see, private ones included when allowed. Use for team-facing pages. */
export async function listVisibleEvents(): Promise<EventRow[]> {
  const session = await getSession();
  return (await listEvents({ includeHidden: true })).filter((e) => canSeeEvent(e, session));
}

/** Like getEvent, but null when the logged-in viewer may not see the event. Use for team-facing reads by slug. */
export async function getVisibleEvent(slug: string): Promise<EventRow | null> {
  const event = await getEvent(slug);
  return event && canSeeEvent(event, await getSession()) ? event : null;
}

export type CreateEventResult = { ok: true; event: EventRow } | { ok: false; error: string };

/** Validates the share link by actually opening it, then stores the event (optionally private, see canSeeEvent). */
export async function createEvent(input: {
  title: string;
  shareUrl: string;
  hidden?: boolean;
  viewerEmails?: string[];
}): Promise<CreateEventResult> {
  const title = input.title.trim().slice(0, 120);
  const shareUrl = normalizeShareUrl(input.shareUrl);
  if (!shareUrl || !isSupportedShareUrl(shareUrl)) {
    return {
      ok: false,
      error: "Paste a OneDrive / SharePoint folder link (https://…sharepoint.com/:f:/…) shared with “Anyone with the link”.",
    };
  }

  const existing = await db().from("events").select("slug,title").eq("share_url", shareUrl).maybeSingle();
  if (existing.data) return { ok: false, error: `This link is already added as “${existing.data.title}”.` };

  let facts;
  try {
    facts = await inspectShare(shareUrl);
  } catch {
    return {
      ok: false,
      error: "Couldn’t open that link. Make sure it is a folder shared with “Anyone with the link” and that it hasn’t expired.",
    };
  }

  const { data, error } = await db()
    .from("events")
    .insert({
      slug: await uniqueSlug(title || facts.rootName),
      title: title || facts.rootName,
      share_url: shareUrl,
      root_id: facts.rootId,
      root_name: facts.rootName,
      item_count: facts.itemCount,
      size: facts.size,
      ...(input.hidden ? { hidden: true, viewer_emails: input.viewerEmails ?? [] } : {}),
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: /viewer_emails/.test(error.message) ? MIGRATION_0019 : error.message };
  await db().from("event_sync").insert({ event_id: data.id });
  cached = null;
  return { ok: true, event: data as EventRow };
}

/**
 * Removes an event from the app together with its search index rows
 * (cascade). Files in OneDrive are never touched.
 */
export async function deleteEvent(slug: string): Promise<boolean> {
  const { data, error } = await db().from("events").delete().eq("slug", slug).select("id");
  if (error) throw error;
  cached = null;
  return !!data?.length;
}

/** Admin only (checked by the caller). Changes the display name only; the slug (and so every link) stays the same. */
export async function renameEvent(eventId: string, title: string): Promise<void> {
  const { error } = await db().from("events").update({ title: title.trim().slice(0, 120) }).eq("id", eventId);
  cached = null;
  if (error) throw error;
}

/**
 * Admin only (checked by the caller). Stores the display order: ids[0] first. Starts at 1 so a newly added
 * event (default sort 0) shows first. Events not listed keep their current sort.
 */
export async function reorderEvents(ids: string[]): Promise<void> {
  const results = await Promise.all(ids.map((id, i) => db().from("events").update({ sort: i + 1 }).eq("id", id)));
  cached = null;
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

/** Admin only (checked by the caller). One coordinator per event: setting a new one replaces the old; null clears it. */
export async function setCoordinator(eventId: string, email: string | null): Promise<void> {
  const { error } = await db().from("events").update({ coordinator_email: email }).eq("id", eventId);
  cached = null;
  if (error) {
    if (/coordinator_email/.test(error.message)) {
      throw new Error("Run supabase/migrations/0011_photo_requests.sql in the Supabase SQL editor first.");
    }
    throw error;
  }
}

const MIGRATION_0019 = "Run supabase/migrations/0019_private_events.sql in the Supabase SQL editor first.";

/** Admin only (checked by the caller). Private: only the admin and `viewerEmails` see the event. Public clears the list. */
export async function setEventPrivacy(eventId: string, hidden: boolean, viewerEmails: string[]): Promise<void> {
  const { error } = await db()
    .from("events")
    .update({ hidden, viewer_emails: hidden ? viewerEmails : [] })
    .eq("id", eventId);
  cached = null;
  if (error) throw /viewer_emails/.test(error.message) ? new Error(MIGRATION_0019) : error;
}

/** Drops tracking query params (xsdata, sdata, ovuser…) that personalise the link. */
function normalizeShareUrl(value: string): string | null {
  try {
    const u = new URL(value.trim());
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

async function uniqueSlug(title: string): Promise<string> {
  const base =
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "event";
  const { data } = await db().from("events").select("slug").like("slug", `${base}%`);
  const taken = new Set((data ?? []).map((r) => r.slug));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}
