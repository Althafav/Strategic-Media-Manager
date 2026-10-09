/**
 * MXF (SMPTE 377) reading: KLV packets, the header partition (descriptors + index table) and the essence
 * stream of frame-wrapped content packages. Only what the in-browser player needs: one AVC picture track
 * and PCM sound tracks, as written by Sony XAVC cameras. Pure functions over byte arrays, no I/O.
 */

export type Rational = { num: number; den: number };

export type Klv = { key: number; valueStart: number; length: number; end: number };

/** Key prefix shared by every SMPTE UL. */
const isUl = (b: Uint8Array, p: number) => b[p] === 0x06 && b[p + 1] === 0x0e && b[p + 2] === 0x2b && b[p + 3] === 0x34;

/** Bytes 8..15 of a key as hex: enough to tell the packets we care about apart (byte 7, the version, is ignored). */
export const keyTail = (b: Uint8Array, p: number) => {
  let s = "";
  for (let i = p + 8; i < p + 16; i++) s += b[i].toString(16).padStart(2, "0");
  return s;
};

/** Reads the KLV header at `p`. Null when the buffer ends before the value does (or isn't a KLV). */
export function readKlv(b: Uint8Array, p: number, needValue = true): Klv | null {
  if (p + 17 > b.length || !isUl(b, p)) return null;
  let length = b[p + 16];
  let valueStart = p + 17;
  if (length & 0x80) {
    const n = length & 0x7f;
    if (n > 8 || valueStart + n > b.length) return null;
    length = 0;
    for (let i = 0; i < n; i++) length = length * 256 + b[valueStart + i];
    valueStart += n;
  }
  const end = valueStart + length;
  if (needValue && end > b.length) return null;
  return { key: p, valueStart, length, end };
}

const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const u64 = (b: Uint8Array, p: number) => u32(b, p) * 2 ** 32 + u32(b, p + 4);
const rational = (b: Uint8Array, p: number): Rational => ({ num: u32(b, p), den: u32(b, p + 4) });

/** Iterates the 2-byte tag / 2-byte length items of a local set. */
function* localSet(b: Uint8Array, klv: Klv): Generator<[tag: number, p: number, len: number]> {
  for (let p = klv.valueStart; p + 4 <= klv.end; ) {
    const tag = u16(b, p);
    const len = u16(b, p + 2);
    yield [tag, p + 4, len];
    p += 4 + len;
  }
}

// keyTail values (key bytes 8..15).
const PARTITION = /^0d010201010[234]/; // header / body / footer partition packs
const FILL = "0301021001000000"; // KLV fill (key 06 0e 2b 34 01 01 01 0x 03 01 02 10 01 ...)
const INDEX_SEGMENT = "0d01020101100100";
const descriptorType = (b: Uint8Array, p: number) =>
  b[p + 4] === 0x02 && b[p + 5] === 0x53 && keyTail(b, p).startsWith("0d0101010101") ? b[p + 14] : -1;
const CDCI = 0x28;
const RGBA = 0x29;
const MPEG_VIDEO = 0x51;
const AES3 = 0x47;
const WAVE = 0x48;
const GENERIC_SOUND = 0x42;

export type PartitionPack = {
  kag: number;
  footer: number;
  headerBytes: number;
  indexBytes: number;
  bodySid: number;
  /** First byte after the pack and the fill that follows it: where header metadata starts. */
  after: number;
};

export function readPartitionPack(b: Uint8Array, p: number): PartitionPack | null {
  const klv = readKlv(b, p);
  if (!klv || !PARTITION.test(keyTail(b, p))) return null;
  const v = klv.valueStart;
  let after = klv.end;
  for (let k = readKlv(b, after); k && keyTail(b, after) === FILL; k = readKlv(b, after)) after = k.end;
  return { kag: u32(b, v + 4), footer: u64(b, v + 24), headerBytes: u64(b, v + 32), indexBytes: u64(b, v + 40), bodySid: u32(b, v + 60), after };
}

