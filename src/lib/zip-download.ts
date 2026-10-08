import { downloadZip, predictLength } from "client-zip";
import type { ManifestEntry } from "@/lib/onedrive/client";
import { downloadHref, thumbSrc, ZOOM_PX, type Ref } from "@/lib/format";
import { BusyError, BUSY_MESSAGE, fetchRetry } from "@/lib/fetch-retry";
import { compressBitmap, decode, isImagePath, outputName, previewSuffices, type CompressOptions } from "@/lib/image-compress";

/**
 * `bytes`/`totalBytes` are zip bytes. When compressing, output sizes aren't known up front, so progress is
 * `files` of `totalFiles`, and `skipped` counts the non-photo files left out of the zip.
 */
export type ZipProgress = {
  phase: "listing" | "zipping" | "done";
  files: number;
  bytes: number;
  totalBytes: number;
  compress?: boolean;
  totalFiles?: number;
  skipped?: number;
};

type SaveFilePicker = (opts: {
  suggestedName: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/**
 * Zips the given files/folders in the browser. Files are fetched directly from
 * OneDrive (CORS-enabled pre-authenticated URLs) and streamed into the zip,
 * so the server never carries the bytes and there is no size/timeout ceiling
 * when the File System Access API is available.
 * With `compress`, only photos are included, each re-encoded in the browser (see image-compress.ts).
 */
export async function downloadAsZip(
  items: Ref[],
  zipName: string,
  onProgress: (p: ZipProgress) => void,
  signal?: AbortSignal,
  compress?: CompressOptions,
) {
  onProgress({ phase: "listing", files: 0, bytes: 0, totalBytes: 0 });

  // Ask for the destination first: the picker must run inside the user gesture.
  const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  const handle = picker
    ? await picker({ suggestedName: zipName, types: [{ description: "Zip archive", accept: { "application/zip": [".zip"] } }] })
    : null;

  const token = items.find((i) => i.t)?.t;
  const res = await fetch(token ? `/api/manifest?t=${token}` : "/api/manifest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items }),
    signal,
  });
  const data = (await res.json()) as { files?: ManifestEntry[]; error?: string };
  if (!res.ok || !data.files) throw new Error(data.error ?? "Could not list files");
  const listed = compress ? data.files.filter((f) => isImagePath(f.path)) : data.files;
  if (compress && !listed.length) throw new Error("There are no photos to compress in this selection");
  const files = dedupePaths(compress ? listed.map((f) => ({ ...f, path: outputName(f.path, compress.format) })) : listed);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const extra = compress ? { compress: true, totalFiles: files.length, skipped: data.files.length - listed.length } : {};
  let bytes = 0;
  let done = 0;

  async function* entries() {
    for (const f of files) {
      signal?.throwIfAborted();
      if (!compress) {
        const res = await withName(f, fetchFile(f, (r) => Promise.resolve(r), signal));
        done++;
        yield { name: f.path, input: res, size: f.size };
        continue;
      }
      // One photo at a time keeps memory bounded: decode, re-encode, release the bitmap.
      const bitmap = await withName(f, loadBitmap(f, previewSuffices(compress), signal));
      try {
        const input = await compressBitmap(bitmap, compress);
        done++;
        onProgress({ phase: "zipping", files: done, bytes, totalBytes, ...extra });
        yield { name: f.path, input };
      } finally {
        bitmap.close();
      }
    }
  }

  // Compressed sizes aren't known up front, so the zip length can't be predicted.
  const zip = downloadZip(
    entries(),
    compress ? {} : { length: predictLength(files.map((f) => ({ name: f.path, size: f.size }))) },
  );
  const counted = zip.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytes += chunk.byteLength;
        onProgress({ phase: "zipping", files: done, bytes, totalBytes, ...extra });
        ctrl.enqueue(chunk);
      },
    }),
  );

  if (handle) {
    await counted.pipeTo(await handle.createWritable(), { signal });
  } else {
    // Fallback buffers in memory; fine for moderate selections.
    const blob = await new Response(counted).blob();
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: zipName });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
  onProgress({ phase: "done", files: files.length, bytes, totalBytes, ...extra });
}

/** Errors name the file, so a failed zip says which photo stopped it. */
function withName<T>(f: ManifestEntry, p: Promise<T>): Promise<T> {
  return p.catch((e: Error) => {
    if (e instanceof BusyError) throw new BusyError(`${BUSY_MESSAGE} (${fileName(f)} didn't download.)`);
    throw e;
  });
}

const fileName = (f: ManifestEntry) => f.path.split("/").pop();

/**
 * The file's bytes from OneDrive, retried when it's busy or the connection drops. The manifest URL is used first;
 * retries ask for a fresh one, since an expired or throttled URL won't recover on its own.
 */
function fetchFile<T>(f: ManifestEntry, read: (res: Response) => Promise<T>, signal?: AbortSignal): Promise<T> {
  let first = true;
  const url = async () => {
    if (first) {
      first = false;
      return f.url;
    }
    const fresh = await fetch(`${downloadHref(f)}&json=1`, { signal, cache: "no-store" }).then((r) => r.json());
    if (fresh.url) f.url = fresh.url;
    return f.url;
  };
  return fetchRetry(url, (res) => (res.ok ? read(res) : Promise.reject(new Error(`Could not download ${fileName(f)}`))), signal);
}

/** The photo to compress: its 3840px preview when that's big enough, else (or when there's no preview) the original. */
async function loadBitmap(f: ManifestEntry, usePreview: boolean, signal?: AbortSignal): Promise<ImageBitmap> {
  if (usePreview) {
    const preview = await fetchRetry(() => thumbSrc(f, ZOOM_PX), (r) => (r.ok ? r.blob() : Promise.resolve(null)), signal).catch(
      (e) => {
        if (signal?.aborted) throw e;
        return null;
      },
    );
    const bitmap = preview && (await decode(preview).catch(() => null));
    if (bitmap) return bitmap;
  }
  const blob = await fetchFile(f, (r) => r.blob(), signal);
  return decode(blob).catch(() => {
    throw new Error(`This browser can't read ${fileName(f)}`);
  });
}

function dedupePaths(files: ManifestEntry[]): ManifestEntry[] {
  const seen = new Map<string, number>();
  return files.map((f) => {
    const key = f.path.toLowerCase();
    const n = seen.get(key) ?? 0;
    seen.set(key, n + 1);
    if (!n) return f;
    const dot = f.path.lastIndexOf(".");
    const path = dot > 0 ? `${f.path.slice(0, dot)} (${n})${f.path.slice(dot)}` : `${f.path} (${n})`;
    return { ...f, path };
  });
}
