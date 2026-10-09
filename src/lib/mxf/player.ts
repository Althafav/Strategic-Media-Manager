/**
 * Plays an original MXF file (XAVC: H.264 + PCM) in a <video> element without transcoding: the file is read
 * straight from OneDrive with range requests, its content packages are remuxed into fragmented MP4 (video
 * frames untouched, PCM wrapped losslessly as FLAC) and fed to Media Source Extensions. Only a short window
 * around the playhead is kept in memory. Browser-only; loaded lazily by components/mxf-player.tsx.
 */
import { BusyError, fetchRetry } from "@/lib/fetch-retry";
import { avcConfig, nalUnits, toSample, type AvcConfig } from "./avc";
import { flacFrame, streamInfo, supportedPcm } from "./flac";
import { fragment, initSegment, type Sample } from "./fmp4";
import {
  buildIndex,
  isIntra,
  parseMetadata,
  readKlv,
  readPackages,
  readPartitionPack,
  type ContentPackage,
  type IndexTable,
  type PictureInfo,
  type SoundInfo,
} from "./klv";

/** The browser can't decode this file (codec/profile), or it isn't an MXF we understand. */
export class UnsupportedError extends Error {
  name = "UnsupportedError";
}

const HEAD_BYTES = 1 << 20;
const MAX_HEADER_BYTES = 64 << 20; // header metadata + index we're willing to read up front
const CHUNK_BYTES = 16 << 20; // one range request
const PARSE_BYTES = 2 << 20; // parse whenever this much new data has arrived
const AHEAD_S = 15;
const BEHIND_S = 10;
const URL_MAX_AGE_MS = 45 * 60 * 1000; // download URLs live about an hour

type Layout = {
  size: number;
  essenceStart: number;
  picture: PictureInfo;
  sound: SoundInfo | null;
  soundTracks: number;
  index: IndexTable | null;
  /** Stored edit unit shown at each display position (inverse of index.pts). */
  storedAt: Int32Array | null;
  frames: number;
};

type PendingAudio = { start: number; samples: Sample[] };

export class MxfPlayback {
  private readonly ms = new MediaSource();
  private videoSb!: SourceBuffer;
  private audioSb: SourceBuffer | null = null;
  private url = "";
  private urlAt = 0;
  private run: { controller: AbortController; done: Promise<void> } | null = null;
  private sequence = 0;
  private destroyed = false;
  private readonly objectUrl: string;
  private readonly videoScale: number;
  private readonly frameTicks: number;

  private constructor(
    private readonly video: HTMLVideoElement,
    private readonly source: () => Promise<string>,
    private readonly onError: (e: unknown) => void,
    private readonly layout: Layout,
    private readonly codec: { video: string; avcC: Uint8Array; audio: boolean },
  ) {
    const { num, den } = layout.picture.editRate;
    const k = den === 1 ? 1000 : 1;
    this.videoScale = num * k;
    this.frameTicks = den * k;
    this.objectUrl = URL.createObjectURL(this.ms);
  }

  /**
   * Reads the file's header and checks the browser can decode it, then starts playback into `video`.
   * `source` returns a fresh pre-authenticated URL for the file and `size` is its length in bytes (OneDrive
   * doesn't expose Content-Range to scripts). Throws UnsupportedError or BusyError.
   */
  static async open(video: HTMLVideoElement, source: () => Promise<string>, size: number, onError: (e: unknown) => void, signal?: AbortSignal) {
    const reader = new RangeReader(source, size);
    const layout = await readLayout(reader, signal);
    const first = await reader.bytes(layout.essenceStart, Math.min(layout.size, layout.essenceStart + (2 << 20)), signal);
    const configs: AvcConfig[] = [];
    readPackages(first, (cp) => {
      const config = !configs.length && cp.picture && avcConfig(nalUnits(cp.picture));
      if (config) configs.push(config);
    }, true);
    if (!configs.length) throw new UnsupportedError("No H.264 picture track found");
    const [{ codec: videoCodec, avcC }] = configs;
    if (!window.MediaSource?.isTypeSupported(`video/mp4; codecs="${videoCodec}"`)) throw new UnsupportedError(`Codec ${videoCodec} not supported`);
    const s = layout.sound;
    const audio = !!s && supportedPcm(s.sampleRate, s.bits, Math.min(2, layout.soundTracks * s.channels)) && MediaSource.isTypeSupported('audio/mp4; codecs="flac"');
    const playback = new MxfPlayback(video, source, onError, layout, { video: videoCodec, avcC, audio });
    playback.url = reader.url;
    playback.urlAt = reader.urlAt;
    await playback.attach();
    return playback;
  }

