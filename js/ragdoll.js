// ---------------------------------------------------------------------------
// ragdoll.js — Verlet-integrated stick-figure ragdoll.
// Built from a living skeleton at the moment of death, then simulated with
// gravity + distance constraints so the body flops and slides realistically.
// ---------------------------------------------------------------------------
"use strict";

class Ragdoll {
  constructor(skel, color) {
    this.color = color || "#1c1c22";
    this.outline = shade(this.color, -0.45);
    this.scale = skel.scale || 1;
    this.headR = skel.headR;
    this.idx = {};          // name -> index into points
    this.points = [];       // { x, y, ox, oy, pin }
    this.cons = [];         // { a, b, len, st }

    const P = (name, p) => {
      this.idx[name] = this.points.length;
      this.points.push({ x: p.x, y: p.y, ox: p.x, oy: p.y, pin: false });
    };
    P("head", skel.head);   P("chest", skel.chest);   P("pelvis", skel.pelvis);
    P("elbowF", skel.elbowF); P("handF", skel.bowHand);
    P("elbowB", skel.elbowB); P("handB", skel.drawHand);
    P("kneeF", skel.kneeF); P("footF", skel.footF);
    P("kneeB", skel.kneeB); P("footB", skel.footB);

    const L = (a, b, st) => {
      const A = this.points[this.idx[a]], B = this.points[this.idx[b]];
      this.cons.push({ a: this.idx[a], b: this.idx[b], len: Math.hypot(A.x - B.x, A.y - B.y), st: st == null ? 1 : st });
    };
    L("head", "chest");   L("chest", "pelvis");
    L("chest", "elbowF"); L("elbowF", "handF");
    L("chest", "elbowB"); L("elbowB", "handB");
    L("pelvis", "kneeF"); L("kneeF", "footF");
    L("pelvis", "kneeB"); L("kneeB", "footB");
    L("head", "pelvis", 0.18); // loose spine rigidity so it doesn't fully collapse
  }

  point(name) { return this.points[this.idx[name]]; }

  // Add velocity to one joint (Verlet velocity = pos - oldpos).
  impulse(name, vx, vy) {
    const p = this.points[this.idx[name]];
    p.ox -= vx; p.oy -= vy;
  }
  impulseAll(vx, vy) {
    for (const p of this.points) { p.ox -= vx; p.oy -= vy; }
  }

  update(env) {
    const g = env.g, gy = env.groundY, W = env.W;
    for (const p of this.points) {
      if (p.pin) continue;
      const vx = (p.x - p.ox) * 0.99;
      const vy = (p.y - p.oy) * 0.99;
      p.ox = p.x; p.oy = p.y;
      p.x += vx; p.y += vy + g;
      if (p.y > gy) { p.y = gy; p.ox = p.x - vx * 0.5; p.oy = p.y; } // ground + friction
      if (p.x < 4) { p.x = 4; p.ox = 4; }
      if (p.x > W - 4) { p.x = W - 4; p.ox = W - 4; }
    }
    for (let it = 0; it < 6; it++) {
      for (const c of this.cons) {
        const A = this.points[c.a], B = this.points[c.b];
        let dx = B.x - A.x, dy = B.y - A.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = ((d - c.len) / d) * 0.5 * c.st;
        dx *= diff; dy *= diff;
        A.x += dx; A.y += dy;
        B.x -= dx; B.y -= dy;
      }
    }
  }

  // Draw the corpse with the SAME flat solid-black look as the living figure,
  // so a body reads as the same silhouette when it flops. Reuses the global
  // v_fillCapsule defined in stickman.js (available at draw time, after all
  // scripts have loaded).
  draw(ctx) {
    const s = {};
    for (const k in this.idx) s[k] = this.points[this.idx[k]];
    const sc = this.scale, col = this.color;
    ctx.lineCap = "round"; ctx.lineJoin = "round";

    // limb radii @ scale1 (mirror drawArcher's build for a matching shape)
    const R = {
      thighA: 7.5, thighB: 5.8, shinA: 5.6, shinB: 3.4,
      upArmA: 6.0, upArmB: 4.4, foreA: 4.4, foreB: 3.0,
      torsoA: 10.0, torsoB: 6.2, neck: 6.0
    };
    for (const k in R) R[k] *= sc;
    const disc = (p, r) => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); };
    // ragdoll arms hang off the chest (no separate shoulder); the neck spans
    // partway from the chest up into the base of the head.
    const headBase = { x: s.chest.x + (s.head.x - s.chest.x) * 0.55, y: s.chest.y + (s.head.y - s.chest.y) * 0.55 };

    // ---- flat solid-black silhouette (one connected mass) ----
    ctx.fillStyle = col;
    v_fillCapsule(ctx, s.pelvis, s.kneeB, R.thighA, R.thighB, col);
    v_fillCapsule(ctx, s.kneeB, s.footB, R.shinA, R.shinB, col);
    v_fillCapsule(ctx, s.pelvis, s.kneeF, R.thighA, R.thighB, col);
    v_fillCapsule(ctx, s.kneeF, s.footF, R.shinA, R.shinB, col);
    disc(s.kneeB, R.shinA); disc(s.kneeF, R.shinA); disc(s.pelvis, R.thighA);
    v_fillCapsule(ctx, s.chest, s.pelvis, R.torsoA, R.torsoB, col);
    v_fillCapsule(ctx, headBase, s.head, R.neck, R.neck * 0.85, col);
    v_fillCapsule(ctx, s.chest, s.elbowB, R.upArmA, R.upArmB, col);
    v_fillCapsule(ctx, s.elbowB, s.handB, R.foreA, R.foreB, col);
    disc(s.elbowB, R.foreA);
    v_fillCapsule(ctx, s.chest, s.elbowF, R.upArmA, R.upArmB, col);
    v_fillCapsule(ctx, s.elbowF, s.handF, R.foreA, R.foreB, col);
    disc(s.elbowF, R.foreA);
    disc(s.head, this.headR);

    // dead "X" eyes
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * sc;
    const h = s.head, r = this.headR * 0.45;
    ctx.beginPath();
    ctx.moveTo(h.x - r, h.y - r); ctx.lineTo(h.x - r * 0.2, h.y - r * 0.2);
    ctx.moveTo(h.x - r * 0.2, h.y - r); ctx.lineTo(h.x - r, h.y - r * 0.2);
    ctx.stroke();
  }
}
