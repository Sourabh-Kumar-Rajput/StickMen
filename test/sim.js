// Headless smoke test: loads the DOM-free game modules into one shared scope
// (mirroring how browsers share top-level scope across classic <script> tags)
// and exercises the physics, AI ballistics, collision, and ragdoll code.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const files = ["js/utils.js", "js/ragdoll.js", "js/stickman.js", "js/arrow.js", "js/archer.js"];

const groundY = 600, W = 1280;
let hitCount = 0, killCount = 0, blockCount = 0;
const Game = {
  env: { g: 0.42, groundY, W, dt: 1, spawn: null, spawnBomb: function () {}, summon: function () {} },
  onHit() { hitCount++; },
  onKill() { killCount++; },
  onBlock() { blockCount++; },
  onDot() {}
};
const ctx = vm.createContext({ Math, console, Game, __out: {} });

const bundle = files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n;\n")
  + "\n;Object.assign(__out, { Archer, Arrow, Ragdoll, computeSkeleton, archerHitSegments, solveBallistic, pointSegDist, clamp, lerp });";
vm.runInContext(bundle, ctx, { filename: "bundle.js" });
const { Archer, Arrow, archerHitSegments, solveBallistic, pointSegDist, lerp } = ctx.__out;

let failures = 0;
function ok(cond, label) { console.log((cond ? "  PASS " : "  FAIL ") + label); if (!cond) failures++; }
function finite(v) { return Number.isFinite(v); }

// Swept collision exactly like game.js collide().
function arrowHits(arrow, target) {
  const segs = archerHitSegments(target.s);
  for (let i = 0; i <= 6; i++) {
    const sx = lerp(arrow.px, arrow.x, i / 6), sy = lerp(arrow.py, arrow.y, i / 6);
    for (const sg of segs) if (pointSegDist(sx, sy, sg.ax, sg.ay, sg.bx, sg.by) < sg.r) return sg.part;
  }
  return null;
}

console.log("\n[1] Ballistic solver reaches across the arena");
let reachable = 0;
for (let d = 100; d <= 1100; d += 100) {
  const sol = solveBallistic(1100, groundY - 90, 1100 - d, groundY - 90, ctx.__out.clamp(Math.sqrt(0.42 * 0.95 * W), 15, 30), 0.42);
  if (sol && finite(sol.vx) && finite(sol.vy)) reachable++;
}
ok(reachable >= 9, "reachable distances " + reachable + "/11");

console.log("\n[2] Deterministic collision: torso, headshot, and a clean miss");
function dummy() { const e = new Archer({ x: 700, facing: -1, type: "archer", hp: 100 }); e.s = e.skeleton(groundY); return e; }
// helper: arrow whose swept path (px,py)->(x,y) ends on the given point
function arrowThrough(px, py, behind) { const ar = new Arrow(px, py, 20, 0, "player"); ar.px = px - behind; ar.py = py; return ar; }
// torso shot — path ends on the lower torso (below the outstretched arms)
let t = dummy();
const torsoMidY = (t.s.chest.y + t.s.pelvis.y) / 2;
ok(arrowHits(arrowThrough(t.s.chest.x, torsoMidY, 25), t) === "torso", "torso hit detected");
// head shot — path ends on the head
t = dummy();
ok(arrowHits(arrowThrough(t.s.head.x, t.s.head.y, 25), t) === "head", "head hit detected");
// clean miss high above
t = dummy();
ok(arrowHits(arrowThrough(t.s.head.x, t.s.head.y - 120, 25), t) === null, "arrow well above target misses");

console.log("\n[3] Headshot is an instant kill; ragdoll spawns and stays finite");
t = dummy();
t.damage("head", { vx: 12, vy: -4 }, null);
ok(t.dead && t.ragdoll, "headshot killed target + ragdoll created");
let stable = true;
for (let f = 0; f < 300; f++) { t.ragdoll.update(Game.env); for (const p of t.ragdoll.points) if (!finite(p.x) || !finite(p.y)) stable = false; }
ok(stable, "ragdoll positions finite after 300 frames");
let onGround = t.ragdoll.points.every(p => p.y <= groundY + 0.5);
ok(onGround, "ragdoll settles on/above the ground");

console.log("\n[4] Body shots accumulate damage toward death");
t = dummy();
const before = t.hp;
t.damage("torso", { vx: 8, vy: 0 }, null);
ok(t.hp === before - 34 && !t.dead, "single torso hit deals 34, not lethal");
t.damage("torso", { vx: 8, vy: 0 }, null);
t.damage("torso", { vx: 8, vy: 0 }, null);
ok(t.dead, "three torso hits kill a 100hp target");

console.log("\n[5] Enemy AI actually fires at the player over a fight");
const player = new Archer({ x: 128, facing: 1, isPlayer: true, hp: 100000 });
player.s = player.skeleton(groundY);
const enemy = new Archer({ x: W - 220, facing: -1, type: "archer", hp: 80, skill: 0.6, reload: 30, launchV: ctx.__out.clamp(Math.sqrt(0.42 * 0.95 * W), 15, 30) });
enemy.homeX = W - 220; enemy.s = enemy.skeleton(groundY);
const fired = [];
Game.env.spawn = (x, y, vx, vy, owner) => { const ar = new Arrow(x, y, vx, vy, owner); fired.push(ar); return ar; };
let allFinite = true;
for (let f = 0; f < 400; f++) {
  player.s = player.skeleton(groundY);
  enemy.update(Game.env, player);
  for (const ar of fired) { ar.update(0.42, groundY); if (!finite(ar.x) || !finite(ar.y)) allFinite = false; }
}
ok(fired.length > 0, "enemy fired " + fired.length + " arrows");
ok(allFinite, "all enemy arrows have finite positions");
let landed = fired.some(ar => ar.stuck && Math.abs(ar.x - player.x) < 120);
ok(landed || hitCount > 0, "at least one enemy arrow reached the player's position");

