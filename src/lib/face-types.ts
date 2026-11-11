/**
 * Client-safe face search constants and the wire format for embeddings. Embeddings travel as base64 of
 * little-endian Float32 (about 0.7 KB per face), which keeps indexing batches well under the 1 MB server
 * action body limit. Detection itself lives in lib/faces.ts (browser only).
 */

/** SFace embedding length (lib/face-detect.ts). */
export const EMBEDDING_DIM = 128;

/**
 * Cosine distance (0 = identical) at or below which a face counts as the same person, for SFace embeddings.
 * PROVISIONAL: set from a 6-photo smoke test (PSR AIM 2026), where two different people in one photo were never
 * closer than 0.43 and 1 pair in 100 was closer than 0.45. Re-check on a whole event if results look off.
 */
export const MATCH_DIST = 0.48;
/** The loosest matches the server returns ("Loose"): catches more of the person, with some look-alikes. */
export const LOOSE_DIST = 0.56;

/** How sure a match must be. One setting for selfie results; the visitor switches it without a new search. */
export const MATCH_LEVELS = ["strict", "balanced", "loose"] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];
export const DEFAULT_MATCH_LEVEL: MatchLevel = "balanced";
export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = { strict: "Strict", balanced: "Balanced", loose: "Loose" };
/** Largest cosine distance that counts as "you" at each level. The server returns everything up to loose. */
export const LEVEL_DIST: Record<MatchLevel, number> = { strict: 0.4, balanced: MATCH_DIST, loose: LOOSE_DIST };

/** Largest distance from a person's average face for a new face to join them (People grouping). */
export const PERSON_DIST = 0.45;

export const MAX_PERSON_NAME = 80;

/** A person found in an event (People). `cover` is their clearest face: a photo and where the face is in it. */
export type Person = {
  id: string;
  name: string | null;
  hidden: boolean;
  photos: number;
  cover: { itemId: string; box: [number, number, number, number] };
};

/** One grouped face in a photo, for the lightbox's "People in this photo". */
export type PhotoFace = { personId: string; name: string | null; photos: number; box: [number, number, number, number] };

/** Faces kept per photo, largest first: a crowd shot beyond this is mostly unrecognisable faces anyway. */
export const MAX_FACES_PER_PHOTO = 40;

/** One face found while indexing. `box` is [x, y, w, h] as fractions of the photo. */
export type FaceHit = { embedding: string; box: [number, number, number, number] };

/** One scanned photo. `faces` empty = no faces; `failed` = the preview couldn't be read (not retried). */
export type ScanResult = { id: string; faces: FaceHit[]; failed?: boolean };

export type FaceIndexStatus = { images: number; scanned: number; faces: number };

export function packEmbedding(v: Float32Array): string {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Null unless it decodes to EMBEDDING_DIM finite numbers. */
export function unpackEmbedding(b64: string): number[] | null {
  if (typeof b64 !== "string" || b64.length > 8000) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return null;
  }
  if (bin.length !== EMBEDDING_DIM * 4) return null;
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const v = Array.from(new Float32Array(bytes.buffer));
  return v.every(Number.isFinite) ? v : null;
}

/** pgvector text literal. */
export const toVector = (v: number[]) => `[${v.join(",")}]`;
