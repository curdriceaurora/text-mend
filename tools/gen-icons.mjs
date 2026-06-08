// Generate the extension's toolbar icons as PNGs with zero dependencies.
// Motif: blue rounded square with two white "text" bars, the lower one mirrored to
// the right edge — a nod to reversed text. Run: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BG = [26, 115, 232, 255]; // #1a73e8
const FG = [255, 255, 255, 255];
const TRANSPARENT = [0, 0, 0, 0];

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (~c) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, pixelAt) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixelAt(x, y, size);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = a;
    }
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function pixel(x, y, size) {
  const r = size * 0.18; // corner radius
  // rounded-rect mask
  const inX = Math.min(x, size - 1 - x);
  const inY = Math.min(y, size - 1 - y);
  if (inX < r && inY < r) {
    const dx = r - inX;
    const dy = r - inY;
    if (dx * dx + dy * dy > r * r) return TRANSPARENT;
  }
  // two horizontal "text" bars
  const barH = Math.max(1, Math.round(size * 0.11));
  const topY = Math.round(size * 0.34);
  const botY = Math.round(size * 0.55);
  const m = Math.round(size * 0.26); // margin
  const onTop = y >= topY && y < topY + barH && x >= m && x <= size - m;
  // lower bar is shifted/mirrored toward the right edge to suggest reversal
  const onBot = y >= botY && y < botY + barH && x >= size - m - Math.round(size * 0.34) && x <= size - m;
  if (onTop || onBot) return FG;
  return BG;
}

const dir = fileURLToPath(new URL('../icons/', import.meta.url));
mkdirSync(dir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(new URL(`../icons/icon${size}.png`, import.meta.url), encodePng(size, pixel));
}
console.log('wrote icons/icon{16,32,48,128}.png');
