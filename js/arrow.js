// ---------------------------------------------------------------------------
// arrow.js — a single projectile. Integrates under gravity, sticks into the
// ground or a ragdoll, and keeps a short motion trail. The 5-arg constructor
// is preserved (enemy fire + tests rely on it); an optional 6th `opts` arg
// turns it into a knife / exploding arrow / thrown bomb. Physics stays the
// exact discrete Euler the trajectory preview mirrors.
// ---------------------------------------------------------------------------
"use strict";

// per-kind gravity multiplier — MUST be mirrored by drawAimPreview()
function arrowGravMult(kind) {
  return kind === "knife" ? 1.5 : kind === "explosive" ? 1.15 : 1;
}

// "#rrggbb" + alpha -> rgba() string (local helper, self-contained)
function rgbaHex(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return "rgba(" + ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a + ")";
}

class Arrow {
  constructor(x, y, vx, vy, owner, opts) {
    opts = opts || {};
    this.x = x; this.y = y;
    this.px = x; this.py = y;      // previous tip position (swept collision)
    this.vx = vx; this.vy = vy;
    this.owner = owner;            // "player" | "enemy"
    this.angle = Math.atan2(vy, vx);
    this.stuck = false;
    this.deadTime = 0;
    this.life = 0;
    this.trail = [];
    this.stick = null;             // { ragdoll, name, ox, oy } when embedded
    // weapon variant
    this.kind = opts.kind || "arrow";   // arrow | knife | explosive | bomb
    this.spin = 0;
    this.spinV = opts.spinV || 0;
    this.aoe = opts.aoe || null;        // { radius, dmg, selfRadius, selfDmg }
    this.sticks = opts.sticks !== false;
    this.fuse = opts.fuse != null ? opts.fuse : -1;
    this.exploded = false;
    this.explodeOnGround = false;       // game.js reads this to detonate
    // elemental / charged shot data
    this.element = opts.element || "none";
    this.accent = opts.accent || null;  // element color, supplied by game.js
    this.energy = opts.energy || null;  // FX color (element OR bow energy)
    this.dmgMult = opts.dmgMult != null ? opts.dmgMult : 1;
    this.charge = opts.charge || 0;     // 0..1 draw charge at release
  }

  update(g, groundY) {
    this.life++;
    if (this.stuck) {
      this.deadTime++;
      if (this.stick) {
        const p = this.stick.ragdoll.point(this.stick.name);
        this.x = p.x + this.stick.ox;
        this.y = p.y + this.stick.oy;
      }
      return;
    }
    this.px = this.x; this.py = this.y;
    const gg = g * arrowGravMult(this.kind);
    this.vy += gg; this.x += this.vx; this.y += this.vy;
    this.angle = Math.atan2(this.vy, this.vx);
    if (this.kind === "knife") this.spin += this.spinV;
    if (this.kind === "bomb" && this.fuse > 0) {
      this.fuse--;
      if (this.fuse <= 0) this.explodeOnGround = true;
    }

    this.trail.push({ x: this.x, y: this.y });
    if (this.trail.length > 7) this.trail.shift();

    if (this.y >= groundY) {
      this.y = groundY;
      if (this.kind === "explosive" || this.kind === "bomb" || this.element === "blackhole") {
        this.explodeOnGround = true;          // game.js detonates / spawns the singularity
        this.stuck = true;                    // single trigger path (ground loop owns it)
      } else {
        this.stuck = true; this.deadTime = 0; // arrow/knife stick in the dirt
        if (typeof Sound !== "undefined") {
          const w = (typeof Game !== "undefined" && Game.env && Game.env.W) || 1280;
          Sound.play("thunk", { pan: clamp((this.x / w) * 2 - 1, -1, 1) });
        }
      }
    }
  }

  // Embed in the nearest joint of a freshly-created ragdoll so it flops along.
  stickToRagdoll(rd) {
    let best = null, bn = null, bd = 1e9;
    for (const n in rd.idx) {
      const p = rd.points[rd.idx[n]];
      const d = Math.hypot(p.x - this.x, p.y - this.y);
      if (d < bd) { bd = d; best = p; bn = n; }
    }
    if (best) this.stick = { ragdoll: rd, name: bn, ox: this.x - best.x, oy: this.y - best.y };
  }

