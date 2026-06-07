// Renders a promo screenshot (two archers dueling) using the REAL drawing code,
// for the README. Writes media/screenshot.png.   node tools/render-banner.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { Ctx, encodePNG, SS } = require("./render-variant");
const ROOT = path.join(__dirname, "..");

const W = 1200, H = 470;
const ctx = new Ctx(W * SS, H * SS);
ctx.setTransform(SS, 0, 0, SS, 0, 0);
// the minimal rasterizer has no fillRect — fill a rectangle path instead
function rect(x, y, w, h) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); ctx.fill(); }

// ---- background (grassland theme palette, flat fills since no gradients) ----
const groundY = 392;
ctx.fillStyle = "#cfe8f5"; rect(0, 0, W, H);                 // sky
ctx.fillStyle = "#e6eff5"; rect(0, groundY - 150, W, 150);  // haze band near horizon
// soft clouds
ctx.globalAlpha = 0.7; ctx.fillStyle = "#ffffff";
[[210, 90, 60, 18], [520, 64, 80, 22], [930, 104, 66, 19], [1080, 70, 50, 15]].forEach(function (c) {
  ctx.beginPath(); ctx.ellipse(c[0], c[1], c[2], c[3], 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(c[0] + c[2] * 0.6, c[1] + 4, c[2] * 0.6, c[3] * 0.8, 0, 0, Math.PI * 2); ctx.fill();
});
ctx.globalAlpha = 1;
// far + mid hills
function hill(cy, amp, tone, n) {
  ctx.fillStyle = tone; ctx.beginPath(); ctx.moveTo(0, groundY);
  for (let i = 0; i <= n; i++) { const x = (i / n) * W; const y = cy - Math.abs(Math.sin(i * 1.7 + 0.6)) * amp; ctx.lineTo(x, y); }
  ctx.lineTo(W, groundY); ctx.closePath(); ctx.fill();
}
hill(groundY - 38, 70, "#bcd0e8", 6);
hill(groundY - 14, 46, "#bcd9ad", 7);
// ground
ctx.fillStyle = "#caa46a"; rect(0, groundY, W, H - groundY);
ctx.fillStyle = "#7d9a55"; rect(0, groundY - 5, W, 9);
ctx.fillStyle = "rgba(0,0,0,0.06)"; rect(0, groundY, W, 1);
// a few grass tufts
ctx.strokeStyle = "#5f8a3e"; ctx.lineWidth = 2; ctx.lineCap = "round";
for (let i = 0; i < 26; i++) {
  const x = 20 + i * 46, y = groundY + 10 + (i % 3) * 7;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 3, y - 7); ctx.moveTo(x, y); ctx.lineTo(x, y - 9); ctx.moveTo(x, y); ctx.lineTo(x + 3, y - 7); ctx.stroke();
}

// ---- load real drawing code ----
const sb = { Math: Math, Image: undefined, console: console };
sb.window = sb; sb.TAU = Math.PI * 2;
vm.createContext(sb);
for (const f of ["js/utils.js", "js/weapons.js", "js/stickman.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sb, { filename: f });
}

function archer(x, facing, aim, charge, col, bow) {
  const s = sb.computeSkeleton(x, groundY, facing, aim, { draw: true, lean: 0.85 });
  sb.drawArcher(ctx, s, Object.assign({ color: col, weapon: "bow", draw: true, charge: charge, bowArt: "training" }, bow));
}

// a simple arrow in flight (shaft + steel head + fletching), pointing along ang
function flyArrow(x, y, ang, len) {
  const c = Math.cos(ang), s = Math.sin(ang), px = -s, py = c;
  const tx = x + c * len, ty = y + s * len;       // head
  const bxp = x - c * len, byp = y - s * len;     // nock
  ctx.strokeStyle = "#7a5a30"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(bxp, byp); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.fillStyle = "#cfd3da";                       // steel head
  ctx.beginPath(); ctx.moveTo(tx + c * 7, ty + s * 7);
  ctx.lineTo(tx + px * 4, ty + py * 4); ctx.lineTo(tx - px * 4, ty - py * 4); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e9e4d4";                       // fletching
  for (const d of [0, 1]) {
    const fx = bxp + c * d * 6, fy = byp + s * d * 6;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - c * 7 + px * 5, fy - s * 7 + py * 5); ctx.lineTo(fx - c * 7, fy - s * 7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx - c * 7 - px * 5, fy - s * 7 - py * 5); ctx.lineTo(fx - c * 7, fy - s * 7); ctx.closePath(); ctx.fill();
  }
}

// player (left, wood bow) vs enemy (right, dark steel bow) dueling
archer(300, 1, -0.36, 0.7, "#1c1c22", { bowColor: "#6e4d2b", bowTip: "#caa15a" });
archer(905, -1, Math.PI + 0.36, 0.55, "#181820", { bowColor: "#2b3340", bowTip: "#bcd8ff" });

// arrows arcing across the field
flyArrow(560, 250, -0.06, 13);
flyArrow(690, 244, 0.10, 13);
flyArrow(470, 286, -0.20, 12);

fs.mkdirSync(path.join(ROOT, "media"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "media", "screenshot.png"), encodePNG(ctx, SS));
console.log("wrote media/screenshot.png");