export type PictureInfo = { editRate: Rational; duration: number; width: number; height: number; interlaced: boolean };
export type SoundInfo = { sampleRate: number; bits: number; channels: number; blockAlign: number };

export type IndexTable = {
  editRate: Rational;
  /** Per stored (decode-order) edit unit: byte offset into the essence stream. */
  offsets: Float64Array;
  /** Per stored edit unit: MXF index flags (0x80 random access, 0x30 prediction bits: none = intra). */
  flags: Uint8Array;
  /** Display position of each stored edit unit (from the temporal offsets). */
  pts: Int32Array;
};

export type HeaderInfo = { picture: PictureInfo | null; sound: SoundInfo[]; index: IndexTable | null };

type Segment = { start: number; count: number; entries: Uint8Array; entryLen: number; eubc: number; editRate: Rational };

/** Parses descriptors and index table segments found anywhere in `b` (header metadata, index, or a footer). */
export function parseMetadata(b: Uint8Array, from = 0, to = b.length): { picture: PictureInfo | null; sound: SoundInfo[]; segments: Segment[] } {
  let picture: PictureInfo | null = null;
  const sound: SoundInfo[] = [];
  const segments: Segment[] = [];
  for (let p = from; p < to; ) {
    const klv = readKlv(b, p);
    if (!klv) break;
    const type = descriptorType(b, p);
    if (type === CDCI || type === RGBA || type === MPEG_VIDEO) {
      const d: Partial<PictureInfo> & { layout?: number; storedW?: number; storedH?: number } = {};
      for (const [tag, v] of localSet(b, klv)) {
        if (tag === 0x3001) d.editRate = rational(b, v);
        else if (tag === 0x3002) d.duration = u64(b, v);
        else if (tag === 0x320c) d.layout = b[v];
        else if (tag === 0x3209) d.width = u32(b, v);
        else if (tag === 0x3208) d.height = u32(b, v);
        else if (tag === 0x3203) d.storedW = u32(b, v);
        else if (tag === 0x3202) d.storedH = u32(b, v);
      }
      const interlaced = d.layout === 1 || d.layout === 3 || d.layout === 4;
      const height = (d.height ?? d.storedH ?? 0) * (interlaced ? 2 : 1);
      if (d.editRate) picture = { editRate: d.editRate, duration: d.duration ?? 0, width: d.width ?? d.storedW ?? 0, height, interlaced };
    } else if (type === AES3 || type === WAVE || type === GENERIC_SOUND) {
      const s: Partial<SoundInfo> = {};
      for (const [tag, v] of localSet(b, klv)) {
        if (tag === 0x3d03) s.sampleRate = Math.round(rational(b, v).num / rational(b, v).den);
        else if (tag === 0x3d01) s.bits = u32(b, v);
        else if (tag === 0x3d07) s.channels = u32(b, v);
        else if (tag === 0x3d0a) s.blockAlign = u16(b, v);
      }
      if (s.sampleRate && s.bits && s.channels) sound.push({ blockAlign: Math.ceil(s.bits / 8) * s.channels, ...s } as SoundInfo);
    } else if (keyTail(b, p) === INDEX_SEGMENT) {
      const seg: Partial<Segment> = { eubc: 0 };
      for (const [tag, v, len] of localSet(b, klv)) {
        if (tag === 0x3f0b) seg.editRate = rational(b, v);
        else if (tag === 0x3f0c) seg.start = u64(b, v);
        else if (tag === 0x3f0d) seg.count = u64(b, v);
        else if (tag === 0x3f05) seg.eubc = u32(b, v);
        else if (tag === 0x3f0a && len >= 8) {
          seg.entryLen = u32(b, v + 4);
          seg.entries = b.subarray(v + 8, v + len);
        }
      }
      if (seg.editRate && seg.start !== undefined && seg.count !== undefined) segments.push(seg as Segment);
    }
    p = klv.end;
  }
  return { picture, sound, segments };
}