  destroy() {
    this.destroyed = true;
    this.run?.controller.abort();
    this.video.removeEventListener("seeking", this.onSeeking);
    this.video.removeAttribute("src");
    this.video.load();
    URL.revokeObjectURL(this.objectUrl);
  }

  private async attach() {
    const opened = new Promise((resolve) => this.ms.addEventListener("sourceopen", resolve, { once: true }));
    this.video.src = this.objectUrl;
    await opened;
    const { picture, sound, soundTracks, frames } = this.layout;
    // Every SourceBuffer must exist before the first append: Chrome refuses to add one afterwards.
    this.videoSb = this.ms.addSourceBuffer(`video/mp4; codecs="${this.codec.video}"`);
    if (this.codec.audio && sound) this.audioSb = this.ms.addSourceBuffer('audio/mp4; codecs="flac"');
    await this.append(this.videoSb, initSegment({ kind: "video", timescale: this.videoScale, width: picture.width, height: picture.height, avcC: this.codec.avcC }));
    if (this.audioSb && sound) {
      const channels = Math.min(2, soundTracks * sound.channels);
      await this.append(this.audioSb, initSegment({ kind: "audio", timescale: sound.sampleRate, channels, bits: sound.bits, sampleRate: sound.sampleRate, dfLa: streamInfo(sound.sampleRate, sound.bits, channels) }));
    }
    if (frames) this.ms.duration = (frames * picture.editRate.den) / picture.editRate.num;
    this.video.addEventListener("seeking", this.onSeeking);
    this.start(0);
  }

  private readonly onSeeking = () => {
    const t = this.video.currentTime;
    if (this.isBuffered(t)) return;
    const { editRate } = this.layout.picture;
    this.start(Math.floor((t * editRate.num) / editRate.den + 1e-6));
  };

  private isBuffered(t: number) {
    return [this.videoSb, this.audioSb].every((sb) => {
      if (!sb) return true;
      for (let i = 0; i < sb.buffered.length; i++) if (sb.buffered.start(i) <= t + 0.1 && t < sb.buffered.end(i) - 0.2) return true;
      return false;
    });
  }

  /** Restarts reading at display position `display` (0 = the beginning). */
  private start(display: number) {
    const previous = this.run;
    previous?.controller.abort();
    const controller = new AbortController();
    const done = (async () => {
      await previous?.done.catch(() => {});
      if (controller.signal.aborted) return;
      if (previous) await this.clearBuffers();
      await this.pump(display, controller.signal);
    })().catch((e) => {
      if (!controller.signal.aborted && !this.destroyed) this.onError(e);
    });
    this.run = { controller, done };
  }

  private async clearBuffers() {
    for (const sb of [this.videoSb, this.audioSb]) {
      if (!sb) continue;
      await idle(sb);
      if (sb.buffered.length) {
        sb.remove(0, Infinity);
        await idle(sb);
      }
    }
  }

