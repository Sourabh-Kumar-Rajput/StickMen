// headless.js — boots the FULL game (all 11 scripts) under a stubbed DOM and
// drives real animation frames across every mode + the editor, asserting the
// integration layer (game loop, render, input, UI, editor, storage) never
// throws. Audio stays dormant (never unlocked) so no AudioContext is needed.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.join(__dirname, "..");
const FILES = ["utils", "ragdoll", "stickman", "weapons", "arrow", "archer", "audio", "storage", "game", "editor", "shop", "main"]
  .map(function (n) { return "js/" + n + ".js"; });

// ---- DOM stubs ----------------------------------------------------------
function ctxStub() {
  const methods = ["setTransform", "fillRect", "clearRect", "save", "restore", "beginPath", "closePath",
    "rect", "clip", "arc", "moveTo", "lineTo", "quadraticCurveTo", "bezierCurveTo", "stroke", "fill",
    "fillText", "strokeText", "translate", "rotate", "scale", "drawImage", "setLineDash", "ellipse", "arcTo"];
  const c = {};
  methods.forEach(function (m) { c[m] = function () {}; });
  c.createLinearGradient = function () { return { addColorStop: function () {} }; };
  c.createRadialGradient = function () { return { addColorStop: function () {} }; };
  c.measureText = function () { return { width: 0 }; };
  return c;
}
function makeEl(tag) {
  const el = {
    tag: tag, _children: [], _ev: {}, style: { setProperty: function () {}, removeProperty: function () {} }, dataset: {},
    classList: { _s: new Set(),
      add: function (c) { this._s.add(c); }, remove: function (c) { this._s.delete(c); },
      toggle: function (c, f) { if (f === undefined) { this._s.has(c) ? this._s.delete(c) : this._s.add(c); } else if (f) this._s.add(c); else this._s.delete(c); return this._s.has(c); },
      contains: function (c) { return this._s.has(c); } },
    addEventListener: function (t, cb) { (this._ev[t] = this._ev[t] || []).push(cb); },
    removeEventListener: function () {},
    appendChild: function (c) { this._children.push(c); return c; },
    removeChild: function (c) { const i = this._children.indexOf(c); if (i >= 0) this._children.splice(i, 1); },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    setAttribute: function () {}, removeAttribute: function () {},
    closest: function () { return null; },
    getBoundingClientRect: function () { return { left: 0, top: 0, width: 1280, height: 720 }; },
    focus: function () {}, toBlob: function (cb) { cb(null); },
    _textContent: "", _innerHTML: "", value: ""
  };
  Object.defineProperty(el, "children", { get: function () { return this._children; } });
  Object.defineProperty(el, "textContent", { get: function () { return this._textContent; }, set: function (v) { this._textContent = v; } });
  Object.defineProperty(el, "innerHTML", { get: function () { return this._innerHTML; }, set: function (v) { this._innerHTML = v; if (v === "") this._children = []; } });
  if (tag === "canvas") {
    el.width = 1280; el.height = 720;
    el._ctx = ctxStub();
    el.getContext = function () { return this._ctx; };
    el.setPointerCapture = function () {}; el.releasePointerCapture = function () {};
  }
  return el;
}

const els = {};
function getEl(id) { if (!els[id]) els[id] = makeEl(id === "game" ? "canvas" : "div"); els[id].id = id; return els[id]; }

let store = {};
const localStorage = {
  getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function (k, v) { store[k] = String(v); },
  removeItem: function (k) { delete store[k]; }
};

const winListeners = {}, docListeners = {};
const win = {
  innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
  addEventListener: function (t, cb) { (winListeners[t] = winListeners[t] || []).push(cb); },
  removeEventListener: function () {},
  matchMedia: function () { return { matches: false }; },
  requestAnimationFrame: function (cb) { rafCb = cb; return 1; },
  AudioContext: undefined, webkitAudioContext: undefined,
  Capacitor: undefined
};
const documentStub = {
  getElementById: getEl,
  createElement: makeEl,
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function (t, cb) { (docListeners[t] = docListeners[t] || []).push(cb); },
  documentElement: makeEl("html"),
  hidden: false,
  body: makeEl("body")
};