/** Joins index segments into one table. Null without usable entries (CBR-only indexes aren't needed here). */
export function buildIndex(segments: Segment[]): IndexTable | null {
  const vbr = segments.filter((s) => s.entries && s.entryLen >= 11).sort((a, b) => a.start - b.start);
  if (!vbr.length) return null;
  const total = Math.max(...vbr.map((s) => s.start + Math.min(s.count, Math.floor(s.entries.length / s.entryLen))));
  const offsets = new Float64Array(total);
  const flags = new Uint8Array(total);
  const temporal = new Int8Array(total);
  for (const s of vbr) {
    const n = Math.min(s.count, Math.floor(s.entries.length / s.entryLen));
    for (let i = 0; i < n; i++) {
      const e = i * s.entryLen;
      temporal[s.start + i] = (s.entries[e] << 24) >> 24;
      flags[s.start + i] = s.entries[e + 2];
      offsets[s.start + i] = u64(s.entries, e + 3);
    }
  }
  // Entry x's temporal offset says display position x is stored at x + offset (as ffmpeg reads it).
  const pts = new Int32Array(total).map((_, i) => i);
  for (let x = 0; x < total; x++) {
    const stored = x + temporal[x];
    if (stored >= 0 && stored < total) pts[stored] = x;
  }
  return { editRate: vbr[0].editRate, offsets, flags, pts };
}

/** An intra-coded edit unit: a place decoding can start from. */
export const isIntra = (flags: number) => (flags & 0x80) !== 0 || (flags & 0x30) === 0;

export type ContentPackage = { picture: Uint8Array | null; sound: Uint8Array[] };

/**
 * Splits frame-wrapped essence into content packages. A package starts at a system item pack, or at a
 * picture element when the current package already has one (files without system items). Partition packs,
 * index segments and fill met on the way are skipped. Returns how many bytes were consumed; the caller
 * keeps the rest for the next call.
 */
export function readPackages(b: Uint8Array, onPackage: (cp: ContentPackage) => void, final: boolean): number {
  let p = 0;
  let cp = null as ContentPackage | null; // assigned inside begin(), which TS flow analysis can't see
  let cpStart = 0;
  const begin = (at: number): ContentPackage => {
    if (cp?.picture) onPackage(cp);
    cpStart = at;
    return (cp = { picture: null, sound: [] });
  };
  while (p < b.length) {
    if (!isUl(b, p)) {
      // Landed mid-packet (an estimated seek): resync on the next key.
      const next = findUl(b, p + 1);
      if (next < 0) return final ? b.length : Math.max(p, b.length - 16);
      p = next;
      continue;
    }
    const klv = readKlv(b, p);
    if (!klv) break;
    // Essence keys: bytes 8..11 = 0d 01 03 01, byte 12 = item type, byte 15 = element number.
    if (b[p + 8] === 0x0d && b[p + 9] === 0x01 && b[p + 10] === 0x03 && b[p + 11] === 0x01) {
      const item = b[p + 12];
      const value = b.subarray(klv.valueStart, klv.end);
      if ((item === 0x04 || item === 0x05) && b[p + 5] === 0x05) begin(p);
      else if (item === 0x15) {
        const target: ContentPackage = !cp || cp.picture ? begin(p) : cp;
        target.picture = value;
      } else if (item === 0x16 && cp) cp.sound[b[p + 15]] = value;
    }
    p = klv.end;
  }
  if (final) {
    if (cp?.picture) onPackage(cp);
    return b.length;
  }
  // Keep the unfinished package for the next call.
  return cp ? cpStart : p;
}

function findUl(b: Uint8Array, from: number) {
  for (let i = from; i + 4 <= b.length; i++) if (b[i] === 0x06 && isUl(b, i)) return i;
  return -1;
}
