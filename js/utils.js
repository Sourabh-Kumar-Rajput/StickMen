// ---------------------------------------------------------------------------
// utils.js — small shared math/drawing helpers (global, classic-script scope)
// ---------------------------------------------------------------------------
"use strict";

const TAU = Math.PI * 2;
const ARM_LEN = 40; // reach of the bow arm; shared by skeleton + firing math

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function rand(a, b) { return a + Math.random() * (b - a); }
function randInt(a, b) { return Math.floor(a + Math.random() * (b - a + 1)); }
function dist(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }

// Shortest distance from point (px,py) to segment a->b.
// When a==b this collapses to point-to-point, so head hitboxes work too.
function pointSegDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

// Draw a line between two {x,y} joints using the current stroke style.
function line(ctx, a, b) {
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// View transform — the game runs in a fixed 1280x720 virtual space that is
// letterboxed to fit any window/device. VIEW is written by Game.resize() and
// read by both rendering and pointer mapping. Offsets/scale are in CSS pixels
// (PointerEvent.clientX/Y are CSS px); dpr is applied separately at draw time.
// ---------------------------------------------------------------------------
const VIEW = { scale: 1, offX: 0, offY: 0, dpr: 1 };

function screenToVirtual(clientX, clientY) {
  return { x: (clientX - VIEW.offX) / VIEW.scale, y: (clientY - VIEW.offY) / VIEW.scale };
}
function virtualToScreen(vx, vy) {
  return { x: vx * VIEW.scale + VIEW.offX, y: vy * VIEW.scale + VIEW.offY };
}

// Darken (amt<0) or lighten (amt>0) a "#rrggbb" color. amt in [-1,1].
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = amt < 0 ? (1 + amt) : 1;
  const add = amt > 0 ? amt * 255 : 0;
  r = clamp(Math.round(r * f + add), 0, 255);
  g = clamp(Math.round(g * f + add), 0, 255);
  b = clamp(Math.round(b * f + add), 0, 255);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
