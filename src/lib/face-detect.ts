import type { InferenceSession, Tensor } from "onnxruntime-web";
import { MAX_FACES_PER_PHOTO } from "@/lib/face-types";

/**
 * Face detection and embeddings with ONNX Runtime Web: YuNet (detector, MIT) finds each face and its five
 * landmarks, the face is rotated and scaled to SFace's 112 px template, and SFace (Apache-2.0) turns it into a
 * 128-d embedding. Both models come from OpenCV Zoo and are served from /public/models/faces-v1.
 */

export type Face = { embedding: Float32Array; box: [number, number, number, number]; score: number; area: number };

type Ort = typeof import("onnxruntime-web");
export type FaceEngine = { ort: Ort; yunet: InferenceSession; sface: InferenceSession; backend: string; gpu: boolean };

/** Versioned folders: cached for a year (next.config.ts), so rename them when the files change. */
const MODELS = "/models/faces-v1/";
const RUNTIME = "/ort-1.31.1/";

/**
 * `gpu`: use WebGPU when the browser has it (scanning thousands of event photos). Without it the lighter CPU
 * build is loaded: about 15 MB instead of 29 MB to download, and plenty for one selfie.
 */
export async function createEngine({ gpu = false } = {}): Promise<FaceEngine> {
  const wanted = gpu && typeof navigator !== "undefined" && "gpu" in navigator;
  const ort: Ort = wanted ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");
  ort.env.wasm.wasmPaths = `${self.location.origin}${RUNTIME}`;
  ort.env.logLevel = "error";
  const open = async (providers: string[]) => {
    const base = `${self.location.origin}${MODELS}`;
    const opts = { executionProviders: providers, graphOptimizationLevel: "all" as const };
    // One after the other: the WebGPU backend refuses to create two sessions at the same time.
    const yunet = await ort.InferenceSession.create(`${base}yunet.onnx`, opts);
    const sface = await ort.InferenceSession.create(`${base}sface.onnx`, opts);
    return { ort, yunet, sface, backend: providers[0], gpu };
  };
  if (wanted) {
    try {
      return await open(["webgpu"]);
    } catch (e) {
      // Falls through to the CPU build (no adapter, blocked GPU, old driver).
      console.warn("Face models: no WebGPU, using the CPU build.", e);
    }
  }
  return open(["wasm"]);
}

type Px = [number, number, number, number];
type Found = { px: Px; score: number; pts: number[] };

const canvasOf = (w: number, h: number) =>
  typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(w, h) : Object.assign(document.createElement("canvas"), { width: w, height: h });

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
const ctxOf = (c: OffscreenCanvas | HTMLCanvasElement) => c.getContext("2d", { willReadFrequently: true }) as Ctx;

/** RGBA pixels -> planar float tensor data, 0–255, in the channel order the model wants. */
function planar(rgba: Uint8ClampedArray, n: number, order: [number, number, number]): Float32Array {
  const out = new Float32Array(n * 3);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = rgba[p + order[0]];
    out[n + i] = rgba[p + order[1]];
    out[2 * n + i] = rgba[p + order[2]];
  }
  return out;
}

const iou = (a: Px, b: Px) => {
  const x = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
  const y = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
  const inter = x * y;
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
};

const MIN_SCORE = 0.6;

/**
 * One YuNet pass with the photo's longest side scaled to `side`. YuNet sees faces of about 10–300 px in its
 * input, so a small pass finds close-ups and a large one finds the back row. Boxes and landmarks come back in
 * the photo's own pixels.
 */
async function detectAt(e: FaceEngine, bitmap: ImageBitmap, side: number): Promise<Found[]> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(32, Math.round(bitmap.width * scale));
  const h = Math.max(32, Math.round(bitmap.height * scale));
  // The three output grids (strides 8, 16, 32) only line up when both sides are multiples of 32.
  const W = Math.ceil(w / 32) * 32;
  const H = Math.ceil(h / 32) * 32;
  const canvas = canvasOf(W, H);
  const ctx = ctxOf(canvas);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, w, h);
  const input = new e.ort.Tensor("float32", planar(ctx.getImageData(0, 0, W, H).data, W * H, [2, 1, 0]), [1, 3, H, W]);
  const out = (await e.yunet.run({ input })) as Record<string, Tensor>;

  const found: Found[] = [];
  for (const stride of [8, 16, 32]) {
    const cols = W / stride;
    const rows = H / stride;
    const cls = out[`cls_${stride}`].data as Float32Array;
    const obj = out[`obj_${stride}`].data as Float32Array;
    const box = out[`bbox_${stride}`].data as Float32Array;
    const kps = out[`kps_${stride}`].data as Float32Array;
    for (let i = 0; i < rows * cols; i++) {
      const score = Math.sqrt(Math.min(1, Math.max(0, cls[i])) * Math.min(1, Math.max(0, obj[i])));
      if (score < MIN_SCORE) continue;
      const c = i % cols;
      const r = (i - c) / cols;
      const bw = Math.exp(box[i * 4 + 2]) * stride;
      const bh = Math.exp(box[i * 4 + 3]) * stride;
      const cx = (c + box[i * 4]) * stride;
      const cy = (r + box[i * 4 + 1]) * stride;
      const pts: number[] = [];
      for (let k = 0; k < 5; k++) {
        pts.push(((kps[i * 10 + k * 2] + c) * stride) / scale, ((kps[i * 10 + k * 2 + 1] + r) * stride) / scale);
      }
      found.push({ px: [(cx - bw / 2) / scale, (cy - bh / 2) / scale, bw / scale, bh / scale], score, pts });
    }
  }
  return found;
}

