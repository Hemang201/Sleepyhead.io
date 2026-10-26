/**
 * Generates the PWA / apple-touch app icons as real PNG files.
 *
 * Deliberately dependency-free (only node:zlib): the icons are drawn from signed
 * distance functions, supersampled for smooth edges, and encoded as PNG by hand.
 * Run it with `npm run icons` after changing the design or brand colours.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/icons');

/* ------------------------------------------------------------ PNG encoding */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- drawing */

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a.map((channel, index) => channel + (b[index] - channel) * clamp01(t));

const BG_DEEP = [7, 10, 22];
const BG_RAISE = [19, 26, 53];
const CYAN = [53, 230, 255];
const VIOLET = [160, 132, 255];
const PINK = [255, 77, 151];

/** Signed distance for a rounded rectangle; negative is inside. */
function roundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

const circle = (x, y, cx, cy, r) => Math.hypot(x - cx, y - cy) - r;

/** Colour of the background at a point: deep navy with two soft neon glows. */
function backgroundColor(x, y) {
  const base = mix(BG_DEEP, BG_RAISE, clamp01((x * 0.6 + y * 0.8) * 0.9));
  const cyanGlow = clamp01(1 - Math.hypot(x - 0.28, y - 0.22) / 0.72) ** 2;
  const pinkGlow = clamp01(1 - Math.hypot(x - 0.78, y - 0.82) / 0.7) ** 2;
  const withCyan = mix(base, CYAN, cyanGlow * 0.32);
  return mix(withCyan, PINK, pinkGlow * 0.26);
}

/** A gamepad glyph in a cyan → violet → pink gradient. */
function glyphColor(x) {
  const t = clamp01((x - 0.2) / 0.6);
  return t < 0.5 ? mix(CYAN, VIOLET, t * 2) : mix(VIOLET, PINK, (t - 0.5) * 2);
}

function sample(x, y) {
  const bodyOutline =
    roundedRect(x, y, 0.5, 0.5, 0.3, 0.155, 0.075) <= 0 &&
    roundedRect(x, y, 0.5, 0.5, 0.3 - 0.026, 0.155 - 0.026, 0.055) > 0;
  const dpad =
    roundedRect(x, y, 0.335, 0.5, 0.046, 0.014, 0.012) <= 0 ||
    roundedRect(x, y, 0.335, 0.5, 0.014, 0.046, 0.012) <= 0;
  const buttons =
    circle(x, y, 0.655, 0.468, 0.022) <= 0 || circle(x, y, 0.7, 0.532, 0.022) <= 0;

  if (bodyOutline || dpad || buttons) return glyphColor(x);
  return backgroundColor(x, y);
}

function renderPng(size, samples = 3) {
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * samples);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = (px * samples + sx + 0.5) * step;
          const y = (py * samples + sy + 0.5) * step;
          const [cr, cg, cb] = sample(x, y);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const total = samples * samples;
      const offset = (py * size + px) * 4;
      rgba[offset] = Math.round(r / total);
      rgba[offset + 1] = Math.round(g / total);
      rgba[offset + 2] = Math.round(b / total);
      rgba[offset + 3] = 255;
    }
  }

  return encodePng(size, size, rgba);
}

mkdirSync(outDir, { recursive: true });
const targets = [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
];

for (const [name, size] of targets) {
  const file = resolve(outDir, name);
  writeFileSync(file, renderPng(size));
  console.log(`wrote ${name} (${size}×${size})`);
}
