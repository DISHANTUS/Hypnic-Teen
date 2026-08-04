// Generates the PWA icons with zero dependencies (raw RGBA -> PNG via zlib).
// Run: npm run icons

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.join(import.meta.dirname, '..', 'public', 'icons');

function crc32(buf) {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Purple->pink diagonal gradient tile with a white "H". */
function drawIcon(size, { maskable = false } = {}) {
  const px = Buffer.alloc(size * size * 4);
  const pad = maskable ? size * 0.18 : 0; // maskable icons need a safe zone
  const radius = maskable ? 0 : size * 0.22;
  const inner = size - pad * 2;

  // H glyph geometry, relative to the inner square
  const barW = inner * 0.13;
  const gap = inner * 0.2;
  const top = pad + inner * 0.26;
  const bottom = pad + inner * 0.74;
  const leftX = pad + inner / 2 - gap - barW / 2;
  const rightX = pad + inner / 2 + gap - barW / 2;
  const crossTop = pad + inner * 0.44;
  const crossBottom = pad + inner * 0.56;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const insideBox = x >= pad && x < size - pad && y >= pad && y < size - pad;

      // rounded-corner test for the non-maskable tile
      let visible = insideBox;
      if (visible && radius > 0) {
        const cx = Math.min(Math.max(x, radius), size - radius);
        const cy = Math.min(Math.max(y, radius), size - radius);
        if (Math.hypot(x - cx, y - cy) > radius) visible = false;
      }

      if (!visible) {
        px[i + 3] = 0;
        continue;
      }

      const t = (x / size + y / size) / 2; // diagonal gradient
      px[i] = Math.round(124 + (255 - 124) * t);
      px[i + 1] = Math.round(92 + (92 - 92) * t);
      px[i + 2] = Math.round(255 + (138 - 255) * t);
      px[i + 3] = 255;

      const inLeft = x >= leftX && x < leftX + barW && y >= top && y < bottom;
      const inRight = x >= rightX && x < rightX + barW && y >= top && y < bottom;
      const inCross = x >= leftX && x < rightX + barW && y >= crossTop && y < crossBottom;
      if (inLeft || inRight || inCross) {
        px[i] = px[i + 1] = px[i + 2] = 255;
      }
    }
  }
  return encodePng(size, size, px);
}

/**
 * The share card. When someone pastes the link into WhatsApp or Discord, this
 * is the picture that appears next to the title — so it uses the studio's peach
 * and ink rather than the app icon's gradient.
 */
function drawOgCard(width = 1200, height = 630) {
  const px = Buffer.alloc(width * height * 4);
  const PEACH = [255, 238, 226];
  const CORAL = [249, 122, 90];
  const INK = [46, 33, 24];

  const put = (x, y, [r, g, b]) => {
    const i = (y * width + x) * 4;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
    px[i + 3] = 255;
  };

  // One big centred mark. A card with the logo off to one side and empty space
  // beside it reads as unfinished in a chat preview.
  const tile = 300;
  const tx = (width - tile) / 2;
  const ty = (height - 90 - tile) / 2;
  const radius = 54;
  const border = 9;

  const barW = tile * 0.13;
  const gap = tile * 0.2;
  const gTop = ty + tile * 0.26;
  const gBottom = ty + tile * 0.74;
  const leftX = tx + tile / 2 - gap - barW / 2;
  const rightX = tx + tile / 2 + gap - barW / 2;
  const crossTop = ty + tile * 0.44;
  const crossBottom = ty + tile * 0.56;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // Background: peach, with a coral band across the bottom.
      let colour = y > height - 90 ? CORAL : PEACH;

      // Faint ink dot grid, same texture as the site.
      if (y <= height - 90 && x % 26 === 0 && y % 26 === 0) colour = [242, 224, 210];

      const inTile = x >= tx && x < tx + tile && y >= ty && y < ty + tile;
      if (inTile) {
        const cx = Math.min(Math.max(x, tx + radius), tx + tile - radius);
        const cy = Math.min(Math.max(y, ty + radius), ty + tile - radius);
        const dist = Math.hypot(x - cx, y - cy);
        if (dist <= radius) {
          colour = dist > radius - border ? INK : CORAL;
          const inLeft = x >= leftX && x < leftX + barW && y >= gTop && y < gBottom;
          const inRight = x >= rightX && x < rightX + barW && y >= gTop && y < gBottom;
          const inCross = x >= leftX && x < rightX + barW && y >= crossTop && y < crossBottom;
          if (inLeft || inRight || inCross) colour = [255, 255, 255];
        }
      }

      put(x, y, colour);
    }
  }
  return encodePng(width, height, px);
}

mkdirSync(OUT_DIR, { recursive: true });
const files = [
  ['icon-192.png', drawIcon(192)],
  ['icon-512.png', drawIcon(512)],
  ['maskable-512.png', drawIcon(512, { maskable: true })],
  ['share-card.png', drawOgCard()],
];
for (const [name, buf] of files) {
  writeFileSync(path.join(OUT_DIR, name), buf);
  console.log(`  wrote public/icons/${name} (${buf.length} bytes)`);
}
