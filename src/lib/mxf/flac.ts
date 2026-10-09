/**
 * Wraps PCM in FLAC "verbatim" frames: the samples are stored as-is (no compression, bit-identical), which
 * MSE accepts in MP4 where raw PCM is not. Variable block size, so each frame carries its first sample number.
 */

const RATE_CODES: Record<number, number> = { 88200: 0b0001, 176400: 0b0010, 192000: 0b0011, 8000: 0b0100, 16000: 0b0101, 22050: 0b0110, 24000: 0b0111, 32000: 0b1000, 44100: 0b1001, 48000: 0b1010, 96000: 0b1011 };
const DEPTH_CODES: Record<number, number> = { 8: 0b001, 12: 0b010, 16: 0b100, 20: 0b101, 24: 0b110 };

export const supportedPcm = (rate: number, bits: number, channels: number) =>
  rate in RATE_CODES && bits in DEPTH_CODES && channels >= 1 && channels <= 8;

/** `dfLa` box payload (after version/flags): the STREAMINFO metadata block, marked as the last block. */
export function streamInfo(rate: number, bits: number, channels: number): Uint8Array {
  const b = new Uint8Array(4 + 34);
  b.set([0x80, 0, 0, 34]); // last-metadata-block flag, type 0 (STREAMINFO), length 34
  const v = new DataView(b.buffer, 4);
  v.setUint16(0, 16); // min block size
  v.setUint16(2, 65535); // max block size
  // min/max frame size (24 bits each) left 0 = unknown.
  // 20 bits sample rate, 3 bits channels-1, 5 bits bits-1, 36 bits total samples (0 = unknown), MD5 zeroed.
  v.setUint32(10, ((rate << 12) | ((channels - 1) << 9) | ((bits - 1) << 4)) >>> 0);
  return b;
}

/**
 * One FLAC frame. `channels[c][i]` are signed integer samples at `bits` depth; `firstSample` is the
 * position of the frame's first sample in the stream.
 */
export function flacFrame(channels: Int32Array[], rate: number, bits: number, firstSample: number): Uint8Array {
  const n = channels[0].length;
  const bytesPerSample = bits / 8; // 8/16/24 only reach here (see supportedPcm); 12/20 would need bit packing
  const header: number[] = [0xff, 0xf9, (0b0111 << 4) | RATE_CODES[rate], ((channels.length - 1) << 4) | (DEPTH_CODES[bits] << 1)];
  header.push(...utf8Number(firstSample), (n - 1) >> 8, (n - 1) & 255);
  header.push(crc8(header));
  const out = new Uint8Array(header.length + channels.length * (1 + n * bytesPerSample) + 2);
  out.set(header);
  let p = header.length;
  for (const ch of channels) {
    out[p++] = 0b00000010; // subframe: verbatim, no wasted bits
    for (let i = 0; i < n; i++) {
      const s = ch[i];
      for (let k = bytesPerSample - 1; k >= 0; k--) out[p++] = (s >> (8 * k)) & 255;
    }
  }
  const crc = crc16(out.subarray(0, p));
  out[p] = crc >> 8;
  out[p + 1] = crc & 255;
  return out;
}

/** FLAC's extended UTF-8 coding of a number (up to 36 bits). */
function utf8Number(v: number): number[] {
  if (v < 0x80) return [v];
  let n = 2; // an n-byte sequence holds 5n + 1 bits
  while (v >= 2 ** (5 * n + 1)) n++;
  const bytes: number[] = [];
  for (let i = 1; i < n; i++) {
    bytes.unshift(0x80 | (v % 64));
    v = Math.floor(v / 64);
  }
  bytes.unshift(((0xff << (8 - n)) & 0xff) | v);
  return bytes;
}

function crc8(bytes: number[]) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 255 : (crc << 1) & 255;
  }
  return crc;
}

const CRC16 = new Uint16Array(256).map((_, i) => {
  let c = i << 8;
  for (let k = 0; k < 8; k++) c = c & 0x8000 ? (c << 1) ^ 0x8005 : c << 1;
  return c & 0xffff;
});

function crc16(b: Uint8Array) {
  let crc = 0;
  for (let i = 0; i < b.length; i++) crc = ((crc << 8) ^ CRC16[(crc >> 8) ^ b[i]]) & 0xffff;
  return crc;
}