  /** Reads the essence from the first decodable edit unit at or before `display` onwards, appending as it goes. */
  private async pump(display: number, signal: AbortSignal) {
    const { size, essenceStart, index, storedAt, frames, sound, picture } = this.layout;
    const target = Math.max(0, Math.min(display, Math.max(0, frames - 1)));
    let stored = target;
    let pos: number;
    if (index && storedAt) {
      stored = storedAt[target] ?? target;
      // Back up to an intra frame that is shown no later than the target (open-GOP leading frames aren't).
      while (stored > 0 && (!isIntra(index.flags[stored]) || index.pts[stored] > target)) stored--;
      pos = essenceStart + index.offsets[stored];
    } else {
      pos = target ? essenceStart + Math.floor(((size - essenceStart) * target) / Math.max(1, frames)) : essenceStart;
    }
    const startPts = index ? index.pts[stored] : -1;
    const { num, den } = picture.editRate;
    let audioSample = sound ? Math.round((stored * sound.sampleRate * den) / num) : 0;
    let needKey = true;
    let video: (Sample & { dts: number })[] = [];
    let audio: PendingAudio = { start: audioSample, samples: [] };
    const flushEvery = Math.max(6, Math.round(num / den / 2));

    const flush = async () => {
      if (video.length) {
        const frag = fragment(++this.sequence, video[0].dts, video);
        video = [];
        await this.append(this.videoSb, frag, signal);
      }
      if (this.audioSb && audio.samples.length) {
        const frag = fragment(++this.sequence, audio.start, audio.samples);
        audio = { start: audioSample, samples: [] };
        await this.append(this.audioSb, frag, signal);
      }
    };

    const onPackage = (cp: ContentPackage) => {
      const s = stored++;
      const nals = nalUnits(cp.picture!);
      const flags = index?.flags[s];
      const sync = flags !== undefined ? isIntra(flags) : nals.some((n) => (n[0] & 31) === 5 || (n[0] & 31) === 7);
      if (needKey && !sync) return; // no index: wait for a frame decoding can start from
      needKey = false;
      const pts = index && s < index.pts.length ? index.pts[s] : s;
      if (pts < startPts) {
        // A leading frame of the GOP we started in: it needs the previous GOP, so skip it but keep the timeline.
        if (video.length) video[video.length - 1].duration += this.frameTicks;
      } else {
        video.push({ data: toSample(nals), duration: this.frameTicks, sync, cto: (pts - s) * this.frameTicks, dts: s * this.frameTicks });
      }
      if (this.audioSb && sound) {
        const frame = this.audioFrame(cp, sound, audioSample);
        if (frame) {
          audio.samples.push(frame);
          audioSample += frame.duration;
        }
      }
    };

    let parts: Uint8Array[] = [];
    let partBytes = 0;
    let carry = new Uint8Array(0);
    let carryAt = pos; // file offset of carry[0]
    const parse = async (final: boolean) => {
      const data = parts.length ? concat(carry, ...parts) : carry;
      parts = [];
      partBytes = 0;
      const used = readPackages(data, onPackage, final);
      carry = data.slice(used);
      carryAt += used;
      if (video.length >= flushEvery || final) await flush();
    };

    while (carryAt < size && (!frames || stored < frames)) {
      await this.waitForRoom(signal);
      const from = carryAt + carry.length;
      const to = Math.min(size, from + CHUNK_BYTES);
      try {
        const res = await this.fetchRange(from, to, signal);
        const body = res.body!.getReader();
        for (;;) {
          const { done, value } = await body.read();
          if (done) break;
          parts.push(value);
          partBytes += value.length;
          if (partBytes >= PARSE_BYTES) await parse(false);
        }
        await parse(to >= size);
      } catch (e) {
        // A dropped connection mid-chunk: carry on from what was parsed (fetchRange already retried busy errors).
        if (signal.aborted || !(e instanceof TypeError)) throw e;
        parts = [];
        partBytes = 0;
        carry = new Uint8Array(0);
        await sleep(1000, signal);
      }
      if (to >= size) break;
    }
    await flush();
    await this.finish(signal);
  }

  /** The current package's sound as one FLAC frame: the first two channels across the sound elements. */
  private audioFrame(cp: ContentPackage, sound: SoundInfo, firstSample: number): Sample | null {
    const bytes = Math.ceil(sound.bits / 8);
    const channels: Int32Array[] = [];
    for (const element of cp.sound) {
      if (!element) continue;
      const n = Math.floor(element.length / sound.blockAlign);
      for (let c = 0; c < sound.channels && channels.length < 2; c++) {
        const out = new Int32Array(n);
        for (let i = 0, p = c * bytes; i < n; i++, p += sound.blockAlign) {
          let v = 0;
          for (let k = bytes - 1; k >= 0; k--) v = (v << 8) | element[p + k];
          out[i] = (v << (32 - 8 * bytes)) >> (32 - 8 * bytes);
        }
        channels.push(out);
      }
      if (channels.length >= 2) break;
    }
    if (!channels.length || !channels[0].length) return null;
    const expected = Math.min(2, this.layout.soundTracks * sound.channels);
    while (channels.length < expected) channels.push(channels[0]);
    return { data: flacFrame(channels, sound.sampleRate, sound.bits, firstSample), duration: channels[0].length, sync: true };
  }

  private async finish(signal: AbortSignal) {
    for (const sb of [this.videoSb, this.audioSb]) if (sb) await idle(sb);
    if (!signal.aborted && this.ms.readyState === "open") this.ms.endOfStream();
  }

  /** Waits while more than AHEAD_S seconds are buffered past the playhead. */
  private async waitForRoom(signal: AbortSignal) {
    while (!signal.aborted) {
      const t = this.video.currentTime;
      const b = this.videoSb.buffered;
      let end = t;
      for (let i = 0; i < b.length; i++) if (b.start(i) <= t + 0.5 && b.end(i) > end) end = b.end(i);
      if (end - t < AHEAD_S) return;
      await sleep(500, signal);
    }
    signal.throwIfAborted();
  }

