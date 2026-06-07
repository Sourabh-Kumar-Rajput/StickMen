// Generic preview harness: software-rasterizes the REAL drawing code plus an
// optional VARIANT file that overrides drawArcher/drawBow/helpers, into a
// supersampled (smooth) PNG montage of idle + drawing poses, on poses both
// facings. Lets a design be eyeballed without a browser.
//
//   node tools/render-variant.js [variant.js] [out.png] [bgHex]
//
// With no variant it renders the shipping code (baseline). The variant file is
// loaded AFTER js/stickman.js in the same sandbox, so any function it defines
// (drawArcher, drawBow, helpers...) replaces the shipping one.
"use strict";
const fs = require("fs"), path = require("path"), zlib = require("zlib"), vm = require("vm");
const ROOT = path.join(__dirname, "..");

const SS = 4; // supersample factor (rendered then box-downsampled => smooth)

function parseColor(c) {
  if (Array.isArray(c)) return c;
  if (typeof c !== "string") return [0, 0, 0, 1];
  if (c[0] === "#") {
    let h = c.slice(1);
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const m = c.match(/rgba?\(([^)]+)\)/);
  if (m) { const p = m[1].split(",").map(s => parseFloat(s.trim())); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
  return [0, 0, 0, 1];
}
function Ctx(W, H) {
  this.W = W; this.H = H; this.buf = new Float64Array(W * H * 3);
  this.m = [1, 0, 0, 1, 0, 0]; this.stack = [];
  this.fillStyle = "#000"; this.strokeStyle = "#000"; this.globalAlpha = 1;
  this.lineWidth = 1; this.lineCap = "round"; this.lineJoin = "round";
  this.sub = []; this.cur = null; this.ux = 0; this.uy = 0;
}
Ctx.prototype.bg = function (c) { const [r, g, b] = parseColor(c); for (let i = 0; i < this.W * this.H; i++) { this.buf[i * 3] = r; this.buf[i * 3 + 1] = g; this.buf[i * 3 + 2] = b; } };
Ctx.prototype.save = function () { this.stack.push(this.m.slice()); };
Ctx.prototype.restore = function () { if (this.stack.length) this.m = this.stack.pop(); };
Ctx.prototype.translate = function (x, y) { const m = this.m; m[4] += m[0] * x + m[2] * y; m[5] += m[1] * x + m[3] * y; };
Ctx.prototype.scale = function (x, y) { const m = this.m; m[0] *= x; m[1] *= x; m[2] *= y; m[3] *= y; };
Ctx.prototype.rotate = function (a) { const m = this.m, c = Math.cos(a), s = Math.sin(a); const a0 = m[0], b0 = m[1], c0 = m[2], d0 = m[3]; m[0] = a0 * c + c0 * s; m[1] = b0 * c + d0 * s; m[2] = a0 * -s + c0 * c; m[3] = b0 * -s + d0 * c; };
Ctx.prototype.setTransform = function (a, b, c, d, e, f) { this.m = [a, b, c, d, e, f]; };
Ctx.prototype._d = function (x, y) { const m = this.m; return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]; };
Ctx.prototype._sf = function () { const m = this.m; return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1; };
Ctx.prototype.beginPath = function () { this.sub = []; this.cur = null; };
Ctx.prototype.moveTo = function (x, y) { this.ux = x; this.uy = y; this.cur = [this._d(x, y)]; this.sub.push(this.cur); };
Ctx.prototype.lineTo = function (x, y) { if (!this.cur) return this.moveTo(x, y); this.ux = x; this.uy = y; this.cur.push(this._d(x, y)); };
Ctx.prototype.quadraticCurveTo = function (cx, cy, x, y) { const x0 = this.ux, y0 = this.uy, N = 24; for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; const px = u * u * x0 + 2 * u * t * cx + t * t * x, py = u * u * y0 + 2 * u * t * cy + t * t * y; this.lineTo(px, py); } };
Ctx.prototype.bezierCurveTo = function (c1x, c1y, c2x, c2y, x, y) { const x0 = this.ux, y0 = this.uy, N = 28; for (let i = 1; i <= N; i++) { const t = i / N, u = 1 - t; const px = u * u * u * x0 + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * x, py = u * u * u * y0 + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * y; this.lineTo(px, py); } };
Ctx.prototype.arc = function (cx, cy, r, a0, a1, ccw) {
  if (a1 === undefined) a1 = Math.PI * 2;
  if (ccw && a1 > a0) a1 -= Math.PI * 2; if (!ccw && a1 < a0) a1 += Math.PI * 2;
  const N = Math.max(10, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 24)));
  for (let i = 0; i <= N; i++) { const a = a0 + (a1 - a0) * i / N; const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r; if (i === 0 && !this.cur) this.moveTo(x, y); else this.lineTo(x, y); }
};
Ctx.prototype.ellipse = function (cx, cy, rx, ry, rot, a0, a1) { const N = 48; for (let i = 0; i <= N; i++) { const a = (a1 - a0) * i / N + a0; const x = cx + Math.cos(a) * rx * Math.cos(rot) - Math.sin(a) * ry * Math.sin(rot); const y = cy + Math.cos(a) * rx * Math.sin(rot) + Math.sin(a) * ry * Math.cos(rot); if (i === 0 && !this.cur) this.moveTo(x, y); else this.lineTo(x, y); } };
Ctx.prototype.closePath = function () { if (this.cur && this.cur.length) this.cur.push(this.cur[0].slice()); };
Ctx.prototype._blend = function (x, y, r, g, b, a) { x |= 0; y |= 0; if (x < 0 || y < 0 || x >= this.W || y >= this.H || a <= 0) return; if (a > 1) a = 1; const i = (y * this.W + x) * 3, na = 1 - a; this.buf[i] = this.buf[i] * na + r * a; this.buf[i + 1] = this.buf[i + 1] * na + g * a; this.buf[i + 2] = this.buf[i + 2] * na + b * a; };
Ctx.prototype.fill = function () {
  const [r, g, b, ca] = parseColor(this.fillStyle); const a = ca * this.globalAlpha; if (a <= 0) return;
  let minY = 1e9, maxY = -1e9; for (const s of this.sub) for (const p of s) { if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1]; }
  minY = Math.max(0, Math.floor(minY)); maxY = Math.min(this.H - 1, Math.ceil(maxY));
  for (let y = minY; y <= maxY; y++) {
    const xs = []; const yc = y + 0.5;
    for (const s of this.sub) { for (let i = 0; i + 1 < s.length; i++) { const A = s[i], B = s[i + 1]; let y0 = A[1], y1 = B[1], x0 = A[0], x1 = B[0]; if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) { const t = (yc - y0) / (y1 - y0); xs.push(x0 + (x1 - x0) * t); } }
      const A = s[s.length - 1], B = s[0]; let y0 = A[1], y1 = B[1]; if ((y0 <= yc && y1 > yc) || (y1 <= yc && y0 > yc)) { const t = (yc - y0) / (y1 - y0); xs.push(A[0] + (B[0] - A[0]) * t); } }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) { const xa = Math.round(xs[i]), xb = Math.round(xs[i + 1]); for (let x = xa; x < xb; x++) this._blend(x, y, r, g, b, a); }
  }
};
Ctx.prototype._disc = function (cx, cy, rad, r, g, b, a) { for (let y = Math.floor(cy - rad); y <= Math.ceil(cy + rad); y++) for (let x = Math.floor(cx - rad); x <= Math.ceil(cx + rad); x++) { if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= rad * rad) this._blend(x, y, r, g, b, a); } };
Ctx.prototype.stroke = function () {
  const [r, g, b, ca] = parseColor(this.strokeStyle); const a = ca * this.globalAlpha; if (a <= 0) return;
  const w = Math.max(0.5, this.lineWidth * this._sf()) / 2;
  for (const s of this.sub) for (let i = 0; i + 1 < s.length; i++) { const A = s[i], B = s[i + 1]; const n = Math.max(1, Math.ceil(Math.hypot(B[0] - A[0], B[1] - A[1]))); for (let k = 0; k <= n; k++) { const t = k / n; this._disc(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, w, r, g, b, a); } }
};
Ctx.prototype.drawImage = function () { };
Ctx.prototype.createLinearGradient = function () { const self = this; return { _stops: [], addColorStop: function (o, c) { this._stops.push([o, c]); } }; };
Ctx.prototype.createRadialGradient = function () { return { _stops: [], addColorStop: function () {} }; };
Object.defineProperty(Ctx.prototype, "shadowBlur", { get() { return 0; }, set() {} });
Object.defineProperty(Ctx.prototype, "shadowColor", { get() { return ""; }, set() {} });

