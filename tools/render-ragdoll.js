// Renders dead-body RAGDOLLS (js/ragdoll.js) with the real drawing code so the
// corpse's new volumetric look can be eyeballed. The scene runs INSIDE the vm
// context because `class Ragdoll` is a lexical binding (not a global property),
// so it isn't reachable as sandbox.Ragdoll from outside.  node tools/render-ragdoll.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");
const { Ctx, encodePNG, SS } = require("./render-variant");
const ROOT = path.join(__dirname, "..");

const W = 600, H = 260, bg = "#3fa172";
const ctx = new Ctx(W * SS, H * SS);
ctx.bg(bg);
ctx.setTransform(SS, 0, 0, SS, 0, 0);

const groundY = H - 36;
ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 2;
ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(W, groundY); ctx.stroke();

const sandbox = { Math: Math, Image: undefined, console: console, ctx: ctx, groundY: groundY, W: W };
sandbox.window = sandbox; sandbox.TAU = Math.PI * 2;
vm.createContext(sandbox);
for (const f of ["js/utils.js", "js/weapons.js", "js/stickman.js", "js/ragdoll.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), "utf8"), sandbox, { filename: f });
}

// Build a few corpses flopped onto the ground (different impulses) and draw.
vm.runInContext(`
  const env = { g: 0.55, groundY: groundY, W: W };
  function corpse(x, facing, kick, frames) {
    const skel = computeSkeleton(x, groundY, facing, facing > 0 ? -0.3 : Math.PI + 0.3, { scale: 1 });
    const rd = new Ragdoll(skel, "#1c1c22");
    rd.impulseAll(kick.vx, kick.vy);
    rd.impulse("head", kick.vx * 1.4, kick.vy * 1.2 - 3);
    for (let i = 0; i < frames; i++) rd.update(env);
    rd.draw(ctx);
  }
  corpse(150, 1, { vx: 5.5, vy: -7 }, 46);      // blown backward, settled
  corpse(330, 1, { vx: 1.5, vy: -10 }, 30);     // mid-flop, still airborne-ish
  corpse(470, -1, { vx: -4, vy: -5 }, 60);      // fully settled, facing left
`, sandbox, { filename: "ragdoll-scene" });

fs.writeFileSync(path.join(__dirname, "_ragdoll.png"), encodePNG(ctx, SS));
console.log("wrote tools/_ragdoll.png");
