// gen-icons.js — produce icons/icon-192.png and icons/icon-512.png with no
// external dependencies (pure Node + zlib). Draws a bow-and-arrow emblem on the
// theme background, glyph kept inside the central ~80% for maskable safety.
// Run: node tools/gen-icons.js
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- tiny RGBA raster ----
function Canvas(size) {
  const buf = Buffer.alloc(size * size * 4);
  return { size, buf };
}
function px(c, x, y, r, g, b, a) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= c.size || y >= c.size) return;
  const i = (y * c.size + x) * 4;
  const ia = a / 255, na = 1 - ia;
  c.buf[i] = Math.round(c.buf[i] * na + r * ia);
  c.buf[i + 1] = Math.round(c.buf[i + 1] * na + g * ia);
  c.buf[i + 2] = Math.round(c.buf[i + 2] * na + b * ia);
  c.buf[i + 3] = 255;
}
function fill(c, r, g, b) { for (let i = 0; i < c.buf.length; i += 4) { c.buf[i] = r; c.buf[i + 1] = g; c.buf[i + 2] = b; c.buf[i + 3] = 255; } }
function disc(c, cx, cy, rad, r, g, b, a) {
  for (let y = cy - rad; y <= cy + rad; y++)
    for (let x = cx - rad; x <= cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d <= rad) px(c, x, y, r, g, b, a == null ? 255 : a);
    }
}
function thickLine(c, x0, y0, x1, y1, w, r, g, b) {
  const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    disc(c, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, r, g, b, 255);
  }
}
// arc of a circle (a0..a1 radians), thick
function arc(c, cx, cy, rad, a0, a1, w, r, g, b) {
  const steps = Math.ceil((a1 - a0) * rad);
  let px0 = cx + Math.cos(a0) * rad, py0 = cy + Math.sin(a0) * rad;
  for (let s = 1; s <= steps; s++) {
    const a = a0 + (a1 - a0) * (s / steps);
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    thickLine(c, px0, py0, x, y, w, r, g, b);
    px0 = x; py0 = y;
  }
}

function drawEmblem(c) {
  const S = c.size, k = S / 512;
  fill(c, 0xcf, 0xe8, 0xf5);                 // theme background
  const cx = S * 0.5, cy = S * 0.5;
  const R = S * 0.30;
  // bow limb (C opening to the right), dark wood
  arc(c, cx + S * 0.05, cy, R, Math.PI * 0.62, Math.PI * 1.38, 9 * k, 0x6b, 0x4f, 0x2a);
  // bowstring
  const tx = cx + S * 0.05 + Math.cos(Math.PI * 0.62) * R, ty = cy + Math.sin(Math.PI * 0.62) * R;
  const bx = cx + S * 0.05 + Math.cos(Math.PI * 1.38) * R, by = cy + Math.sin(Math.PI * 1.38) * R;
  thickLine(c, tx, ty, bx, by, 2.5 * k, 0x2b, 0x2b, 0x30);
  // arrow shaft (red accent) pointing right
  const ax0 = cx - R * 0.55, ax1 = cx + R * 1.05;
  thickLine(c, ax0, cy, ax1, cy, 5 * k, 0xc2, 0x43, 0x3f);
  // arrowhead
  thickLine(c, ax1, cy, ax1 - 22 * k, cy - 16 * k, 4 * k, 0x1c, 0x1c, 0x22);
  thickLine(c, ax1, cy, ax1 - 22 * k, cy + 16 * k, 4 * k, 0x1c, 0x1c, 0x22);
  // fletching
  thickLine(c, ax0, cy, ax0 + 16 * k, cy - 12 * k, 3 * k, 0x2f, 0x6f, 0xd0);
  thickLine(c, ax0, cy, ax0 + 16 * k, cy + 12 * k, 3 * k, 0x2f, 0x6f, 0xd0);
}

// ---- PNG encode ----
const CRC_TABLE = (function () {
  const t = [];
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function encodePNG(c) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(c.size, 0); ihdr.writeUInt32BE(c.size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // raw scanlines with filter byte 0
  const raw = Buffer.alloc((c.size * 4 + 1) * c.size);
  for (let y = 0; y < c.size; y++) {
    raw[y * (c.size * 4 + 1)] = 0;
    c.buf.copy(raw, y * (c.size * 4 + 1) + 1, y * c.size * 4, (y + 1) * c.size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const outDir = path.join(__dirname, "..", "icons");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
[192, 512].forEach(function (size) {
  const c = Canvas(size);
  drawEmblem(c);
  fs.writeFileSync(path.join(outDir, "icon-" + size + ".png"), encodePNG(c));
  console.log("wrote icons/icon-" + size + ".png");
});