let rafCb = null;
const sandbox = {
  window: win, document: documentStub, navigator: { serviceWorker: undefined, userAgent: "node" },
  screen: { orientation: null }, location: { protocol: "file:" }, localStorage: localStorage,
  Math: Math, Date: Date, JSON: JSON, console: console, performance: { now: function () { return clock; } },
  requestAnimationFrame: function (cb) { rafCb = cb; return 1; }, setTimeout: function () { return 0; }, clearTimeout: function () {}
};
sandbox.globalThis = sandbox;
sandbox.__out = {};
const ctx = vm.createContext(sandbox);

let clock = 0;
let failures = 0;
function ok(cond, label) { console.log((cond ? "  PASS " : "  FAIL ") + label); if (!cond) failures++; }

// ---- load all scripts into one shared scope ----
try {
  const bundle = FILES.map(function (f) { return fs.readFileSync(path.join(root, f), "utf8"); }).join("\n;\n")
    + "\n;Object.assign(__out, { Game: Game, Editor: Editor, Store: Store, Shop: Shop, UI: UI, Sound: Sound, Archer: Archer });";
  vm.runInContext(bundle, ctx, { filename: "bundle.js" });
  console.log("[boot] all " + FILES.length + " scripts loaded without throwing"); ok(true, "scripts load");
} catch (e) { ok(false, "scripts load — " + e.message + "\n" + e.stack); finish(); }

function fire(listeners, type, ev) { (listeners[type] || []).forEach(function (cb) { cb(ev); }); }
function fireEl(el, type, ev) { ((el._ev && el._ev[type]) || []).forEach(function (cb) { cb(ev); }); }
function frames(n) { for (let i = 0; i < n; i++) { const cb = rafCb; rafCb = null; clock += 16.67; if (cb) cb(clock); } }
function pointer(type, x, y) {
  const canvas = els.game;
  const ev = { clientX: x, clientY: y, pointerId: 1, pointerType: "mouse", target: canvas, preventDefault: function () {} };
  if (type === "down") fireEl(canvas, "pointerdown", ev);
  else fire(winListeners, "pointer" + type, ev);
}
function shoot() { pointer("down", 300, 360); pointer("move", 220, 420); pointer("up", 220, 430); }

function run(label, fn) { try { fn(); ok(true, label); } catch (e) { ok(false, label + " — " + e.message + "\n" + e.stack); } }

// ---- boot ----
run("DOMContentLoaded boot (Game.init + UI + Editor.init)", function () { fire(winListeners, "DOMContentLoaded", {}); });
const Game = ctx.__out.Game, Editor = ctx.__out.Editor, Store = ctx.__out.Store, Shop = ctx.__out.Shop;
function chargedShoot() { pointer("down", 300, 360); frames(25); pointer("move", 210, 430); pointer("up", 210, 430); }
run("renders menu frames", function () { frames(60); });
run("one-time 10k coin grant applied", function () { ok(Store.getCoins() >= 10000, "coins = " + Store.getCoins()); });

// ---- unlock the full armory so every element can be exercised ----
run("unlock all ammo + bows", function () {
  ["multishot", "fire", "ice", "poison", "air", "bomb", "blackhole", "knife"].forEach(function (id) { Store.buyAmmo(id, 0); });
  ["hunter", "recurve", "composite", "dragon"].forEach(function (id) { Store.buyBow(id, 0); });
  Store.equipBow("dragon"); Game.refreshLoadout();
});

// ---- survival: drive frames + fire every element + a charged shot ----
run("survival mode: boot", function () { Game.startMode("survival"); });
run("survival: 200 frames with bow fire", function () { for (let i = 0; i < 8; i++) { shoot(); frames(25); } });
run("survival: fire every element + a charged shot", function () {
  ["normal", "multishot", "fire", "ice", "poison", "air", "bomb", "blackhole", "knife"].forEach(function (id) { Game.selectWeapon(id); shoot(); frames(20); });
  Game.selectWeapon("fire"); chargedShoot(); frames(40);
  Game.selectWeapon("blackhole"); shoot(); frames(150);   // let a singularity live + collapse
});
run("weapon bar renders no 'undefined' labels", function () {
  Game.selectWeapon("normal");
  const html = (els.weaponBar._children || []).map(function (b) { return b.innerHTML; }).join(" ");
  ok(els.weaponBar._children.length > 0 && html.indexOf("undefined") === -1, "weapon buttons are clean (" + els.weaponBar._children.length + " btns)");
});
run("survival: raise shield + frames", function () { Game.raiseShield(); frames(120); });
run("survival: long run to spawn waves of varied enemies", function () { frames(500); });

