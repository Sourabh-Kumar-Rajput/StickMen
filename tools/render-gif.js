// Renders an animated gameplay GIF (draw -> loose -> arrow -> ragdoll hit) using
// the REAL drawing code, for the README. Hand-rolled GIF89a encoder (median-cut
// palette + LZW) — no dependencies, matching this project's style.
//   node tools/render-gif.js   ->   media/gameplay.gif
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { Ctx, SS } = require("./render-variant");
const ROOT = path.join(__dirname, "..");

const W = 520, H = 230, SCALE = 3;          // output px; render supersampled then box-down
const groundY = 188;

// ---- load the real drawing code + ragdoll into one sandbox ----
const sb = { Math: Math, Image: undefined, console: console };
sb.window = sb; sb.TAU = Math.PI * 2;
vm.createContext(sb);
for (const f of ["js/utils.js", "js/weapons.js", "js/stickman.js", "js/ragdoll.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
}
vm.runInContext("window.Ragdoll = Ragdoll;", sb);   // expose the class to Node side

// ---- per-frame scene ----
function rect(ctx, x, y, w, h) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); }
function drawBg(ctx) {
  ctx.fillStyle = "#cfe8f5"; rect(ctx, 0, 0, W, H);
  ctx.fillStyle = "#e6eff5"; rect(ctx, 0, groundY - 90, W, 90);
  ctx.globalAlpha = 0.7; ctx.fillStyle = "#ffffff";
  [[120, 44, 42, 13], [300, 34, 52, 15], [430, 56, 40, 12]].forEach(function (c) {
    ctx.beginPath(); ctx.ellipse(c[0], c[1], c[2], c[3], 0, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  function hill(cy, amp, tone, n) { ctx.fillStyle = tone; ctx.beginPath(); ctx.moveTo(0, groundY); for (let i = 0; i <= n; i++) { ctx.lineTo((i / n) * W, cy - Math.abs(Math.sin(i * 1.7 + 0.6)) * amp); } ctx.lineTo(W, groundY); ctx.closePath(); ctx.fill(); }
  hill(groundY - 28, 46, "#bcd0e8", 6); hill(groundY - 10, 30, "#bcd9ad", 7);
  ctx.fillStyle = "#caa46a"; rect(ctx, 0, groundY, W, H - groundY);
  ctx.fillStyle = "#7d9a55"; rect(ctx, 0, groundY - 4, W, 7);
}
function archer(ctx, x, facing, aim, draw, charge, col, bow) {
  const s = sb.computeSkeleton(x, groundY, facing, aim, { draw: draw, lean: draw ? 0.85 : 0 });
  sb.drawArcher(ctx, s, Object.assign({ color: col, weapon: "bow", draw: draw, charge: charge, bowArt: "training" }, bow));
}
function flyArrow(ctx, x, y, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), px = -s, py = c, len = 12;
  const tx = x + c * len, ty = y + s * len, bx = x - c * len, by = y - s * len;
  ctx.strokeStyle = "#7a5a30"; ctx.lineWidth = 2.2; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.fillStyle = "#cfd3da"; ctx.beginPath(); ctx.moveTo(tx + c * 6, ty + s * 6); ctx.lineTo(tx + px * 3.5, ty + py * 3.5); ctx.lineTo(tx - px * 3.5, ty - py * 3.5); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e9e4d4"; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - c * 6 + px * 4, by - s * 6 + py * 4); ctx.lineTo(bx - c * 6, by - s * 6); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx - c * 6 - px * 4, by - s * 6 - py * 4); ctx.lineTo(bx - c * 6, by - s * 6); ctx.closePath(); ctx.fill();
}

const PX = 120, TX = 405;                    // player / target x
const NF = 18, HIT = 11;                      // frames; arrow lands at HIT
const env = { g: 0.6, groundY: groundY, W: W };
let rag = null;
const frames = [], delays = [];

// arrow path: player bow hand -> target chest
const pAim = -0.30, tAim = Math.PI + 0.30;
const pSkel = sb.computeSkeleton(PX, groundY, 1, pAim, { draw: true, lean: 0.85 });
const aStart = { x: pSkel.bowHand.x + Math.cos(pAim) * 16, y: pSkel.bowHand.y + Math.sin(pAim) * 16 };
const tSkel0 = sb.computeSkeleton(TX, groundY, -1, tAim, { draw: false });
const aEnd = { x: tSkel0.chest.x, y: tSkel0.chest.y };

function downsample(ctx, ss) {
  const SW = ctx.W, b = ctx.buf, out = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let r = 0, g = 0, bl = 0; for (let dy = 0; dy < ss; dy++) for (let dx = 0; dx < ss; dx++) { const i = ((y * ss + dy) * SW + (x * ss + dx)) * 3; r += b[i]; g += b[i + 1]; bl += b[i + 2]; }
    const o = (y * W + x) * 3, n = ss * ss; out[o] = r / n; out[o + 1] = g / n; out[o + 2] = bl / n;
  }
  return out;
}

for (let f = 0; f < NF; f++) {
  const ctx = new Ctx(W * SCALE, H * SCALE);
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  drawBg(ctx);

  // player: charge ramp (f0..6), then released
  const drawing = f <= 6;
  const charge = drawing ? 0.15 + (f / 6) * 0.85 : 0;
  archer(ctx, PX, 1, pAim, drawing, charge, "#1c1c22", { bowColor: "#6e4d2b", bowTip: "#caa15a" });

  // target: standing until hit, then ragdoll flop
  if (f < HIT + 1) {
    archer(ctx, TX, -1, tAim, false, 0, "#181820", { bowColor: "#2b3340", bowTip: "#bcd8ff" });
  } else {
    if (!rag) {
      const ts = sb.computeSkeleton(TX, groundY, -1, tAim, { draw: false });
      rag = new sb.Ragdoll(ts, "#181820");
      rag.impulseAll(3.0, -1.5); rag.impulse("chest", 5.5, -5.5); rag.impulse("head", 4.0, -4.0);
    }
    for (let k = 0; k < 3; k++) rag.update(env);   // a few sub-steps for a lively flop
    rag.draw(ctx);
  }

  // arrow in flight (f7..HIT), arcing
  if (f >= 7 && f <= HIT) {
    const t = (f - 7) / (HIT - 7);
    const x = aStart.x + (aEnd.x - aStart.x) * t;
    const y = aStart.y + (aEnd.y - aStart.y) * t - Math.sin(Math.PI * t) * 26;
    const tn = Math.max(0.001, t), prevx = aStart.x + (aEnd.x - aStart.x) * (t - 0.05), prevy = aStart.y + (aEnd.y - aStart.y) * (t - 0.05) - Math.sin(Math.PI * (t - 0.05)) * 26;
    flyArrow(ctx, x, y, Math.atan2(y - prevy, x - prevx));
  }

  frames.push(downsample(ctx, SCALE));
  delays.push(f === NF - 1 ? 90 : (f <= 6 ? 9 : 7));   // hold the final hit frame
}

// ============================ GIF89a encoder =============================
// median-cut quantize to <=256 colors (5-bit/channel histogram)
function quantize(frames, maxColors) {
  const hist = new Map();
  for (const fr of frames) for (let i = 0; i < W * H; i++) {
    const r = fr[i * 3], g = fr[i * 3 + 1], b = fr[i * 3 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    let e = hist.get(key); if (!e) { e = [0, 0, 0, 0]; hist.set(key, e); }
    e[0]++; e[1] += r; e[2] += g; e[3] += b;
  }
  const entries = [];
  for (const [key, e] of hist) entries.push({ key: key, count: e[0], r: e[1] / e[0], g: e[2] / e[0], b: e[3] / e[0] });
  function box(list) { let r0 = 255, r1 = 0, g0 = 255, g1 = 0, b0 = 255, b1 = 0, c = 0; for (const e of list) { if (e.r < r0) r0 = e.r; if (e.r > r1) r1 = e.r; if (e.g < g0) g0 = e.g; if (e.g > g1) g1 = e.g; if (e.b < b0) b0 = e.b; if (e.b > b1) b1 = e.b; c += e.count; } return { list: list, r0, r1, g0, g1, b0, b1, count: c }; }
  let boxes = [box(entries)];
  while (boxes.length < maxColors) {
    let bi = -1, best = -1;
    for (let i = 0; i < boxes.length; i++) { const bx = boxes[i]; if (bx.list.length < 2) continue; const rng = Math.max(bx.r1 - bx.r0, bx.g1 - bx.g0, bx.b1 - bx.b0); if (rng > best) { best = rng; bi = i; } }
    if (bi < 0) break;
    const bx = boxes[bi], rr = bx.r1 - bx.r0, gr = bx.g1 - bx.g0, br = bx.b1 - bx.b0;
    const ax = rr >= gr && rr >= br ? "r" : (gr >= br ? "g" : "b");
    bx.list.sort((a, b) => a[ax] - b[ax]);
    let half = bx.count / 2, acc = 0, si = 0;
    for (; si < bx.list.length - 1; si++) { acc += bx.list[si].count; if (acc >= half) break; }
    boxes.splice(bi, 1, box(bx.list.slice(0, si + 1)), box(bx.list.slice(si + 1)));
  }
  const palette = [], lookup = new Map();
  boxes.forEach(function (bx, idx) {
    let rs = 0, gs = 0, bs = 0, cs = 0;
    for (const e of bx.list) { rs += e.r * e.count; gs += e.g * e.count; bs += e.b * e.count; cs += e.count; lookup.set(e.key, idx); }
    palette.push([Math.round(rs / cs), Math.round(gs / cs), Math.round(bs / cs)]);
  });
  return { palette, lookup };
}

function indexFrame(fr, lookup) {
  const idx = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = fr[i * 3], g = fr[i * 3 + 1], b = fr[i * 3 + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const v = lookup.get(key); idx[i] = v === undefined ? 0 : v;
  }
  return idx;
}

// GIF-variable-width LZW (bump when nextCode === 2^codeSize; clear at 4096)
function lzw(minCode, indices) {
  const CLEAR = 1 << minCode, EOI = CLEAR + 1;
  let codeSize = minCode + 1, next = EOI + 1, dict = new Map();
  const out = []; let buf = 0, bits = 0;
  function put(code) { buf |= code << bits; bits += codeSize; while (bits >= 8) { out.push(buf & 0xff); buf >>= 8; bits -= 8; } }
  put(CLEAR);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i], key = (prefix << 8) | k;
    const got = dict.get(key);
    if (got !== undefined) { prefix = got; continue; }
    put(prefix);
    if (next === 4096) { put(CLEAR); dict = new Map(); next = EOI + 1; codeSize = minCode + 1; }
    // bump one code LATE (next === 2^codeSize + 1): the decoder grows its table
    // one entry behind the encoder, so the width must change a code later to stay in sync.
    else { dict.set(key, next); next++; if (next === (1 << codeSize) + 1 && codeSize < 12) codeSize++; }
    prefix = k;
  }
  put(prefix); put(EOI);
  if (bits > 0) out.push(buf & 0xff);
  return out;
}

