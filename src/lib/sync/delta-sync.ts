import { db } from "@/lib/db";
import type { EventRow } from "@/lib/events";
import { cameraName, drive, SELECT, type DriveItem } from "@/lib/onedrive/client";
import { getSession } from "@/lib/onedrive/session";

type DeltaPage = { value: (DriveItem & { deleted?: object; parentReference?: { id?: string } })[] } & {
  "@odata.nextLink"?: string;
  "@odata.deltaLink"?: string;
};

export type SyncResult = { upserted: number; deleted: number; pages: number; complete: boolean };

/** Another run holds this event's lock. Nothing was changed. */
export class SyncBusyError extends Error {
  constructor() {
    super("A sync is already running for this event.");
  }
}

/**
 * Takes the event's sync lease. Returns false when another run holds it.
 * Before migration 0005 there is no lock column, so syncs run unlocked as before.
 */
async function acquireLock(eventId: string, ms: number): Promise<{ ok: boolean; release: () => Promise<void> }> {
  const now = new Date();
  const { data, error } = await db()
    .from("event_sync")
    .update({ locked_until: new Date(now.getTime() + ms).toISOString() })
    .eq("event_id", eventId)
    .or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`)
    .select("event_id");
  const noop = async () => {};
  if (error) {
    if (error.code === "42703" || error.code === "PGRST204") return { ok: true, release: noop };
    throw error;
  }
  if (!data?.length) return { ok: false, release: noop };
  return {
    ok: true,
    release: async () => {
      await db().from("event_sync").update({ locked_until: null }).eq("event_id", eventId);
    },
  };
}

/**
 * Mirrors one event's share metadata into Supabase using the OneDrive delta
 * feed. Resumable: the cursor is saved after every page, so a run that hits
 * its time budget continues where it stopped on the next invocation. Once a
 * full pass completes, later runs only receive changes (incl. deletions).
 */
export async function runDeltaSync(event: EventRow, { budgetMs = 250_000 } = {}): Promise<SyncResult> {
  const started = Date.now();
  const share = event.share_url;
  const { rootId } = await getSession(share);
  const base = `/items/${rootId}/delta`;
  const { data: state } = await db().from("event_sync").select("*").eq("event_id", event.id).maybeSingle();
  if (!state) await db().from("event_sync").insert({ event_id: event.id });

  // The lease outlives the budget by a margin, so a run that crashes without releasing frees itself.
  const lock = await acquireLock(event.id, budgetMs + 60_000);
  if (!lock.ok) throw new SyncBusyError();

  let url: string | undefined =
    state?.next_link ?? state?.delta_link ?? `${base}?$top=1000&$select=${SELECT},parentReference,deleted`;
  const result: SyncResult = { upserted: 0, deleted: 0, pages: 0, complete: false };
  const saveState = async (patch: Record<string, unknown>) => {
    const { error } = await db().from("event_sync").update(patch).eq("event_id", event.id);
    if (error) throw error;
  };

  try {
    while (url && Date.now() - started < budgetMs) {
      const page: DeltaPage = await drive(share, url);
      result.pages++;

      const removed = page.value.filter((i) => i.deleted).map((i) => i.id);
      const rows = page.value.filter((i) => !i.deleted).map((i) => toRow(i, event.id, rootId));
      if (rows.length) {
        const { error } = await db().from("nodes").upsert(rows);
        if (error) throw error;
        result.upserted += rows.length;
      }
      if (removed.length) {
        const { error } = await db().from("nodes").delete().eq("event_id", event.id).in("id", removed);
        if (error) throw error;
        result.deleted += removed.length;
      }

      // Links point at the /personal/{site} host path where our token is
      // rejected; keep only the cursor query on our own endpoint.
      const next = page["@odata.nextLink"];
      const delta = page["@odata.deltaLink"];
      const cursor = (link: string) => `${base}?${new URL(link).searchParams}`;
      if (next) {
        url = cursor(next);
        await saveState({ next_link: url });
      } else {
        url = undefined;
        result.complete = true;
        await saveState({ next_link: null, delta_link: delta ? cursor(delta) : null });
        const { error } = await db().rpc("refresh_paths", { ev: event.id, root_id: rootId });
        if (error) throw error;
      }
    }
    await saveState({ last_run_at: new Date().toISOString(), last_error: null });
  } catch (e) {
    await saveState({ last_run_at: new Date().toISOString(), last_error: String((e as Error).message) });
    throw e;
  } finally {
    await lock.release();
  }
  return result;
}

function toRow(i: DriveItem & { parentReference?: { id?: string } }, eventId: string, rootId: string) {
  const mime = i.file?.mimeType ?? null;
  return {
    event_id: eventId,
    id: i.id,
    parent_id: i.id === rootId ? null : (i.parentReference?.id ?? null),
    name: i.name,
    kind: i.folder ? "folder" : "file",
    size: i.size ?? 0,
    child_count: i.folder?.childCount ?? null,
    mime,
    is_image: !!i.image || !!mime?.startsWith("image/"),
    is_video: !!i.video || !!mime?.startsWith("video/"),
    width: i.image?.width ?? i.video?.width ?? null,
    height: i.image?.height ?? i.video?.height ?? null,
    taken_at: i.photo?.takenDateTime ?? null,
    camera: cameraName(i),
    modified_at: i.lastModifiedDateTime ?? null,
    synced_at: new Date().toISOString(),
  };
}
