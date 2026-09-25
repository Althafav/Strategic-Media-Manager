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

export type CreateEventResult = { ok: true; event: EventRow } | { ok: false; error: string };

/** Validates the share link by actually opening it, then stores the event. */
export async function createEvent(input: { title: string; shareUrl: string }): Promise<CreateEventResult> {
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
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
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
