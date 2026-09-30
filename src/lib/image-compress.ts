import type { MediaItem } from "@/lib/onedrive/types";
import { downloadHref, resizedPreview, ZOOM_PX } from "@/lib/format";

/**
 * Browser-side image compression: decode with createImageBitmap, redraw on a canvas at the target size and
 * re-encode. The server never sees the bytes (originals come straight from OneDrive, like the zip download).
 */

export type CompressFormat = "jpeg" | "webp" | "png";

export type CompressOptions = {
  format: CompressFormat;
  /** 0.1–1; ignored for PNG. */
  quality: number;
  /** Longest side in px, never upscaled. Null keeps the original size (unless width/height are set). */
  maxSide: number | null;
  /** Exact output size (single photo, "Custom"). Takes precedence over maxSide. */
  width?: number;
  height?: number;
};

export const FORMATS: { value: CompressFormat; label: string; ext: string }[] = [
  { value: "jpeg", label: "JPG", ext: "jpg" },
  { value: "webp", label: "WebP", ext: "webp" },
  { value: "png", label: "PNG", ext: "png" },
];

export const DEFAULT_COMPRESS: CompressOptions = { format: "jpeg", quality: 0.8, maxSide: 1920 };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif|tiff?|avif)$/i;
export const isImagePath = (path: string) => IMAGE_EXT.test(path);

export function decode(blob: Blob): Promise<ImageBitmap> {
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/** Output size for a source of `w` × `h`. */
export function targetSize(w: number, h: number, opts: CompressOptions): { width: number; height: number } {
  if (opts.width && opts.height) return { width: Math.round(opts.width), height: Math.round(opts.height) };
  const scale = opts.maxSide ? Math.min(1, opts.maxSide / Math.max(w, h)) : 1;
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

export async function compressBitmap(bitmap: ImageBitmap, opts: CompressOptions): Promise<Blob> {
  const { width, height } = targetSize(bitmap.width, bitmap.height, opts);
  const type = `image/${opts.format}`;
  const quality = opts.format === "png" ? undefined : opts.quality;

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    draw(canvas.getContext("2d")!, bitmap, width, height, opts.format);
    return canvas.convertToBlob({ type, quality });
  }
  const canvas = Object.assign(document.createElement("canvas"), { width, height });
  draw(canvas.getContext("2d")!, bitmap, width, height, opts.format);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("This browser couldn't encode the image"))), type, quality),
  );
}

function draw(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  width: number,
  height: number,
  format: CompressFormat,
) {
  // JPG has no transparency: paint white so transparent areas don't turn black.
  if (format === "jpeg") {
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
}

export type Source = { bitmap: ImageBitmap; bytes: number; fromPreview: boolean };

/**
 * The original from OneDrive, or the 3840px preview when the browser can't decode the original
 * (HEIC, TIFF, RAW…). Fetching `downloadHref` counts as a download on share links, as intended.
 */
export async function loadSource(item: MediaItem, signal?: AbortSignal): Promise<Source> {
  const res = await fetch(downloadHref(item), { signal });
  if (!res.ok) throw new Error("Could not download the original from OneDrive");
  const blob = await res.blob();
  try {
    return { bitmap: await decode(blob), bytes: blob.size, fromPreview: false };
  } catch {
    const preview = item.preview && (resizedPreview(item.preview, ZOOM_PX) ?? item.preview);
    if (!preview) throw new Error("This browser can't read this image format");
    const fallback = await fetch(preview, { signal });
    if (!fallback.ok) throw new Error("This browser can't read this image format");
    return { bitmap: await decode(await fallback.blob()), bytes: blob.size, fromPreview: true };
  }
}

/** `IMG_01.HEIC` -> `IMG_01.webp` (keeps any folder prefix). */
export function outputName(name: string, format: CompressFormat): string {
  const ext = FORMATS.find((f) => f.value === format)!.ext;
  const slash = name.lastIndexOf("/");
  const dot = name.lastIndexOf(".");
  return `${dot > slash ? name.slice(0, dot) : name}.${ext}`;
}

export function saveBlob(blob: Blob, name: string) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}