/** Keeps the best-scoring box of each overlapping group. */
function nms(found: Found[], overlap = 0.3): Found[] {
  const kept: Found[] = [];
  for (const f of [...found].sort((a, b) => b.score - a.score)) {
    if (!kept.some((k) => iou(k.px, f.px) > overlap)) kept.push(f);
  }
  return kept;
}

/** SFace's landmark template in its 112 px input: right eye, left eye, nose, mouth corners. */
const TEMPLATE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];

/** Least-squares rotation + scale + shift taking `pts` onto the template, as canvas transform arguments. */
function alignment(pts: number[]): [number, number, number, number, number, number] {
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let k = 0; k < 5; k++) {
    sx += pts[k * 2] / 5;
    sy += pts[k * 2 + 1] / 5;
    dx += TEMPLATE[k * 2] / 5;
    dy += TEMPLATE[k * 2 + 1] / 5;
  }
  let a = 0, b = 0, norm = 0;
  for (let k = 0; k < 5; k++) {
    const x = pts[k * 2] - sx, y = pts[k * 2 + 1] - sy;
    const u = TEMPLATE[k * 2] - dx, v = TEMPLATE[k * 2 + 1] - dy;
    a += x * u + y * v;
    b += x * v - y * u;
    norm += x * x + y * y;
  }
  const p = a / (norm || 1), q = b / (norm || 1);
  return [p, q, -q, p, dx - (p * sx - q * sy), dy - (q * sx + p * sy)];
}

const unit = (v: ArrayLike<number>) => {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const out = new Float32Array(v.length);
  const n = Math.sqrt(sum) || 1;
  for (let i = 0; i < v.length; i++) out[i] = v[i] / n;
  return out;
};

async function embed(e: FaceEngine, bitmap: ImageBitmap, pts: number[]): Promise<Float32Array | null> {
  const canvas = canvasOf(112, 112);
  const ctx = ctxOf(canvas);
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(...alignment(pts));
  ctx.drawImage(bitmap, 0, 0);
  const data = new e.ort.Tensor("float32", planar(ctx.getImageData(0, 0, 112, 112).data, 112 * 112, [0, 1, 2]), [1, 3, 112, 112]);
  const out = (await e.sface.run({ data })) as Record<string, Tensor>;
  const v = out.fc1.data as Float32Array;
  return v.every(Number.isFinite) ? unit(v) : null;
}

/**
 * Boxes only (no embeddings): one small pass, for the live selfie camera. `box` is [x, y, w, h] as fractions.
 */
export async function detectBoxes(e: FaceEngine, bitmap: ImageBitmap): Promise<{ box: Px; score: number }[]> {
  const { width: W, height: H } = bitmap;
  return nms(await detectAt(e, bitmap, 320)).map((f) => ({
    box: [f.px[0] / W, f.px[1] / H, f.px[2] / W, f.px[3] / H],
    score: f.score,
  }));
}

/**
 * All faces in a photo, largest first. Without `tiles` (a selfie): one 640 px pass. With `tiles` (event photos):
 * a second pass at up to 1920 px, which is where small faces in group and crowd shots show up.
 */
export async function detectFaces(e: FaceEngine, bitmap: ImageBitmap, { tiles = false } = {}): Promise<Face[]> {
  const { width: W, height: H } = bitmap;
  const found = await detectAt(e, bitmap, 640);
  if (tiles && Math.max(W, H) > 900) found.push(...(await detectAt(e, bitmap, 1920)));
  const kept = nms(found)
    .sort((a, b) => b.px[2] * b.px[3] - a.px[2] * a.px[3])
    .slice(0, MAX_FACES_PER_PHOTO);
  const faces: Face[] = [];
  for (const f of kept) {
    const embedding = await embed(e, bitmap, f.pts);
    if (!embedding) continue;
    faces.push({
      embedding,
      score: f.score,
      area: f.px[2] * f.px[3],
      box: [f.px[0] / W, f.px[1] / H, f.px[2] / W, f.px[3] / H].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 1e4) / 1e4) as Face["box"],
    });
  }
  return faces;
}
