import type { Face, FaceEngine } from "@/lib/face-detect";
import type { WorkerRequest, WorkerResponse } from "@/lib/face-worker";

/**
 * Browser-side face detection for "Find my photos" (indexing and selfies). Runs in a Web Worker
 * (lib/face-worker.ts, logic in lib/face-detect.ts) where the browser has OffscreenCanvas, else on the main
 * thread. Like image compression, the server never sees the pixels: only the embeddings leave the browser.
 * Call only in the browser (event handlers, effects).
 */

export type { Face };
export type FaceBox = { box: [number, number, number, number]; score: number };

let worker: Worker | null = null;
let nextId = 0;
const waiting = new Map<number, { resolve: (res: WorkerResponse) => void; reject: (e: Error) => void }>();
let mainThread: Promise<FaceEngine> | null = null;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === "undefined" || typeof OffscreenCanvas === "undefined") return null;
  worker = new Worker(new URL("./face-worker.ts", import.meta.url), { type: "module" });
  worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
    const w = waiting.get(data.id);
    waiting.delete(data.id);
    if ("error" in data) w?.reject(new Error(data.error));
    else w?.resolve(data);
  };
  worker.onerror = () => {
    for (const w of waiting.values()) w.reject(new Error("Face detection stopped. Reload the page and try again."));
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function ask(w: Worker, req: WorkerRequest): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    waiting.set(req.id, { resolve, reject });
    w.postMessage(req, req.bitmap ? [req.bitmap] : []);
  });
}

async function onMainThread(): Promise<FaceEngine> {
  const { createEngine } = await import("@/lib/face-detect");
  mainThread ??= createEngine().catch((e) => {
    mainThread = null;
    throw e;
  });
  return mainThread;
}

/**
 * Loads the library and models once (cached by the browser after the first time). `gpu` is for the background
 * scan: it loads the larger WebGPU build, which a visitor taking one selfie doesn't need.
 */
export async function loadFaces({ gpu = false } = {}): Promise<void> {
  const w = getWorker();
  if (w) await ask(w, { id: nextId++, gpu });
  else await onMainThread();
}

/**
 * All faces in a photo, largest first (see face-detect.ts; `tiles` for event photos). The bitmap is handed to
 * the worker and closed there, so don't use it afterwards.
 */
export async function detectFaces(bitmap: ImageBitmap, opts: { tiles?: boolean } = {}): Promise<Face[]> {
  const w = getWorker();
  if (w) {
    const res = await ask(w, { id: nextId++, bitmap, tiles: opts.tiles });
    return "faces" in res ? res.faces : [];
  }
  const { detectFaces: detect } = await import("@/lib/face-detect");
  try {
    return await detect(await onMainThread(), bitmap, opts);
  } finally {
    bitmap.close();
  }
}

/** Where the faces are in a camera frame (no embeddings: fast enough to run a few times a second). Takes over the bitmap. */
export async function detectBoxes(bitmap: ImageBitmap): Promise<FaceBox[]> {
  const w = getWorker();
  if (w) {
    const res = await ask(w, { id: nextId++, bitmap, boxes: true });
    return "boxes" in res ? res.boxes : [];
  }
  const { detectBoxes: detect } = await import("@/lib/face-detect");
  try {
    return await detect(await onMainThread(), bitmap);
  } finally {
    bitmap.close();
  }
}
