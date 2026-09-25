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
const cache = new Map<string, { at: number; value: unknown }>();
const TTL_MS = 5 * 60 * 1000;

async function memo<T>(share: string, key: string, fn: () => Promise<T>): Promise<T> {
  const fullKey = `${share}|${key}`;
  const hit = cache.get(fullKey);
  const { expiresAt } = await getSession(share);
  if (hit && Date.now() - hit.at < TTL_MS && expiresAt > Date.now() + TTL_MS) return hit.value as T;
  const value = await fn();
  if (cache.size > 5000) cache.clear();
  cache.set(fullKey, { at: Date.now(), value });
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
    const children = await listAll(share, `/items/${self.id}`, `$select=${SELECT}&$expand=thumbnails`);
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

/** Finds a representative image inside a folder (breadth-first, shallow). */
export async function getCoverUrl(share: string, id: string): Promise<string | null> {
  return memo(share, `cover:${id}`, async () => {
    let queue = [id];
    for (let depth = 0; depth < 3 && queue.length; depth++) {
      const next: string[] = [];
      for (const folderId of queue.slice(0, 4)) {
        const page: { value: DriveItem[] } = await drive(
          share,
          `/items/${folderId}/children?$top=60&$select=${SELECT}&$expand=thumbnails`,
        );
        const img = page.value.find((i) => i.image && i.thumbnails?.length);
        if (img) return sizedThumb(img.thumbnails![0], 640) ?? null;
        next.push(...page.value.filter((i) => i.folder?.childCount).map((i) => i.id));
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
  const select = `$select=${SELECT},@content.downloadUrl`;

  async function visit(item: DriveItem, prefix: string) {
    if (out.length >= limit) throw new Error(`Selection exceeds ${limit} files`);
    if (item.folder) {
      const children = await listAll(share, `/items/${item.id}`, select);
      for (const child of children) await visit(child, `${prefix}${item.name}/`);
    } else if (item["@content.downloadUrl"]) {
      out.push({ id: item.id, event, path: prefix + item.name, size: item.size ?? 0, url: item["@content.downloadUrl"] });
    }
  }

  for (const id of ids) await visit(await drive<DriveItem>(share, `/items/${id}?${select}`), "");
  return out;
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
    camera: [i.photo?.cameraMake, i.photo?.cameraModel].filter(Boolean).join(" ") || undefined,
    modifiedAt: i.lastModifiedDateTime,
    thumb: thumb ? sizedThumb(thumb, 400) : undefined,
    preview: thumb ? sizedThumb(thumb, 1920) : undefined,
  };
}

function byKindThenName(a: { kind: string; name: string }, b: { kind: string; name: string }) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
}
