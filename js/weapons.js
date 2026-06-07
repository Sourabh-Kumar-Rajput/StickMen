// ---------------------------------------------------------------------------
// weapons.js — bows, elemental ammo, charge + shield config (global consts).
// Loaded after stickman.js and before game.js. No exports (classic script).
// gravMult/speedMult MUST be mirrored by drawAimPreview so the dotted arc is
// truthful per ammo. dmg is a damage multiplier applied to the part base.
// ---------------------------------------------------------------------------
"use strict";

// Element accent colors (shaft tint, aura, status FX, shop chips).
const ELEM_COLOR = {
  none: "#c9a24a", fire: "#ff6a2a", ice: "#5cc8ff", poison: "#7ad13b",
  air: "#dfe8ff", bomb: "#ff8a3b", blackhole: "#b06bff"
};

// Selectable ammo. `owned:true` = available from the start; others are bought.
const AMMO = {
  normal:    { id: "normal",    name: "Arrow",      icon: "🏹", kind: "arrow",     element: "none",      dmg: 1.0, fireCd: 22, gravMult: 1,    speedMult: 1,    price: 0,    owned: true, desc: "A trusty wooden arrow. Reliable and fast." },
  multishot: { id: "multishot", name: "Multi-shot", icon: "🎯", kind: "arrow",     element: "none",      dmg: 0.7, fireCd: 34, gravMult: 1,    speedMult: 1,    price: 220,  count: 3, spread: 0.12, desc: "Looses three arrows in a spread." },
  fire:      { id: "fire",      name: "Fire",       icon: "🔥", kind: "arrow",     element: "fire",      dmg: 1.0, fireCd: 28, gravMult: 1,    speedMult: 1,    price: 250,  desc: "Burns over time. A burning foe ignites others when it dies." },
  ice:       { id: "ice",       name: "Ice",        icon: "❄", kind: "arrow",      element: "ice",       dmg: 0.8, fireCd: 30, gravMult: 1,    speedMult: 1,    price: 300,  desc: "Freezes the target solid for a short time." },
  poison:    { id: "poison",    name: "Poison",     icon: "☠", kind: "arrow",      element: "poison",    dmg: 0.7, fireCd: 30, gravMult: 1,    speedMult: 1,    price: 320,  desc: "Potent venom — more damage over time than fire." },
  air:       { id: "air",       name: "Air",        icon: "🌀", kind: "arrow",     element: "air",       dmg: 0.6, fireCd: 26, gravMult: 1,    speedMult: 1,    price: 200,  desc: "A gust that slows the target to a crawl." },
  bomb:      { id: "bomb",      name: "Bomb",       icon: "💣", kind: "explosive", element: "bomb",      dmg: 1.0, fireCd: 44, gravMult: 1.15, speedMult: 0.92, price: 380,  aoe: { radius: 130, dmg: 60, selfRadius: 80, selfDmg: 40 }, desc: "Explodes on impact, damaging everything nearby." },
  blackhole: { id: "blackhole", name: "Black Hole", icon: "🕳", kind: "arrow",     element: "blackhole", dmg: 0.4, fireCd: 70, gravMult: 1,    speedMult: 1,    price: 1200, desc: "Tears open a singularity that drags foes in and crushes them." },
  knife:     { id: "knife",     name: "Knives",     icon: "🗡", kind: "knife",     element: "none",      dmg: 1.2, fireCd: 26, gravMult: 1.5,  speedMult: 0.82, price: 180,  spinV: 0.5, desc: "Spinning thrown blades — heavy, short range, hits hard." }
};
const AMMO_ORDER = ["normal", "multishot", "fire", "ice", "poison", "air", "bomb", "blackhole", "knife"];

// Bows: `damage` scales every shot; `chargeBonus` is the extra damage at full
// charge; `chargeRate` is how fast the bow charges while held.
// `glow` tints the limbs; `energy` drives the charge aura, arrow trail + impact FX.
const BOWS = {
  training:  { id: "training",  name: "Training Bow", icon: "🏹", price: 0,    damage: 1.0, chargeBonus: 0.6, chargeRate: 1.0,  color: "#6e4d2b", glow: null,      tip: "#caa15a", gem: null,      energy: "#ffb24a", desc: "Where every archer begins." },
  hunter:    { id: "hunter",    name: "Hunter Bow",   icon: "🏹", price: 150,  damage: 1.35, chargeBonus: 0.8, chargeRate: 1.1,  color: "#5a4326", glow: "#9be24a", tip: "#bfe96a", gem: "#7CFC00", energy: "#9be24a", desc: "Faster charge, sharper bite." },
  recurve:   { id: "recurve",   name: "Recurve Bow",  icon: "🏹", price: 400,  damage: 1.8, chargeBonus: 1.0, chargeRate: 1.15, color: "#2b3340", glow: "#3aa0ff", tip: "#bcd8ff", gem: "#3aa0ff", energy: "#4ab4ff", desc: "A serious step up in power." },
  composite: { id: "composite", name: "Composite Bow",icon: "🏹", price: 850,  damage: 2.3, chargeBonus: 1.25, chargeRate: 1.3, color: "#2a2433", glow: "#b06bff", tip: "#ffd24a", gem: "#b06bff", energy: "#c07bff", desc: "Layered limbs, devastating draw." },
  dragon:    { id: "dragon",    name: "Dragon Bow",   icon: "🐉", price: 1600, damage: 3.0, chargeBonus: 1.6, chargeRate: 1.4,  color: "#241a14", glow: "#ff5a2a", tip: "#ffae3b", gem: "#ff3a1a", energy: "#ff7a2a", desc: "Forged from dragonbone. Fully charged, it ends fights." }
};
const BOW_ORDER = ["training", "hunter", "recurve", "composite", "dragon"];

// Frames of holding to reach full charge (~0.9s at 60fps).
const CHARGE_MAX = 55;

// Player's raisable shield. arc = half-angle (radians) of the frontal block.
const SHIELD = { dur: 96, cd: 240, arc: Math.PI * 0.42, reach: 50 };