  private async append(sb: SourceBuffer, data: Uint8Array, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      signal?.throwIfAborted();
      await idle(sb);
      await this.evict(sb, attempt ? 2 : BEHIND_S);
      signal?.throwIfAborted();
      try {
        sb.appendBuffer(data as Uint8Array<ArrayBuffer>);
        await idle(sb);
        return;
      } catch (e) {
        if (!(e instanceof DOMException && e.name === "QuotaExceededError") || attempt >= 3) throw e;
        await sleep(1000, signal);
      }
    }
  }

  /** Drops what lies more than `behind` seconds before the playhead. */
  private async evict(sb: SourceBuffer, behind: number) {
    const cut = this.video.currentTime - behind;
    if (sb.buffered.length && sb.buffered.start(0) < cut) {
      sb.remove(0, cut);
      await idle(sb);
    }
  }

  private async fetchRange(from: number, to: number, signal: AbortSignal) {
    let tries = 0;
    const res = await fetchRetry(
      async () => {
        if (tries++ || !this.url || Date.now() - this.urlAt > URL_MAX_AGE_MS) {
          this.url = await this.source();
          this.urlAt = Date.now();
        }
        return this.url;
      },
      async (r) => r,
      signal,
      { headers: { range: `bytes=${from}-${to - 1}` } },
    );
    if (res.status !== 206) {
      res.body?.cancel().catch(() => {});
      throw new Error(`OneDrive answered ${res.status} to a range request`);
    }
    return res;
  }
}

/** Range reads for the header, sharing the URL refresh logic. */
class RangeReader {
  url = "";
  urlAt = 0;
  constructor(
    private readonly source: () => Promise<string>,
    readonly size: number,
  ) {}

  async bytes(from: number, to: number, signal?: AbortSignal): Promise<Uint8Array> {
    let tries = 0;
    return fetchRetry(
      async () => {
        if (tries++ || !this.url) {
          this.url = await this.source();
          this.urlAt = Date.now();
        }
        return this.url;
      },
      async (res) => {
        if (res.status !== 206) throw new Error(`OneDrive answered ${res.status} to a range request`);
        return new Uint8Array(await res.arrayBuffer());
      },
      signal,
      { headers: { range: `bytes=${from}-${to - 1}` } },
    );
  }
}

async function readLayout(reader: RangeReader, signal?: AbortSignal): Promise<Layout> {
  const size = reader.size;
  let head = await reader.bytes(0, Math.min(size, HEAD_BYTES), signal);
  const pack = readPartitionPack(head, 0);
  if (!pack) throw new UnsupportedError("Not an MXF file");
  let essenceStart = pack.after + pack.headerBytes + pack.indexBytes;
  if (essenceStart > MAX_HEADER_BYTES || essenceStart >= size) throw new UnsupportedError("Unexpected MXF layout");
  if (essenceStart + 65536 > head.length && head.length < size) {
    head = concat(head, await reader.bytes(head.length, Math.min(size, essenceStart + 65536), signal));
  }
  essenceStart = firstEssence(head, essenceStart, pack.after);
  const meta = parseMetadata(head, pack.after, essenceStart);
  let segments = meta.segments;
  if (!segments.length && pack.footer > 0 && size - pack.footer <= MAX_HEADER_BYTES) {
    // Index written at the end of the file instead.
    const footer = await reader.bytes(pack.footer, size, signal);
    segments = parseMetadata(footer).segments;
  }
  if (!meta.picture) throw new UnsupportedError("No picture track described");
  const index = buildIndex(segments);
  let storedAt: Int32Array | null = null;
  if (index) {
    storedAt = new Int32Array(index.pts.length).map((_, i) => i);
    index.pts.forEach((display, stored) => {
      if (display >= 0 && display < storedAt!.length) storedAt![display] = stored;
    });
  }
  return {
    size,
    essenceStart,
    picture: meta.picture,
    sound: meta.sound[0] ?? null,
    soundTracks: meta.sound.length,
    index,
    storedAt,
    frames: index?.offsets.length || meta.picture.duration,
  };
}

/** The computed essence start if a packet starts there, else the first essence key after the header. */
function firstEssence(b: Uint8Array, guess: number, from: number) {
  const isEssence = (p: number) => b[p + 8] === 0x0d && b[p + 9] === 0x01 && b[p + 10] === 0x03 && b[p + 11] === 0x01;
  if (readKlv(b, guess, false) && isEssence(guess)) return guess;
  for (let p = from; p < b.length; ) {
    const klv = readKlv(b, p, false);
    if (!klv) break;
    if (isEssence(p)) return p;
    p = klv.end;
  }
  throw new UnsupportedError("Essence not found");
}

function idle(sb: SourceBuffer) {
  return sb.updating ? new Promise<void>((resolve, reject) => {
    const done = () => {
      sb.removeEventListener("updateend", done);
      sb.removeEventListener("error", fail);
      resolve();
    };
    const fail = () => {
      sb.removeEventListener("updateend", done);
      sb.removeEventListener("error", fail);
      reject(new Error("The browser could not decode this video"));
    };
    sb.addEventListener("updateend", done);
    sb.addEventListener("error", fail);
  }) : Promise.resolve();
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
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

export { BusyError };
