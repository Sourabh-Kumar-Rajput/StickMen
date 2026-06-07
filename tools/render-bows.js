// Renders the SAME archer holding four different bow shapes (A..D), idle on the
// top row and drawing on the bottom, into one sheet so a human can pick which
// recurve matches a reference picture.  node tools/render-bows.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { Ctx, encodePNG, SS } = require("./render-variant");
const ROOT = path.join(__dirname, "..");

// Four candidate bow shapes spanning the design space.
const STYLES = [
  { key: "A", label: "slim recurve",  shape: { span: 37, belly: 12, recurve: 6,  rTip: 1.4, rGrip: 3.7 } },
  { key: "B", label: "bold recurve",  shape: { span: 40, belly: 14, recurve: 9,  rTip: 2.2, rGrip: 5.2 } },
  { key: "C", label: "longbow arc",   shape: { span: 41, belly: 17, recurve: 0,  rTip: 1.8, rGrip: 4.4 } },
  { key: "D", label: "deep recurve",  shape: { span: 42, belly: 18, recurve: 11, rTip: 1.6, rGrip: 4.4 } },
];

const COLS = STYLES.length, CW = 200, CH = 230, ROWS = 2;
const W = CW * COLS, H = CH * ROWS, bg = "#3fa172";
const ctx = new Ctx(W * SS, H * SS);
ctx.bg(bg);
ctx.setTransform(SS, 0, 0, SS, 0, 0);

const sandbox = { Math: Math, Image: undefined, console: console };
sandbox.window = sandbox; sandbox.TAU = Math.PI * 2;
vm.createContext(sandbox);
for (const f of ["js/utils.js", "js/weapons.js", "js/stickman.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
}

// faint label bars + cell separators
ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1.5;
for (let c = 1; c < COLS; c++) { ctx.beginPath(); ctx.moveTo(c * CW, 0); ctx.lineTo(c * CW, H); ctx.stroke(); }
ctx.beginPath(); ctx.moveTo(0, CH); ctx.lineTo(W, CH); ctx.stroke();

function pose(cx, groundY, opt, shape) {
  const s = sandbox.computeSkeleton(opt.x, groundY, opt.facing, opt.aim, { draw: opt.draw, lean: opt.draw ? 0.8 : 0 });
  // shift so the figure centers in its cell
  ctx.save(); ctx.translate(cx - opt.x, 0);
  sandbox.drawArcher(ctx, s, {
    color: "#1c1c22", weapon: "bow", draw: opt.draw, charge: opt.charge || 0,
    bowColor: "#6e4d2b", bowTip: "#caa15a", bowArt: "training", bowShape: shape
  });
  ctx.restore();
}

STYLES.forEach(function (st, i) {
  const cx = i * CW + CW / 2;
  // top: idle
  pose(cx, CH - 40, { x: 0, facing: 1, aim: 0.12, draw: false }, st.shape);
  // bottom: drawing a half charge
  pose(cx, CH + CH - 40, { x: 0, facing: 1, aim: -0.32, draw: true, charge: 0.5 }, st.shape);
  // a little tick mark per column so A/B/C/D are countable left->right
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  for (let k = 0; k <= i; k++) { ctx.beginPath(); ctx.arc(i * CW + 12 + k * 9, 12, 3, 0, Math.PI * 2); ctx.fill(); }
});

fs.writeFileSync(path.join(__dirname, "_bows_compare.png"), encodePNG(ctx, SS));
console.log("wrote tools/_bows_compare.png  (A=1 dot, B=2, C=3, D=4 dots, left->right)");