// ---- duel ----
run("duel mode end-to-end frames", function () { Game.startMode("duel"); frames(120); shoot(); frames(120); });

// ---- campaign ----
run("campaign mode boot + frames", function () { Game.startMode("campaign"); frames(150); shoot(); frames(150); });

// ---- pause/resume/quit ----
run("pause + resume + quit to menu", function () { Game.pause(); frames(10); Game.resume(); frames(10); Game.quitToMenu(); frames(30); });

// ---- editor + custom level round trip ----
run("editor: open + place 3 enemies + save", function () {
  Editor.open();
  Editor.selectType("archer"); pointer("down", 500, 360);
  Editor.selectType("runner"); pointer("down", 700, 360);
  Editor.selectType("tank"); pointer("down", 900, 360);
  els.editorName.value = "Test Arena";
  const id = Store.customSave({ id: null, name: "Test Arena", enemies: [{ type: "archer", xFrac: 0.5, delay: 0 }, { type: "runner", xFrac: 0.7, delay: 0.7 }] });
  ok(!!id, "  (custom level saved id=" + id + ")");
});
run("editor: render frames in editor state", function () { frames(30); });
run("custom level plays through", function () {
  Game.playCustom({ name: "Test Arena", enemies: [{ type: "archer", xFrac: 0.6, delay: 0 }, { type: "shielded", xFrac: 0.8, delay: 0.5 }] });
  frames(120); shoot(); frames(120);
});
run("quit back to menu", function () { Game.quitToMenu(); frames(20); });

// ---- boss AI smoke (drive runBossAI through its patterns) ----
run("boss AI: 600 frames of runBossAI without throw + finite x", function () {
  const Archer = ctx.__out.Archer;
  const env = { g: 0.42, groundY: 650, W: 1280, dt: 1, spawn: function () {}, spawnBomb: function () {}, summon: function () {} };
  const target = new Archer({ x: 128, facing: 1, isPlayer: true, hp: 100 }); target.s = target.skeleton(650);
  const boss = new Archer({ x: 1340, facing: -1, type: "boss", isBoss: true, scale: 2.2, hp: 1100, skill: 0.6, reload: 60, launchV: 22, speed: 0.6 });
  boss.homeX = 793; boss.s = boss.skeleton(650);
  let finiteOk = true, patterns = {};
  for (let f = 0; f < 600; f++) {
    boss.hp = 1100 * (1 - f / 700);           // drain hp to walk through all 3 phases
    boss.update(env, target);
    if (!Number.isFinite(boss.x)) finiteOk = false;
    patterns[boss.boss.pattern] = true;
  }
  ok(finiteOk, "  boss x finite across phases");
  ok(boss.x >= 120 && boss.x <= 1280 - 120 + 1, "  boss x stays on-screen (" + Math.round(boss.x) + ")");
});

// ---- shop UI render ----
run("shop: open + render previews + both tabs + close", function () {
  Shop.open();
  const rows = els.shopList._children;
  ok(rows.length > 0 && rows[0]._children.some(function (c) { return c.tag === "canvas"; }), "shop rows render a preview canvas");
  els.shopTabArrows && fireEl(els.shopTabArrows, "click", {});
  Shop.close();
});

// ---- storage records ----
run("storage: record bests + read back", function () {
  Store.recordSurvival(7, 1200); Store.recordCampaignLevel(0, 3, 88); Store.recordDuel(true, 4200);
  const d = Store.all();
  ok(d.survival.bestWave === 7 && d.campaign.levels[0].stars === 3 && d.duel.wins === 1, "  bests persisted");
});

finish();
function finish() {
  console.log("\n" + (failures ? failures + " HEADLESS CHECK(S) FAILED" : "ALL HEADLESS CHECKS PASSED"));
  process.exit(failures ? 1 : 0);
}
