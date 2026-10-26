/**
 * Cover art generator for the development seed.
 *
 * Fixture artwork has to be real raster images: the upload pipeline identifies
 * images by their magic bytes and only accepts PNG/JPEG/WebP/GIF/AVIF. This
 * draws dark-neon covers in the site's own palette and encodes them as PNG, with
 * no image library involved.
 */

import { deflateSync } from 'node:zlib';

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

export function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ----------------------------------------------------------------- palette */

const PALETTES = {
  cyan: { primary: [53, 230, 255], secondary: [160, 132, 255] },
  violet: { primary: [160, 132, 255], secondary: [255, 77, 151] },
  pink: { primary: [255, 77, 151], secondary: [255, 152, 64] },
  lime: { primary: [178, 255, 89], secondary: [53, 230, 255] },
  orange: { primary: [255, 152, 64], secondary: [255, 77, 151] },
  blue: { primary: [88, 166, 255], secondary: [178, 255, 89] },
};

const DEEP = [7, 10, 22];
const RAISED = [19, 26, 53];

function hash(value) {
  let h = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const mix = (a, b, t) => a.map((channel, index) => channel + (b[index] - channel) * clamp01(t));

function roundedRect(x, y, cx, cy, halfW, halfH, radius) {
  const dx = Math.abs(x - cx) - (halfW - radius);
  const dy = Math.abs(y - cy) - (halfH - radius);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * Draws one cover. The composition follows the seed, so every game gets a
 * consistent but distinct image, and re-running the seed reproduces them.
 */
export function coverArt(seed, { width = 960, height = 540, accent = 'cyan' } = {}) {
  const palette = PALETTES[accent] ?? PALETTES.cyan;
  const wobble = hash(seed);
  const wobble2 = hash(`${seed}:2`);
  const vertical = height > width;
  const aspect = width / height;

  const cx = 0.42 + wobble * 0.16;
  const cy = 0.5 + (wobble2 - 0.5) * 0.12;
  const frameHalfW = 0.3;
  const frameHalfH = 0.3;
  const radius = 0.055 + wobble2 * 0.04;
  const ringRadius = 0.115 + wobble * 0.03;
  const ringCx = cx + 0.16 - wobble * 0.1;

  const rgba = Buffer.alloc(width * height * 4);
  const samples = 2;

  for (let py = 0; py < height; py += 1) {
    for (let px = 0; px < width; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          // Sample in normalised space with x scaled by the aspect ratio so
          // shapes keep their proportions at any size.
          const x = ((px + (sx + 0.5) / samples) / width) * aspect;
          const y = (py + (sy + 0.5) / samples) / height;

          const base = mix(DEEP, RAISED, clamp01((x / aspect) * 0.7 + y * 0.9));
          const primaryGlow = clamp01(1 - Math.hypot(x - cx * aspect, y - cy) / 0.78) ** 2;
          const secondaryGlow = clamp01(1 - Math.hypot(x - 0.82 * aspect, y - 0.86) / 0.72) ** 2;
          let colour = mix(base, palette.primary, primaryGlow * 0.34);
          colour = mix(colour, palette.secondary, secondaryGlow * 0.28);

          // Diagonal stripe band.
          const stripe = Math.sin((x * 6 + y * 9) * Math.PI + wobble * 4);
          if (stripe > 0.86 && roundedRect(x, y, cx * aspect, cy, frameHalfW * aspect * 1.35, frameHalfH * 1.5, 0.04) > 0.02) {
            colour = mix(colour, palette.primary, 0.09);
          }

          // Chunky outlined frame.
          const outer = roundedRect(x, y, cx * aspect, cy, frameHalfW * aspect, frameHalfH, radius);
          const inner = roundedRect(x, y, cx * aspect, cy, frameHalfW * aspect - 0.008, frameHalfH - 0.008, radius - 0.006);
          if (outer <= 0 && inner > 0) {
            colour = mix(colour, palette.primary, 0.92);
          } else if (outer <= 0) {
            colour = mix(colour, DEEP, 0.55);
          }

          // Filled disc and a small satellite square.
          const disc = Math.hypot(x - ringCx * aspect, y - cy) - ringRadius;
          if (disc <= 0) colour = mix(colour, palette.secondary, 0.85);
          const square = roundedRect(x, y, (cx + 0.2 + wobble * 0.05) * aspect, cy - 0.16, 0.032, 0.032, 0.012);
          if (square <= 0) colour = mix(colour, palette.primary, 0.9);

          // Dot grid in one corner.
          const gx = (x / aspect) * 26;
          const gy = y * 26;
          const dot = Math.hypot(gx - Math.floor(gx) - 0.5, gy - Math.floor(gy) - 0.5);
          if ((x / aspect) < 0.24 && y < 0.22 && dot < 0.16) colour = mix(colour, palette.primary, 0.5);

          r += colour[0];
          g += colour[1];
          b += colour[2];
        }
      }

      const total = samples * samples;
      const offset = (py * width + px) * 4;
      rgba[offset] = Math.round(r / total);
      rgba[offset + 1] = Math.round(g / total);
      rgba[offset + 2] = Math.round(b / total);
      rgba[offset + 3] = 255;
    }
  }

  if (vertical) {
    // Portrait variants just reuse the square composition.
    return encodePng(width, height, rgba);
  }
  return encodePng(width, height, rgba);
}
