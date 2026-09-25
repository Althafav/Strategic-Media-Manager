import { downloadZip, predictLength } from "client-zip";
import type { ManifestEntry } from "@/lib/onedrive/client";
import { downloadHref, type Ref } from "@/lib/format";

export type ZipProgress = { phase: "listing" | "zipping" | "done"; files: number; bytes: number; totalBytes: number };

type SaveFilePicker = (opts: {
  suggestedName: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable(): Promise<WritableStream<Uint8Array>> }>;

/**
 * Zips the given files/folders in the browser. Files are fetched directly from
 * OneDrive (CORS-enabled pre-authenticated URLs) and streamed into the zip,
 * so the server never carries the bytes and there is no size/timeout ceiling
 * when the File System Access API is available.
 */
export async function downloadAsZip(
  items: Ref[],
  zipName: string,
  onProgress: (p: ZipProgress) => void,
  signal?: AbortSignal,
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
  const files = dedupePaths(data.files);

  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  let bytes = 0;
  let done = 0;

  async function* entries() {
    for (const f of files) {
      signal?.throwIfAborted();
      const input = await fetchWithRefresh(f, signal);
      done++;
      yield { name: f.path, input, size: f.size };
    }
  }

  const zip = downloadZip(entries(), {
    length: predictLength(files.map((f) => ({ name: f.path, size: f.size }))),
  });
  const counted = zip.body!.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        bytes += chunk.byteLength;
        onProgress({ phase: "zipping", files: done, bytes, totalBytes });
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
  onProgress({ phase: "done", files: files.length, bytes, totalBytes });
}

async function fetchWithRefresh(f: ManifestEntry, signal?: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(f.url, { signal });
    if (res.ok) return res;
    if (res.status === 401 || res.status === 403) {
      // Pre-authenticated URL expired during a long download: get a new one.
      const fresh = await fetch(`${downloadHref(f)}&json=1`, { signal }).then((r) => r.json());
      f.url = fresh.url;
    } else {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
  throw new Error(`Failed to fetch ${f.path}`);
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