function encodeGIF(frames, palette, lookup, delays, loop) {
  const bytes = [];
  const push = (...a) => { for (const v of a) bytes.push(v & 0xff); };
  const u16 = (v) => push(v & 0xff, (v >> 8) & 0xff);
  // bits per pixel / color table size
  let bpp = 1; while ((1 << bpp) < palette.length) bpp++; bpp = Math.max(2, bpp);
  const gctSize = 1 << bpp;
  // header + logical screen descriptor
  for (const ch of "GIF89a") push(ch.charCodeAt(0));
  u16(W); u16(H); push(0x80 | ((bpp - 1) << 4) | (bpp - 1), 0, 0);
  // global color table (padded)
  for (let i = 0; i < gctSize; i++) { const c = palette[i] || [0, 0, 0]; push(c[0], c[1], c[2]); }
  // loop extension
  push(0x21, 0xFF, 0x0B); for (const ch of "NETSCAPE2.0") push(ch.charCodeAt(0)); push(0x03, 0x01); u16(loop); push(0x00);
  const minCode = Math.max(2, bpp);
  frames.forEach(function (fr, fi) {
    // graphic control extension (delay, no transparency, disposal=1)
    push(0x21, 0xF9, 0x04, 0x04); u16(delays[fi]); push(0x00, 0x00);
    // image descriptor (full frame, no local color table)
    push(0x2C); u16(0); u16(0); u16(W); u16(H); push(0x00);
    push(minCode);
    const data = lzw(minCode, indexFrame(fr, lookup));
    for (let i = 0; i < data.length;) { const n = Math.min(255, data.length - i); push(n); for (let j = 0; j < n; j++) push(data[i + j]); i += n; }
    push(0x00); // block terminator
  });
  push(0x3B); // trailer
  return Buffer.from(bytes);
}

const { palette, lookup } = quantize(frames, 256);
const gif = encodeGIF(frames, palette, lookup, delays, 0);
fs.mkdirSync(path.join(ROOT, "media"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "media", "gameplay.gif"), gif);
console.log("wrote media/gameplay.gif  (" + NF + " frames, " + palette.length + " colors, " + (gif.length / 1024).toFixed(1) + " KB)");
