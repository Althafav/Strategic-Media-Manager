import { createEngine, detectBoxes, detectFaces, type FaceEngine } from "@/lib/face-detect";

/**
 * Face detection off the main thread (started by lib/faces.ts). Besides keeping the page responsive, a worker
 * isn't held back by the timer throttling browsers apply to background tabs, so a scan keeps its pace in a
 * hidden tab.
 */

type Box = [number, number, number, number];

/**
 * No bitmap = just load the models. `boxes` = positions only (the live selfie camera). `gpu` asks for the
 * WebGPU build (the background scan); once loaded it serves every later request.
 */
export type WorkerRequest = { id: number; bitmap?: ImageBitmap; tiles?: boolean; boxes?: boolean; gpu?: boolean };
export type WorkerResponse =
  | { id: number; faces: { embedding: Float32Array; box: Box; score: number; area: number }[] }
  | { id: number; boxes: { box: Box; score: number }[] }
  | { id: number; error: string };

let engine: Promise<FaceEngine> | null = null;
let wantsGpu = false;
// Requests run one at a time: the models aren't re-entrant, and an engine swap must not overlap a run.
let chain: Promise<void> = Promise.resolve();

async function handle(data: WorkerRequest) {
  try {
    if (!engine || (data.gpu && !wantsGpu)) {
      wantsGpu = !!data.gpu;
      engine = createEngine({ gpu: wantsGpu });
    }
    const e = await engine;
    if (!data.bitmap) return self.postMessage({ id: data.id, faces: [] } satisfies WorkerResponse);
    if (data.boxes) {
      const boxes = await detectBoxes(e, data.bitmap);
      return self.postMessage({ id: data.id, boxes } satisfies WorkerResponse);
    }
    const faces = await detectFaces(e, data.bitmap, { tiles: data.tiles });
    self.postMessage({ id: data.id, faces } satisfies WorkerResponse, { transfer: faces.map((f) => f.embedding.buffer) });
  } catch (err) {
    engine = null;
    self.postMessage({ id: data.id, error: (err as Error).message || "Face detection failed." } satisfies WorkerResponse);
  } finally {
    data.bitmap?.close();
  }
}

self.onmessage = ({ data }: MessageEvent<WorkerRequest>) => {
  chain = chain.then(() => handle(data));
};