console.log("\n[6] Shielded enemy blocks frontal arrows but not headshots/flanks");
let sh = new Archer({ x: 700, facing: -1, type: "shielded", guard: true, hp: 90 }); sh.s = sh.skeleton(groundY);
sh.damage("torso", { vx: 6, vy: 0 }, null);                 // frontal (arrow moving right into its front)
ok(sh.hp === 90 && blockCount > 0, "frontal torso shot blocked (no damage)");
sh.damage("torso", { vx: -6, vy: 0 }, null);                // from behind
ok(sh.hp === 90 - 34, "shot from behind deals full damage");
sh.damage("head", { vx: 6, vy: 0 }, null);                  // headshot bypasses shield
ok(sh.dead, "headshot bypasses the shield");

console.log("\n[7] Tank takes reduced damage");
let tank = new Archer({ x: 700, facing: -1, type: "tank", hp: 200, dmgResist: 0.35 }); tank.s = tank.skeleton(groundY);
tank.damage("torso", { vx: 6, vy: 0 }, null);
ok(Math.abs(tank.hp - (200 - 34 * 0.65)) < 0.001, "torso hit reduced by 35% resist");

console.log("\n[8] Boss: scaled, finite-head damage, stable ragdoll");
let boss = new Archer({ x: 700, facing: -1, type: "boss", isBoss: true, scale: 2.2, hp: 1100 }); boss.s = boss.skeleton(groundY);
ok(boss.s.scale === 2.2 && boss.s.headR > 12, "boss skeleton is scaled up");
boss.damage("head", { vx: 6, vy: 0 }, null);
ok(!boss.dead && boss.hp === 1100 - 120, "boss headshot is finite (120), not instant");
boss.hp = 1; boss.damage("torso", { vx: 6, vy: 0 }, null);
ok(boss.dead && boss.ragdoll, "boss dies + ragdoll created");
let bstable = true;
for (let f = 0; f < 300; f++) { boss.ragdoll.update(Game.env); for (const p of boss.ragdoll.points) if (!finite(p.x) || !finite(p.y)) bstable = false; }
ok(bstable, "scaled boss ragdoll stays finite over 300 frames");

console.log("\n[9] Projectile kinds: explosive detonates on ground, knife spins");
let exp = new Arrow(700, groundY - 40, 0, 4, "player", { kind: "explosive", aoe: { radius: 100, dmg: 60 }, sticks: false });
for (let f = 0; f < 40 && !exp.explodeOnGround; f++) exp.update(0.42, groundY);
ok(exp.kind === "explosive" && exp.sticks === false && exp.explodeOnGround, "explosive arms on ground for detonation");
let kn = new Arrow(700, 300, 8, -2, "player", { kind: "knife", spinV: 0.5 });
kn.update(0.42, groundY);
ok(kn.kind === "knife" && kn.spin > 0, "knife spins in flight");

console.log("\n[10] Status effects: fire DoT, freeze, slow");
const tgt = new Archer({ x: 100, facing: 1, isPlayer: true, hp: 100 }); tgt.s = tgt.skeleton(groundY);
let pf = new Archer({ x: 700, facing: -1, type: "archer", hp: 80 }); pf.s = pf.skeleton(groundY);
pf.applyStatus("fire", 0.5);
const fhp0 = pf.hp;
for (let f = 0; f < 90; f++) pf.update(Game.env, tgt);
ok(pf.hp < fhp0, "fire deals damage over time (" + Math.round(fhp0 - pf.hp) + " dmg)");
let pi = new Archer({ x: 700, facing: -1, type: "archer", hp: 80 }); pi.s = pi.skeleton(groundY);
pi.applyStatus("ice", 0);
ok(pi.status.freezeT > 0, "ice freezes the target");
pi.update(Game.env, tgt);
ok(!!pi.s && !pi.dead, "frozen enemy updates safely (no throw)");
let pa = new Archer({ x: 700, facing: -1, type: "runner", hp: 60, speed: 1 }); pa.s = pa.skeleton(groundY);
pa.applyStatus("air", 0);
ok(pa.slowMul() < 1, "air slows the target");
pa.update(Game.env, tgt); const movedSlow = Math.abs(pa.x - 700);
let pn = new Archer({ x: 700, facing: -1, type: "runner", hp: 60, speed: 1 }); pn.s = pn.skeleton(groundY);
pn.update(Game.env, tgt); const movedNormal = Math.abs(pn.x - 700);
ok(movedSlow < movedNormal, "slowed runner moves less than a normal one");
let pb = new Archer({ x: 700, facing: -1, type: "boss", isBoss: true, scale: 2.2, hp: 1100 }); pb.s = pb.skeleton(groundY);
pb.applyStatus("ice", 1); ok(pb.status.freezeT > 0 && pb.status.freezeT < 130, "boss is only briefly frozen (resistant)");

console.log("\n" + (failures ? failures + " CHECK(S) FAILED" : "ALL CHECKS PASSED"));
process.exit(failures ? 1 : 0);