  draw(ctx) {
    if (this.exploded) return;               // no stray sprite after a detonation
    const accent = this.accent;              // element color (null for plain)
    const fx = this.energy || this.accent;   // FX color (element OR bow energy)

    // motion trail — energy-tinted, thicker + brighter when charged
    if (!this.stuck && this.trail.length > 1) {
      const cw = 1 + this.charge * 1.4;
      for (let i = 1; i < this.trail.length; i++) {
        const t = i / this.trail.length;
        ctx.strokeStyle = fx ? rgbaHex(fx, (0.08 + t * 0.34) * (0.6 + this.charge))
          : (this.owner === "player" ? "rgba(80,130,210," + (0.05 + t * 0.2) + ")" : "rgba(200,80,80," + (0.05 + t * 0.2) + ")");
        ctx.lineWidth = (0.5 + t * 2.2) * cw;
        ctx.beginPath();
        ctx.moveTo(this.trail[i - 1].x, this.trail[i - 1].y);
        ctx.lineTo(this.trail[i].x, this.trail[i].y);
        ctx.stroke();
      }
    }

    ctx.save();
    ctx.translate(this.x, this.y);

    // charge / element aura around the projectile in flight
    if (!this.stuck && (this.charge > 0.05 || fx)) {
      const aur = fx || "#ffd24a";
      const base = 4 + this.charge * 9;
      for (let i = 2; i >= 1; i--) {
        ctx.globalAlpha = (fx ? 0.22 : 0.14) * i * (0.4 + this.charge * 1.1);
        ctx.fillStyle = aur;
        ctx.beginPath(); ctx.arc(0, 0, base * i * 0.7, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (this.kind === "knife") {
      ctx.rotate(this.stuck ? this.angle : this.spin);
      ctx.fillStyle = "#33333a"; ctx.fillRect(-3, -2.4, 6, 4.8);          // grip
      ctx.fillStyle = "#e7ebf0";
      ctx.beginPath(); ctx.moveTo(3, -3); ctx.lineTo(16, 0); ctx.lineTo(3, 3); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "#9aa1ab"; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(3, 0); ctx.lineTo(15, 0); ctx.stroke();
      ctx.restore();
      return;
    }

    if (this.kind === "explosive" || this.kind === "bomb") {
      // iron bomb arrow
      ctx.rotate(this.angle || 0);
      ctx.strokeStyle = "#3a2c1c"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = "#4a4a52";
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, -4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, 4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      const r = 6;
      ctx.fillStyle = "#26262b"; ctx.beginPath(); ctx.arc(3, 0, r, 0, TAU); ctx.fill();
      ctx.fillStyle = "#474750"; ctx.beginPath(); ctx.arc(1.5, -1.6, r * 0.55, 0, TAU); ctx.fill();
      ctx.strokeStyle = "#6a6a72"; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(3, -r); ctx.lineTo(3, r); ctx.stroke();
      ctx.fillStyle = "#8a8a92"; ctx.beginPath(); ctx.moveTo(r + 9, 0); ctx.lineTo(r - 1, -3.2); ctx.lineTo(r - 1, 3.2); ctx.closePath(); ctx.fill(); // spike
      const sp = (this.life % 10 < 5) ? 1 : 0.45;          // fuse spark
      ctx.globalAlpha = sp; ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(-2, -5, 2.2, 0, TAU); ctx.fill();
      ctx.fillStyle = "#ff7a2a"; ctx.beginPath(); ctx.arc(-2, -5, 1.1, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    ctx.rotate(this.angle || 0);

    if (this.element === "blackhole") {
      ctx.strokeStyle = "#2a2233"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.fillStyle = "#3a2a4a";
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, -4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, 4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#2a2233";                          // barbed head
      ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-3, -5); ctx.lineTo(1, 0); ctx.lineTo(-3, 5); ctx.closePath(); ctx.fill();
      const rot = this.life * 0.3;                          // purple swirl ring
      ctx.strokeStyle = "#b06bff"; ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.55 * (1 - i / 3); ctx.beginPath(); ctx.arc(4, 0, 5 + i * 3, rot + i, rot + i + 4); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#0a0710"; ctx.beginPath(); ctx.arc(4, 0, 3.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(200,150,255,.7)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(4, 0, 3.2, 0, TAU); ctx.stroke();
      ctx.restore();
      return;
    }

    // arrow — wood shaft, element-tinted head/fletching, then element FX overlay
    const headLen = 1 + this.charge * 0.4;
    const fletch = accent ? accent : (this.owner === "player" ? "#2f6fd0" : "#cf3b3b");
    const tip = accent || "#33333a";
    if (this.element && this.element !== "none" && !this.stuck) drawElementFX(ctx, this.element, this.life, this.charge);
    ctx.strokeStyle = "#5e4628"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(0, 0); ctx.stroke();
    ctx.fillStyle = fletch;
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, -4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(-15, 4); ctx.lineTo(-11, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = tip;
    ctx.beginPath(); ctx.moveTo(2 * headLen, 0); ctx.lineTo(-7, -4.2 * headLen); ctx.lineTo(-7, 4.2 * headLen); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = accent ? "#ffffff" : "#c9cdd4"; ctx.lineWidth = 0.9; ctx.globalAlpha = accent ? 0.7 : 1;
    ctx.beginPath(); ctx.moveTo(2 * headLen, 0); ctx.lineTo(-7, 0); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.restore();
  }
}

// Element FX drawn in the arrow's local space (tip at +x, shaft toward -x).
function drawElementFX(ctx, element, life, charge) {
  const t = life || 0;
  if (element === "fire") {
    const wob = Math.sin(t * 0.6);
    const layers = [["#ff2a00", 0.32, 1.0], ["#ff7a1a", 0.5, 0.7], ["#ffd24a", 0.75, 0.42]];
    for (let i = 0; i < layers.length; i++) {
      ctx.globalAlpha = layers[i][1]; ctx.fillStyle = layers[i][0]; const s = layers[i][2];
      ctx.beginPath(); ctx.moveTo(8, 0);
      ctx.quadraticCurveTo(-6, (5 + 2 * wob) * s * 2.4, -26 - 6 * s, wob * 2);
      ctx.quadraticCurveTo(-6, -(5 - 2 * wob) * s * 2.4, 8, 0);
      ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 0.85; ctx.fillStyle = "#ffd24a";
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-10 - i * 5 + wob * 2, Math.sin(t * 0.7 + i) * 3, 1.2, 0, TAU); ctx.fill(); }
    ctx.globalAlpha = 1;
  } else if (element === "ice") {
    ctx.fillStyle = "#bfe6ff"; ctx.strokeStyle = "#eaf6ff"; ctx.lineWidth = 0.8;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-2, -5.5); ctx.lineTo(-9, 0); ctx.lineTo(-2, 5.5); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 0.7; ctx.strokeStyle = "#dff2ff";
    for (let i = 0; i < 3; i++) { const x = -6 - i * 5; ctx.beginPath(); ctx.moveTo(x, -3); ctx.lineTo(x - 2, -6); ctx.moveTo(x, 3); ctx.lineTo(x - 2, 6); ctx.stroke(); }
    ctx.fillStyle = "#ffffff"; for (let i = 0; i < 3; i++) ctx.fillRect(-4 - i * 6, Math.sin(t * 0.5 + i * 2) * 4, 1.3, 1.3);
    ctx.globalAlpha = 1;
  } else if (element === "poison") {
    ctx.fillStyle = "rgba(120,210,60,.5)"; ctx.beginPath(); ctx.ellipse(-6, 0, 13, 4.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#9be24a";
    for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(-4 - i * 6, Math.sin(t * 0.4 + i) * 2 + (i % 2 ? 3 : -3), 1.7, 0, TAU); ctx.fill(); }
    ctx.fillStyle = "rgba(120,210,60,.7)"; ctx.beginPath(); ctx.arc(-2, 4 + (t % 18) / 18 * 3, 1.4, 0, TAU); ctx.fill();
  } else if (element === "air") {
    ctx.strokeStyle = "rgba(220,232,255,.7)"; ctx.lineWidth = 1.4;
    for (let i = 0; i < 3; i++) { const ph = t * 0.3 + i * 2; ctx.beginPath(); ctx.arc(-8 - i * 4, Math.sin(ph) * 3, 4, 0.2, Math.PI * 1.6); ctx.stroke(); }
  }
}
