import { getSession, invalidateSession } from "./session";
import type { MediaItem } from "./types";

// Every call is scoped to one share link (`share`), i.e. one event's storage.

export type DriveItem = {
  id: string;
  name: string;
  size?: number;
  eTag?: string;
  lastModifiedDateTime?: string;
  folder?: { childCount: number };
  file?: { mimeType?: string };
  image?: { width?: number; height?: number };
  photo?: { takenDateTime?: string; cameraMake?: string; cameraModel?: string };
  video?: { width?: number; height?: number; duration?: number };
  thumbnails?: { medium?: { url: string }; large?: { url: string } }[];
  "@content.downloadUrl"?: string;
};

export const SELECT = "id,name,size,eTag,lastModifiedDateTime,folder,file,image,photo,video";
const ID_RE = /^[A-Za-z0-9!_-]+$/;

export function isValidId(id: string) {
  return ID_RE.test(id);
}

/** Fetch against the drive API with auth, token refresh and throttling backoff. */
export async function drive<T>(share: string, pathOrUrl: string, attempt = 0): Promise<T> {
  const s = await getSession(share);
  const url = pathOrUrl.startsWith("https://") ? pathOrUrl : `${s.driveUrl}${pathOrUrl}`;
  const res = await fetch(url, {
    headers: { authorization: `Bearer ${s.token}`, accept: "application/json" },
    cache: "no-store",
  });
  if ((res.status === 401 || res.status === 403) && attempt === 0) {
    invalidateSession(share);
    return drive(share, pathOrUrl, attempt + 1);
  }
  if ((res.status === 429 || res.status === 503) && attempt < 4) {
    const wait = Number(res.headers.get("retry-after")) || 2 ** attempt;
    await new Promise((r) => setTimeout(r, wait * 1000));
    return drive(share, pathOrUrl, attempt + 1);
  }
  if (res.status === 404) throw new NotFoundError(url);
  if (!res.ok) throw new Error(`Drive API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

export class NotFoundError extends Error {}

/** Addresses an item by path segments relative to the shared root folder. */
async function itemPath(share: string, path: string[], baseId?: string) {
  const base = baseId ?? (await getSession(share)).rootId;
  if (!path.length) return `/items/${base}`;
  return `/items/${base}:/${path.map(encodeURIComponent).join("/")}:`;
}

async function listAll(share: string, base: string, query: string): Promise<DriveItem[]> {
  const items: DriveItem[] = [];
  let next: string | undefined = `${base}/children?$top=500&${query}`;
  while (next) {
    const page: { value: DriveItem[]; "@odata.nextLink"?: string } = await drive(share, next);
    items.push(...page.value);
    // nextLink points at the /personal/{site}/_api host path where the token
    // is rejected; keep its query (skiptoken) on our own base path.
    const link = page["@odata.nextLink"];
    next = link ? `${base}/children?${new URL(link).searchParams}` : undefined;
  }
  return items;
}

// Short in-memory cache: thumbnail URLs are signed with the session token, so
// never cache longer than the token lives.
// The in-flight promise is cached, so simultaneous misses share one OneDrive fetch (a cold 1,000-item
// folder takes seconds); a failed fetch is dropped so the next caller retries.
const cache = new Map<string, { at: number; value: Promise<unknown> }>();
const TTL_MS = 5 * 60 * 1000;

async function memo<T>(share: string, key: string, fn: () => Promise<T>): Promise<T> {
  const fullKey = `${share}|${key}`;
  const hit = cache.get(fullKey);
  const { expiresAt } = await getSession(share);
  if (hit && Date.now() - hit.at < TTL_MS && expiresAt > Date.now() + TTL_MS) return hit.value as Promise<T>;
  const value = fn();
  if (cache.size > 5000) cache.clear();
  const entry = { at: Date.now(), value };
  cache.set(fullKey, entry);
  value.catch(() => cache.get(fullKey) === entry && cache.delete(fullKey));
  return value;
}

/** Root folder facts, used to validate a newly added share link. */
export async function inspectShare(share: string) {
  const { rootId, rootName } = await getSession(share);
  const root = await drive<DriveItem>(share, `/items/${rootId}?$select=${SELECT}`);
  return { rootId, rootName: root.name ?? rootName, itemCount: root.folder?.childCount ?? 0, size: root.size ?? 0 };
}

/** Lists a folder by path, relative to the event root or to `baseId` (a shared subfolder). */
export async function getFolder(share: string, path: string[], baseId?: string) {
  if (path.some((s) => !s || s === "." || s === ".." || /[\\/]/.test(s))) throw new NotFoundError(path.join("/"));
  return memo(share, `folder:${baseId ?? ""}:${path.join("/")}`, async () => {
    // Path addressing works for the item itself but the token is rejected on
    // path-addressed /children, so resolve the id first.
    const self = await drive<DriveItem>(share, `${await itemPath(share, path, baseId)}?$select=${SELECT}`);
    if (!self.folder) throw new NotFoundError(path.join("/"));
    // No $expand=thumbnails: it made listings ~3x slower and the page only needs `hasThumb`, which toMediaItem
    // derives from the image/video facets (thumbnails themselves come from /api/thumb).
    const children = await listAll(share, `/items/${self.id}`, `$select=${SELECT}`);
    const items = children.map(toMediaItem).sort(byKindThenName);
    return { folder: toMediaItem(self), items };
  });
}

/**
 * Looks up specific items (a share link's picked items). Items still in `folderId` come from that
 * folder's memoised listing; the rest are fetched one by one. Deleted items are skipped.
 */
export async function getItems(share: string, ids: string[], folderId?: string | null) {
  const found = new Map<string, Omit<MediaItem, "event">>();
  if (folderId) {
    const listing = await getFolder(share, [], folderId).catch((e) => {
      if (e instanceof NotFoundError) return null;
      throw e;
    });
    for (const item of listing?.items ?? []) found.set(item.id, item);
  }
  const missing = ids.filter((id) => !found.has(id));
  if (!missing.length) return ids.flatMap((id) => found.get(id) ?? []).sort(byKindThenName);
  const fetched = await memo(share, `items:${missing.join(",")}`, async () => {
    const out: Omit<MediaItem, "event">[] = [];
    for (let i = 0; i < missing.length; i += 8) {
      const batch = await Promise.all(
        missing.slice(i, i + 8).map((id) =>
          drive<DriveItem>(share, `/items/${id}?$select=${SELECT}&$expand=thumbnails`).catch((e) => {
            // Deleted items 404; ids the drive doesn't recognise at all come back as 400.
            if (e instanceof NotFoundError || /^Drive API 400/.test((e as Error).message)) return null;
            throw e;
          }),
        ),
      );
      for (const item of batch) if (item) out.push(toMediaItem(item));
    }
    return out;
  });
  for (const item of fetched) found.set(item.id, item);
  return ids.flatMap((id) => found.get(id) ?? []).sort(byKindThenName);
}

/**
 * Finds a representative image inside a folder (breadth-first, shallow). A folder's picked cover
 * (`pinned`: folder id -> item id, see lib/covers.ts) wins, including for folders reached on the way
 * down; otherwise the first image in the gallery's sort order. Uses the memoised full listing
 * (shared with the folder page), so the cover matches the first photo the user sees there.
 */
export async function getCoverUrl(share: string, id: string, pinned: Record<string, string> = {}): Promise<string | null> {
  const pins = Object.entries(pinned).sort().join(",");
  return memo(share, `cover:${id}:${pins}`, async () => {
    let queue = [id];
    for (let depth = 0; depth < 3 && queue.length; depth++) {
      const next: string[] = [];
      for (const folderId of queue.slice(0, 4)) {
        // A picked cover that was deleted (no thumbnail) falls through to the automatic pick.
        const pick = pinned[folderId] && (await getThumbUrl(share, pinned[folderId], 640).catch(() => null));
        if (pick) return pick;
        const { items } = await getFolder(share, [], folderId);
        // A few tries only: an image without a drive thumbnail (still processing) shouldn't cost a call per file.
        for (const img of items.filter((i) => i.kind === "file" && i.isImage).slice(0, 3)) {
          const url = await getThumbUrl(share, img.id, 640);
          if (url) return url;
        }
        next.push(...items.filter((i) => i.kind === "folder" && i.childCount).map((i) => i.id));
      }
      queue = next;
    }
    return null;
  });
}

/** Fresh signed thumbnail URL for one item (used where listings aren't at hand, e.g. search). */
export async function getThumbUrl(share: string, id: string, px: number): Promise<string | null> {
  return memo(share, `thumb:${id}:${px}`, async () => {
    const page: { value: NonNullable<DriveItem["thumbnails"]> } = await drive(share, `/items/${id}/thumbnails`);
    return page.value[0] ? (sizedThumb(page.value[0], px) ?? null) : null;
  });
}

export async function getDownloadUrl(share: string, id: string): Promise<string> {
  const item = await drive<DriveItem>(share, `/items/${id}?$select=id,name,file,@content.downloadUrl`);
  const url = item["@content.downloadUrl"];
  if (!item.file || !url) throw new NotFoundError(id);
  return url;
}

export type ManifestEntry = { id: string; event: string; path: string; size: number; url: string; t?: string; sig?: string };

/**
 * Flattens files and folders into a download manifest with relative paths
 * and pre-authenticated URLs (CORS-enabled, fetched directly by the browser).
 */
export async function buildManifest(
  share: string,
  event: string,
  ids: string[],
  out: ManifestEntry[] = [],
  limit = 25_000,
): Promise<ManifestEntry[]> {
  // Cached per (share, ids): a walk costs ~1s per folder page, so concurrent or repeated requests share one.
  // The in-flight promise is cached too, which dedupes simultaneous requests. Copies go out because
  // callers add t/sig to the entries.
  const key = `${share}|${event}|${limit}|${ids.join(",")}`;
  const { expiresAt } = await getSession(share);
  let hit = manifestCache.get(key);
  if (!hit || Date.now() - hit.at >= MANIFEST_TTL_MS || expiresAt <= Date.now() + MANIFEST_TTL_MS) {
    if (manifestCache.size >= 20) manifestCache.delete(manifestCache.keys().next().value!);
    const promise = walkManifest(share, event, ids, limit);
    hit = { at: Date.now(), promise };
    manifestCache.set(key, hit);
    promise.catch(() => manifestCache.get(key) === hit && manifestCache.delete(key)); // never cache a failure
  }
  const files = await hit.promise;
  for (const f of files) out.push({ ...f });
  if (out.length > limit) throw new Error(`Selection exceeds ${limit} files`);
  return out;
}

// The URLs inside are pre-authenticated and short-lived, so keep this well under their lifetime.
const MANIFEST_TTL_MS = 5 * 60 * 1000;
const manifestCache = new Map<string, { at: number; promise: Promise<ManifestEntry[]> }>();
/** Folder pages fetched at once per manifest; sequential walking made a 10k-file folder take ~2 minutes. */
const WALK_CONCURRENCY = 6;

async function walkManifest(share: string, event: string, ids: string[], limit: number): Promise<ManifestEntry[]> {
  const select = `$select=${SELECT},@content.downloadUrl`;
  let count = 0;
  let active = 0;
  const waiting: (() => void)[] = [];
  const slot = async <T,>(fn: () => Promise<T>): Promise<T> => {
    while (active >= WALK_CONCURRENCY) await new Promise<void>((r) => waiting.push(r));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };

  // Returns entries in listing order, so the result is deterministic despite the parallel fetches.
  async function visit(item: DriveItem, prefix: string): Promise<ManifestEntry[]> {
    if (item.folder) {
      const children = await slot(() => listAll(share, `/items/${item.id}`, select));
      const parts = await Promise.all(children.map((child) => visit(child, `${prefix}${item.name}/`)));
      return parts.flat();
    }
    if (!item["@content.downloadUrl"]) return [];
    if (++count > limit) throw new Error(`Selection exceeds ${limit} files`);
    return [{ id: item.id, event, path: prefix + item.name, size: item.size ?? 0, url: item["@content.downloadUrl"] }];
  }

  const roots = await Promise.all(ids.map((id) => slot(() => drive<DriveItem>(share, `/items/${id}?${select}`))));
  return (await Promise.all(roots.map((root) => visit(root, "")))).flat();
}

function sizedThumb(t: NonNullable<DriveItem["thumbnails"]>[number], px: number): string | undefined {
  const url = t.medium?.url ?? t.large?.url;
  if (!url) return undefined;
  const u = new URL(url);
  // mediap transform service honours arbitrary bounding boxes.
  if (u.searchParams.has("width")) {
    u.searchParams.set("width", String(px));
    u.searchParams.set("height", String(px));
    return u.toString();
  }
  return px > 400 ? (t.large?.url ?? url) : url;
}

function toMediaItem(i: DriveItem): Omit<MediaItem, "event"> {
  const mime = i.file?.mimeType;
  const thumb = i.thumbnails?.[0];
  const isVideo = !!i.video || !!mime?.startsWith("video/");
  return {
    id: i.id,
    name: i.name,
    kind: i.folder ? "folder" : "file",
    size: i.size ?? 0,
    childCount: i.folder?.childCount,
    mime,
    isImage: !!i.image || !!mime?.startsWith("image/"),
    isVideo,
    width: i.image?.width ?? i.video?.width,
    height: i.image?.height ?? i.video?.height,
    takenAt: i.photo?.takenDateTime,
    camera: cameraName(i) ?? undefined,
    modifiedAt: i.lastModifiedDateTime,
    // The raw drive thumbnail URL is never emitted to the browser: callers build /api/thumb URLs
    // with withPreviews() so every image load re-checks the share token. See SECURITY.md.
    hasThumb: !!thumb || !!i.image || isVideo,
  };
}

/** "Canon EOS 5D Mark IV", not "Canon Canon EOS 5D Mark IV": many models already start with the make. */
export function cameraName(i: DriveItem): string | null {
  const make = i.photo?.cameraMake?.trim();
  const model = i.photo?.cameraModel?.trim();
  if (make && model?.toLowerCase().startsWith(make.toLowerCase())) return model;
  return [make, model].filter(Boolean).join(" ") || null;
}

function byKindThenName(a: { kind: string; name: string }, b: { kind: string; name: string }) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
