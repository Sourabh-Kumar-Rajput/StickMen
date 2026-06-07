// Renders the shop bow preview to a PNG (self-check that it reads as a recurve bow).
// Mirrors shop.js drawBowPreview using a tiny raster. node tools/preview-bow.js
const fs = require("fs"), path = require("path"), zlib = require("zlib");
const S = 3; // supersample for clarity
const W = 168 * S, H = 66 * S;
const buf = Buffer.alloc(W * H * 4);
function px(x, y, r, g, b, a) { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 4; const ia = a, na = 1 - ia; buf[i] = buf[i] * na + r * ia; buf[i + 1] = buf[i + 1] * na + g * ia; buf[i + 2] = buf[i + 2] * na + b * ia; buf[i + 3] = 255; }
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function disc(cx, cy, rad, col, a) { const [r, g, b] = hex(col); for (let y = cy - rad; y <= cy + rad; y++) for (let x = cx - rad; x <= cx + rad; x++) { if (Math.hypot(x - cx, y - cy) <= rad) px(x, y, r, g, b, a == null ? 1 : a); } }
function line(x0, y0, x1, y1, w, col, a) { const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0)); for (let i = 0; i <= n; i++) { const t = i / n; disc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, w, col, a); } }
function fillBg(col) { const [r, g, b] = hex(col); for (let i = 0; i < buf.length; i += 4) { buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = 255; } }

function staveCurve(x0, x1, cy, amp) { const pts = [], N = 36; for (let i = 0; i <= N; i++) { const t = i / N, x = x0 + (x1 - x0) * t; let y = cy - Math.sin(Math.PI * t) * amp; if (t < 0.12) y += (0.12 - t) / 0.12 * amp * 0.55; if (t > 0.88) y += (t - 0.88) / 0.12 * amp * 0.55; pts.push({ x: x, y: y }); } return pts; }
function widthAt(t) { return 1.3 + (1 - Math.abs(t - 0.5) * 2) * 3.0; }
function brush(pts, wfn, color, alpha, dy) { for (let i = 0; i < pts.length; i++) disc(pts[i].x, pts[i].y + (dy || 0), wfn(i / (pts.length - 1)) * S, color, alpha == null ? 1 : alpha); }
function shade(c, amt) { let [r, g, b] = hex(c); const f = amt < 0 ? 1 + amt : 1, add = amt > 0 ? amt * 255 : 0; r = Math.min(255, r * f + add); g = Math.min(255, g * f + add); b = Math.min(255, b * f + add); return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1); }

function drawBow(b) {
  fillBg("#0b0712");
  const cy = H * 0.55, x0 = 18 * S, x1 = W - 14 * S, midx = (x0 + x1) / 2, amp = H * 0.36;
  const pts = staveCurve(x0, x1, cy, amp);
  const apex = pts[Math.round(pts.length / 2)];
  if (b.glow) brush(pts, function (t) { return widthAt(t) * 2.0; }, b.glow, 0.45);
  brush(pts, function (t) { return widthAt(t) + 1.3; }, "#120d08", 1);
  brush(pts, function (t) { return widthAt(t); }, b.color, 1);
  brush(pts, function (t) { return Math.max(0.6, widthAt(t) * 0.4); }, shade(b.color, 0.32), 0.85, -1.2 * S);
  if (b.tip) { disc(pts[0].x, pts[0].y, 2.6 * S, b.tip); disc(pts[pts.length - 1].x, pts[pts.length - 1].y, 2.6 * S, b.tip); }
  line(pts[0].x, pts[0].y, pts[pts.length - 1].x, pts[pts.length - 1].y, S, "#ebebf0", 0.8); // string
  line(apex.x, apex.y - 5 * S, apex.x, apex.y + 6 * S, 3.2 * S, "#19110a", 1);
  line(apex.x, apex.y - 4 * S, apex.x, apex.y + 5 * S, 1.7 * S, shade(b.color, 0.1), 1);
  if (b.gem) { disc(apex.x, apex.y, 4.2 * S, "#0e0a06"); disc(apex.x, apex.y, 2.7 * S, b.gem); disc(apex.x - S, apex.y - S, 0.9 * S, "#ffffff"); }
  // arrow
  line(midx - 8 * S, cy, x1 - 9 * S, cy, S, "#7a5a33", 1);
  disc(x1 - 2 * S, cy, 0, b.tip || "#c9cdd4"); // head approx
  for (let i = 0; i < 9; i++) line(x1 - 2 * S, cy, x1 - 9 * S, cy - (i - 4) * S * 0.6, 0.6 * S, b.tip || "#c9cdd4", 1);
}

function encode() {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((W * 4 + 1) * H); for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; buf.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4); }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const T = [], crc = (d) => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = (T[(c ^ d[i]) & 255] ^ (c >>> 8)) >>> 0; return (c ^ 0xffffffff) >>> 0; };
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const t = Buffer.from(ty); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, d])), 0); return Buffer.concat([l, t, d, cc]); };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const BOWS = {
  recurve: { color: "#2b3340", glow: "#3aa0ff", tip: "#bcd8ff", gem: "#3aa0ff" },
  dragon: { color: "#241a14", glow: "#ff5a2a", tip: "#ffae3b", gem: "#ff3a1a" }
};
drawBow(BOWS[process.argv[2] || "recurve"]);
fs.writeFileSync(path.join(__dirname, "_bow_preview.png"), encode());
console.log("wrote tools/_bow_preview.png");