// box-downsample SS->1 then PNG encode
function encodePNG(ctx, ss) {
  const SW = ctx.W, SH = ctx.H, W = SW / ss, H = SH / ss, buf = ctx.buf;
  const out = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) { const i = ((y * ss + dy) * SW + (x * ss + dx)) * 3; r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; }
    const o = (y * W + x) * 3, n = ss * ss; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n;
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; for (let x = 0; x < W; x++) { const i = (y * W + x) * 3, oo = y * (W * 3 + 1) + 1 + x * 3; raw[oo] = Math.max(0, Math.min(255, out[i] | 0)); raw[oo + 1] = Math.max(0, Math.min(255, out[i + 1] | 0)); raw[oo + 2] = Math.max(0, Math.min(255, out[i + 2] | 0)); } }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; }
  const crc = d => { let c = 0xffffffff; for (let i = 0; i < d.length; i++) c = (T[(c ^ d[i]) & 255] ^ (c >>> 8)) >>> 0; return (c ^ 0xffffffff) >>> 0; };
  const chunk = (ty, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length, 0); const t = Buffer.from(ty); const cc = Buffer.alloc(4); cc.writeUInt32BE(crc(Buffer.concat([t, d])), 0); return Buffer.concat([l, t, d, cc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

module.exports = { Ctx, encodePNG, parseColor, SS };
if (require.main !== module) return;

// ---- load shipping code + optional variant ---------------------------------
const variant = process.argv[2] && process.argv[2] !== "-" ? process.argv[2] : null;
const outPath = process.argv[3] || path.join(__dirname, "_variant.png");
const bg = process.argv[4] || "#3fa172";

const sandbox = { Math: Math, Image: undefined, console: console };
sandbox.window = sandbox; sandbox.TAU = Math.PI * 2;
vm.createContext(sandbox);
const files = ["js/utils.js", "js/weapons.js", "js/stickman.js"];
for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
if (variant) vm.runInContext(fs.readFileSync(path.resolve(variant), "utf8"), sandbox, { filename: variant });

// ---- montage of poses ------------------------------------------------------
// Each cell shows one pose; the player color/bow tier matches the in-game look.
const CELL_W = 210, CELL_H = 270, COLS = 3;
const W = CELL_W * COLS, H = CELL_H;
const ctx = new Ctx(W * SS, H * SS);
ctx.bg(bg);
ctx.setTransform(SS, 0, 0, SS, 0, 0);

// faint ground line per cell
const groundY = CELL_H - 46;
ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 2;
ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();

function cell(i) { return { ox: i * CELL_W + CELL_W / 2 }; }

function pose(i, opt) {
  const c = cell(i);
  ctx.save();
  ctx.translate(c.ox - opt.x, 0); // center the figure in its cell
  const s = sandbox.computeSkeleton(opt.x, groundY, opt.facing, opt.aim, {
    draw: opt.draw, lean: opt.draw ? 0.8 : 0, walk: opt.walk || 0, run: false
  });
  sandbox.drawArcher(ctx, s, Object.assign({
    color: "#1c1c22", weapon: "bow", draw: opt.draw, charge: opt.charge || 0,
    bowColor: "#6e4d2b", bowTip: "#caa15a", bowArt: "training"
  }, opt.drawOpt || {}));
  ctx.restore();
}

// 1) idle, bow lowered/held, facing right
pose(0, { x: 0, facing: 1, aim: 0.12, draw: false });
// 2) drawing a charged shot, facing right
pose(1, { x: 0, facing: 1, aim: -0.32, draw: true, charge: 0.6 });
// 3) drawing, facing left (check mirror)
pose(2, { x: 0, facing: -1, aim: Math.PI + 0.32, draw: true, charge: 0.6 });

fs.writeFileSync(path.resolve(outPath), encodePNG(ctx, SS));
console.log("wrote " + outPath + (variant ? "  (variant: " + variant + ")" : "  (baseline)"));
