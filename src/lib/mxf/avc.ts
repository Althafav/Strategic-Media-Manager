/** H.264 helpers for remuxing Annex-B access units (as stored in MXF) into MP4 samples. */

/** NAL unit payloads of an Annex-B stream (start codes removed). */
export function nalUnits(b: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  let start = -1;
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] !== 0 || b[i + 1] !== 0 || b[i + 2] !== 1) continue;
    if (start >= 0) out.push(trimZeros(b.subarray(start, i)));
    start = i + 3;
    i += 2;
  }
  if (start >= 0 && start < b.length) out.push(trimZeros(b.subarray(start)));
  return out.filter((n) => n.length);
}

/** Drops the zero bytes that belong to the next (4-byte) start code. */
function trimZeros(n: Uint8Array) {
  let end = n.length;
  while (end > 0 && n[end - 1] === 0) end--;
  return n.subarray(0, end);
}

const AUD = 9;
const FILLER = 12;

/** One access unit as an MP4 sample: 4-byte length-prefixed NAL units, without delimiters and filler. */
export function toSample(nals: Uint8Array[]): Uint8Array {
  const kept = nals.filter((n) => (n[0] & 31) !== AUD && (n[0] & 31) !== FILLER);
  const out = new Uint8Array(kept.reduce((s, n) => s + 4 + n.length, 0));
  const view = new DataView(out.buffer);
  let p = 0;
  for (const n of kept) {
    view.setUint32(p, n.length);
    out.set(n, p + 4);
    p += 4 + n.length;
  }
  return out;
}

export type AvcConfig = { codec: string; avcC: Uint8Array };

/** Decoder config (avcC box payload + MSE codec string) from the first SPS/PPS, or null if absent. */
export function avcConfig(nals: Uint8Array[]): AvcConfig | null {
  const sps = nals.find((n) => (n[0] & 31) === 7);
  const pps = nals.find((n) => (n[0] & 31) === 8);
  if (!sps || !pps || sps.length < 4) return null;
  const [profile, compat, level] = [sps[1], sps[2], sps[3]];
  const ext = [100, 110, 122, 144].includes(profile) ? highProfileFields(sps) : null;
  const avcC = new Uint8Array(11 + sps.length + pps.length + (ext ? 4 : 0));
  avcC.set([1, profile, compat, level, 0xff, 0xe1, sps.length >> 8, sps.length & 255]);
  avcC.set(sps, 8);
  let p = 8 + sps.length;
  avcC.set([1, pps.length >> 8, pps.length & 255], p);
  avcC.set(pps, p + 3);
  p += 3 + pps.length;
  if (ext) avcC.set([0xfc | ext.chroma, 0xf8 | ext.lumaDepth, 0xf8 | ext.chromaDepth, 0], p);
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return { codec: `avc1.${hex(profile)}${hex(compat)}${hex(level)}`, avcC };
}

/** chroma_format_idc and bit depths, which avcC repeats for the high profiles. */
function highProfileFields(sps: Uint8Array) {
  const r = new BitReader(unescape(sps.subarray(4)));
  r.ue(); // seq_parameter_set_id
  const chroma = r.ue();
  if (chroma === 3) r.bit();
  return { chroma, lumaDepth: r.ue(), chromaDepth: r.ue() };
}

/** Removes emulation-prevention bytes (00 00 03 -> 00 00). */
function unescape(b: Uint8Array) {
  const out: number[] = [];
  for (let i = 0; i < b.length; i++) {
    if (i >= 2 && b[i] === 3 && b[i - 1] === 0 && b[i - 2] === 0) continue;
    out.push(b[i]);
  }
  return Uint8Array.from(out);
}

class BitReader {
  private pos = 0;
  constructor(private b: Uint8Array) {}
  bit() {
    const v = (this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  ue() {
    let zeros = 0;
    while (this.pos < this.b.length * 8 && !this.bit()) zeros++;
    let v = 0;
    for (let i = 0; i < zeros; i++) v = v * 2 + this.bit();
    return 2 ** zeros - 1 + v;
  }
}
