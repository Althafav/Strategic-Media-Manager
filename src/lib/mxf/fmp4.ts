/** Minimal fragmented-MP4 writer for Media Source Extensions: one track per init segment / fragment. */

type Bytes = Uint8Array | number[];

function box(type: string, ...parts: Bytes[]): Uint8Array {
  const size = 8 + parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(size);
  new DataView(out.buffer).setUint32(0, size);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let p = 8;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const full = (type: string, version: number, flags: number, ...parts: Bytes[]) =>
  box(type, [version, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255], ...parts);

const u16 = (v: number) => [(v >> 8) & 255, v & 255];
const u32 = (v: number) => [(v >>> 24) & 255, (v >> 16) & 255, (v >> 8) & 255, v & 255];
const u64 = (v: number) => [...u32(Math.floor(v / 2 ** 32)), ...u32(v >>> 0)];
const zeros = (n: number) => new Array<number>(n).fill(0);
const MATRIX = [...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x10000), ...u32(0), ...u32(0), ...u32(0), ...u32(0x40000000)];

export type VideoTrack = { kind: "video"; timescale: number; width: number; height: number; avcC: Uint8Array };
export type AudioTrack = { kind: "audio"; timescale: number; channels: number; bits: number; sampleRate: number; dfLa: Uint8Array };
export type Track = VideoTrack | AudioTrack;

const TRACK_ID = 1;

export function initSegment(track: Track): Uint8Array {
  const video = track.kind === "video";
  const sampleEntry = video
    ? box(
        "avc1",
        zeros(6), u16(1), // reserved, data_reference_index
        zeros(16), u16(track.width), u16(track.height),
        u32(0x00480000), u32(0x00480000), u32(0), u16(1), // 72 dpi, reserved, frame_count
        zeros(32), u16(0x18), u16(0xffff), // compressorname, depth, pre_defined
        box("avcC", track.avcC),
      )
    : box(
        "fLaC",
        zeros(6), u16(1),
        zeros(8), u16(track.channels), u16(track.bits), u16(0), u16(0), u32(track.sampleRate << 16), // sample size must match STREAMINFO
        full("dfLa", 0, 0, track.dfLa),
      );
  const stbl = box(
    "stbl",
    full("stsd", 0, 0, u32(1), sampleEntry),
    full("stts", 0, 0, u32(0)),
    full("stsc", 0, 0, u32(0)),
    full("stsz", 0, 0, u32(0), u32(0)),
    full("stco", 0, 0, u32(0)),
  );
  const minf = box(
    "minf",
    video ? full("vmhd", 0, 1, zeros(8)) : full("smhd", 0, 0, zeros(4)),
    box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1))),
    stbl,
  );
  const mdia = box(
    "mdia",
    full("mdhd", 0, 0, u32(0), u32(0), u32(track.timescale), u32(0), u16(0x55c4), u16(0)), // language "und"
    full("hdlr", 0, 0, u32(0), [...(video ? "vide" : "soun")].map((c) => c.charCodeAt(0)), zeros(12), [0]),
    minf,
  );
  const tkhd = full(
    "tkhd", 0, 3, // enabled, in movie
    u32(0), u32(0), u32(TRACK_ID), u32(0), u32(0), // times, track id, reserved, duration
    zeros(8), u16(0), u16(0), u16(video ? 0 : 0x100), u16(0), // reserved, layer, group, volume
    MATRIX,
    u32(video ? track.width << 16 : 0), u32(video ? track.height << 16 : 0),
  );
  const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(0), u32(0x10000), u16(0x100), zeros(10), MATRIX, zeros(24), u32(TRACK_ID + 1));
  const mvex = box("mvex", full("trex", 0, 0, u32(TRACK_ID), u32(1), u32(0), u32(0), u32(0)));
  return concat(box("ftyp", [...("isom" + "\0\0\0\x01" + "isomiso6mp41")].map((c) => c.charCodeAt(0))), box("moov", mvhd, box("trak", tkhd, mdia), mvex));
}

export type Sample = { data: Uint8Array; duration: number; sync: boolean; cto?: number };

/** One `moof` + `mdat` holding `samples`, whose first decode time is `baseTime` (track timescale). */
export function fragment(sequence: number, baseTime: number, samples: Sample[]): Uint8Array {
  // trun: data offset, duration, size, flags, composition offset (signed, version 1).
  const entries = samples.flatMap((s) => [
    ...u32(s.duration),
    ...u32(s.data.length),
    ...u32(s.sync ? 0x02000000 : 0x01010000), // depends on nothing / is a non-sync sample
    ...u32((s.cto ?? 0) | 0),
  ]);
  const build = (dataOffset: number) =>
    box(
      "moof",
      full("mfhd", 0, 0, u32(sequence)),
      box(
        "traf",
        full("tfhd", 0, 0x020000, u32(TRACK_ID)), // default-base-is-moof
        full("tfdt", 1, 0, u64(baseTime)),
        full("trun", 1, 0x000f01, u32(samples.length), u32(dataOffset), entries),
      ),
    );
  const moofSize = build(0).length;
  const moof = build(moofSize + 8);
  const mdat = box("mdat", ...samples.map((s) => s.data));
  return concat(moof, mdat);
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
