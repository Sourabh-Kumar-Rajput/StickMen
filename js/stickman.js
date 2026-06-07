// ---------------------------------------------------------------------------
// stickman.js — the living stick figure: pose math, shaded drawing, hitboxes.
// computeSkeleton() returns named joint positions used for BOTH rendering and
// collision, so what you see is exactly what you can hit. An optional uniform
// `scale` (opt.scale, default 1) sizes up the boss without breaking parity.
// ---------------------------------------------------------------------------
"use strict";

// Body proportions (pixels, at scale 1)
const SK = { LEG: 52, TORSO: 46, HEAD_R: 12, NECK: 8 };

// x,y are the feet anchor (feet sit on groundY). facing: +1 right, -1 left.
// aim: world angle of the bow arm (radians, y-down). opt: { draw, walk, run, lean, scale }
function computeSkeleton(x, groundY, facing, aim, opt) {
  opt = opt || {};
  const sc = opt.scale || 1;
  const lean = opt.lean || 0;        // 0..1 backward lean while drawing
  const walk = opt.walk || 0;        // walk-cycle phase (0 = standing)
  const run = opt.run ? 1 : 0;       // 1 = running gait (longer steps, lean, pump)
  const moving = walk !== 0;
  const reach = ARM_LEN * sc;

  // --- Gait (the reference walk cycle): the two legs swing fore/aft in
  // opposite phase; the swinging foot lifts off the ground (peaking as it
  // passes under the hips — the "high point") while the planted foot drives
  // back; and the hips bob down at the spread contact poses, twice per stride.
  const stride = Math.sin(walk) * (11 + run * 8) * sc;
  const liftPix = (run ? 16 : 9) * sc;
  const liftF = moving ? Math.max(0, Math.cos(walk)) * liftPix : 0;
  const liftB = moving ? Math.max(0, -Math.cos(walk)) * liftPix : 0;
  const bob = moving ? Math.abs(Math.sin(walk)) * (run ? 5 : 3) * sc : 0;

  // lean back while drawing the bow; lean forward into a run
  const leanX = -facing * lean * 7 * sc + facing * run * 6 * sc;

  const hipY = groundY - SK.LEG * sc + bob;
  const pelvis = { x: x, y: hipY };
  const chest = { x: x + leanX, y: hipY - SK.TORSO * sc };
  const shoulder = { x: chest.x, y: chest.y + 6 * sc };
  const head = { x: chest.x + facing * 2 * sc + leanX * 0.4, y: chest.y - (SK.NECK + SK.HEAD_R) * sc };

  // Front (bow) arm reaches along the aim direction.
  const bowHand = { x: shoulder.x + Math.cos(aim) * reach, y: shoulder.y + Math.sin(aim) * reach };
  const elbowF = { x: shoulder.x + Math.cos(aim) * reach * 0.5 - facing * 2 * sc, y: shoulder.y + Math.sin(aim) * reach * 0.5 + 4 * sc };

  // Back (draw) hand pulls back near the face when drawing; otherwise it pumps
  // fore/aft with the stride so a moving figure swings its free arm.
  const pull = (opt.draw ? 14 : 6) * sc;
  const armSwing = (moving && !opt.draw) ? Math.sin(walk) * (run ? 9 : 5) * sc : 0;
  const drawHand = { x: shoulder.x - Math.cos(aim) * pull + facing * armSwing, y: shoulder.y - Math.sin(aim) * pull };
  const elbowB = { x: (shoulder.x + drawHand.x) / 2, y: (shoulder.y + drawHand.y) / 2 - 6 * sc };

  // Legs: planted stance, or the walk/run cycle when moving. The swinging foot
  // lifts and its knee bends forward (the high-knee pose); the planted foot
  // keeps contact with the ground.
  const footF = { x: x + facing * 14 * sc + stride, y: groundY - liftF };
  const footB = { x: x - facing * 12 * sc - stride, y: groundY - liftB };
  const kneeF = { x: (pelvis.x + footF.x) / 2 + facing * (4 * sc + liftF * 0.5), y: (pelvis.y + footF.y) / 2 - liftF * 0.22 };
  const kneeB = { x: (pelvis.x + footB.x) / 2 - facing * (2 * sc - liftB * 0.5), y: (pelvis.y + footB.y) / 2 - liftB * 0.22 };

  return {
    pelvis, chest, shoulder, head, headR: SK.HEAD_R * sc,
    bowHand, elbowF, drawHand, elbowB, footF, footB, kneeF, kneeB,
    aim, facing, scale: sc, armLen: reach
  };
}

// Hittable segments. Head is a zero-length segment (a circle) of radius headR.
function archerHitSegments(s) {
  const sc = s.scale || 1;
  return [
    { ax: s.head.x, ay: s.head.y, bx: s.head.x, by: s.head.y, r: s.headR, part: "head" },
    { ax: s.chest.x, ay: s.chest.y, bx: s.pelvis.x, by: s.pelvis.y, r: 9 * sc, part: "torso" },
    { ax: s.shoulder.x, ay: s.shoulder.y, bx: s.bowHand.x, by: s.bowHand.y, r: 6 * sc, part: "limb" },
    { ax: s.shoulder.x, ay: s.shoulder.y, bx: s.drawHand.x, by: s.drawHand.y, r: 6 * sc, part: "limb" },
    { ax: s.pelvis.x, ay: s.pelvis.y, bx: s.footF.x, by: s.footF.y, r: 6 * sc, part: "limb" },
    { ax: s.pelvis.x, ay: s.pelvis.y, bx: s.footB.x, by: s.footB.y, r: 6 * sc, part: "limb" }
  ];
}

// ===========================================================================
// VOLUMETRIC SILHOUETTE rendering. Each limb/torso is a FILLED tapered capsule
// that merges into ONE continuous dark silhouette, then shaded with a bright
// rim on the UPPER-LEFT and a deep core shadow on the LOWER-RIGHT so every
// form reads as a rounded 3D solid lit from the upper-left. The hero element
// is a big, clean recurve bow (tall limbs, recurved tips, crisp string).
// Shading uses only stacked solid fills + alpha (no gradients/shadowBlur), so
// it stays mobile-safe and renders identically in the offline rasterizer.
// ===========================================================================

// ---- low-level: a filled tapered capsule between joints a,b -----------------
// Builds the outline of a "fat near a, thin near b" rounded bar as a polygon
// and fills it with `col`. Returns the geometry so callers can re-shade it.
function v_capsuleGeom(a, b, ra, rb) {
  let dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy) || 1;
  dx /= L; dy /= L;
  const nx = -dy, ny = dx;                       // unit normal
  return { ax: a.x, ay: a.y, bx: b.x, by: b.y, dx: dx, dy: dy, nx: nx, ny: ny, ra: ra, rb: rb, L: L };
}

function v_capsulePath(ctx, g) {
  const { ax, ay, bx, by, nx, ny, ra, rb } = g;
  // one side, round cap at b, other side, round cap at a
  ctx.beginPath();
  ctx.moveTo(ax + nx * ra, ay + ny * ra);
  ctx.lineTo(bx + nx * rb, by + ny * rb);
  // cap around b (semi-circle from +n through +dir to -n)
  ctx.arc(bx, by, rb, Math.atan2(ny, nx), Math.atan2(-ny, -nx), false);
  ctx.lineTo(ax - nx * ra, ay - ny * ra);
  // cap around a (semi-circle back to +n)
  ctx.arc(ax, ay, ra, Math.atan2(-ny, -nx), Math.atan2(ny, nx), false);
  ctx.closePath();
}

// Fill a tapered capsule as a solid (the silhouette base).
function v_fillCapsule(ctx, a, b, ra, rb, col) {
  const g = v_capsuleGeom(a, b, ra, rb);
  ctx.fillStyle = col;
  v_capsulePath(ctx, g);
  ctx.fill();
  return g;
}

// sample a quadratic bezier into out[] (inclusive endpoints)
function v_quadSample(p0, c, p1, n, out) {
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({
      x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
      y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y
    });
  }
}

// ---------------------------------------------------------------------------
// drawArcher — flat solid-black silhouette (The Archers 2 look). The body is
// built from filled capsules/discs on the skeleton joints (so the drawing
// matches the hitboxes) and filled in one flat color, no shading. The bow keeps
// its own wooden coloring.
// opt: { color, outline?, weapon?:'bow'|'knife'|'none', bow?(legacy), draw?,
//        charge?, accent?, glow?, bowColor?, bowGlow?, bowTip?, bowGem?,
//        bowEnergy?, bowArt?, bowShape? }
// ---------------------------------------------------------------------------
function drawArcher(ctx, s, opt) {
  opt = opt || {};
  const sc = s.scale || 1;
  const col = opt.color || "#1c1c22";
  const weapon = opt.weapon || (opt.bow ? "bow" : "none");
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  // ---- soft ground contact shadow (grounds the figure) ----
  const shY = Math.max(s.footF.y, s.footB.y) + 1.5 * sc;
  const shX = (s.footF.x + s.footB.x) / 2;
  const shW = (Math.abs(s.footF.x - s.footB.x) * 0.6 + 18 * sc);
  for (let i = 2; i >= 1; i--) {
    ctx.globalAlpha = 0.10 * i;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.ellipse(shX, shY, shW * (0.55 + i * 0.18), 3.2 * sc * i, 0, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Anchor points (all from the skeleton so hitboxes still match).
  const pel = s.pelvis, chest = s.chest, sh = s.shoulder, head = s.head;
  // neck spans from inside the shoulders up into the base of the head.
  const neckBot = { x: sh.x + (head.x - sh.x) * 0.18, y: sh.y - 2 * sc };
  const neckTop = { x: head.x, y: head.y + s.headR * 0.7 };

  // Limb radii (pixels @ scale1): broad shoulders, narrow waist, tapered limbs.
  const R = {
    thighA: 7.5, thighB: 5.8, shinA: 5.6, shinB: 3.4,
    upArmA: 6.0, upArmB: 4.4, foreA: 4.4, foreB: 3.0, neck: 6.2
  };
  for (const k in R) R[k] *= sc;
  const disc = (p, r) => { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, TAU); ctx.fill(); };

  // ---- flat solid-black silhouette (The Archers 2 look): one clean fill, no
  // gradients/shading — just a crisp, cohesive black body. ----
  ctx.fillStyle = col;
  // legs (back then front) + knee/hip discs so the joints stay solid when bent
  v_fillCapsule(ctx, pel, s.kneeB, R.thighA, R.thighB, col);
  v_fillCapsule(ctx, s.kneeB, s.footB, R.shinA, R.shinB, col);
  v_fillCapsule(ctx, pel, s.kneeF, R.thighA, R.thighB, col);
  v_fillCapsule(ctx, s.kneeF, s.footF, R.shinA, R.shinB, col);
  disc(s.kneeB, R.shinA); disc(s.kneeF, R.shinA); disc(pel, R.thighA);

  // torso: a tapered slab (broad shoulders -> narrow waist)
  (function torso() {
    const hw = 10.5 * sc, wW = 6.2 * sc;
    let dx = chest.x - pel.x, dy = chest.y - pel.y; const L = Math.hypot(dx, dy) || 1; dx /= L; dy /= L;
    const nx = -dy, ny = dx; const topx = sh.x, topy = sh.y - 1 * sc;
    ctx.beginPath();
    ctx.moveTo(topx + nx * hw, topy + ny * hw);
    ctx.quadraticCurveTo(pel.x + nx * wW + dx * -2 * sc, pel.y + ny * wW + dy * -2 * sc, pel.x + nx * wW, pel.y + ny * wW);
    ctx.lineTo(pel.x - nx * wW, pel.y - ny * wW);
    ctx.quadraticCurveTo(pel.x - nx * wW + dx * -2 * sc, pel.y - ny * wW + dy * -2 * sc, topx - nx * hw, topy - ny * hw);
    ctx.quadraticCurveTo(topx - dx * hw * 0.9, topy - dy * hw * 0.9, topx + nx * hw, topy + ny * hw);
    ctx.closePath(); ctx.fill();
  })();
  // neck
  v_fillCapsule(ctx, neckBot, neckTop, R.neck, R.neck * 0.85, col);
  // arms (back under, front over) + elbow discs
  v_fillCapsule(ctx, sh, s.elbowB, R.upArmA, R.upArmB, col);
  v_fillCapsule(ctx, s.elbowB, s.drawHand, R.foreA, R.foreB, col);
  disc(s.elbowB, R.foreA);
  v_fillCapsule(ctx, sh, s.elbowF, R.upArmA, R.upArmB, col);
  v_fillCapsule(ctx, s.elbowF, s.bowHand, R.foreA, R.foreB, col);
  disc(s.elbowF, R.foreA);
  // head (solid circle)
  disc(head, s.headR);

  // weapon
  if (weapon === "bow") {
    const bowStyle = {
      color: opt.bowColor, glow: opt.bowGlow, tip: opt.bowTip, gem: opt.bowGem,
      energy: opt.bowEnergy, art: opt.bowArt, t: opt.t || 0
    };
    if (opt.bowShape) Object.assign(bowStyle, opt.bowShape);  // optional shape overrides
    drawBow(ctx, s, opt.draw, opt.charge || 0, opt.accent, bowStyle);
  } else if (weapon === "knife") {
    drawKnife(ctx, s);
  }

  // hands: small solid knobs so limbs end cleanly
  ctx.fillStyle = col; disc(s.bowHand, R.foreB); if (!opt.draw) disc(s.drawHand, R.foreB);

  if (opt.glow) drawHandGlow(ctx, s.bowHand.x, s.bowHand.y, opt.glow, opt.accent || "#ffd24a");
}

// ---------------------------------------------------------------------------
// drawBow — a BIG clean recurve bow with 3D-shaded wooden limbs.
// Tall limbs (~torso height), belly toward the archer, recurved tips, a
// defined riser/grip at the hand, and a crisp string tip-to-tip (pulled to a
// sharp point at the draw hand when drawing).
// charge (0..1) deepens the limb flex + string pull; accent tints the arrow.
// style: { color, glow, tip, gem, grip, wrap, art } — per-tier bow look.
// ---------------------------------------------------------------------------
function drawBow(ctx, s, drawing, charge, accent, style) {
  const sc = s.scale || 1;
  charge = charge || 0;
  style = style || {};
  const a = s.aim;
  const bx = s.bowHand.x, by = s.bowHand.y;

  // axes: forward = toward target (aim); perp = along the bow's length
  const fx = Math.cos(a), fy = Math.sin(a);
  const px = Math.cos(a + Math.PI / 2), py = Math.sin(a + Math.PI / 2);

  const eCol = accent || style.energy || style.tip || "#ffd24a";

  // ---- dragon branch: the shipping ornate path, scaled up to out-size the
  // wooden recurve so the top tier reads as a true upgrade (taller limbs +
  // thicker scaled body) ----
  if (style.art === "dragon") {
    const half = 34 * sc + charge * 2 * sc;
    const t1 = { x: bx + px * half, y: by + py * half };
    const t2 = { x: bx - px * half, y: by - py * half };
    const spr = (typeof BowSprites !== "undefined") ? BowSprites.get("dragon") : null;
    const flex = (15 + charge * 8) * sc;
    const bow = { x: bx + fx * flex, y: by + fy * flex };
    const mf = (3 + charge * 4) * sc;
    const m1 = { x: (t1.x + bow.x) / 2 + px * mf, y: (t1.y + bow.y) / 2 + py * mf };
    const m2 = { x: (t2.x + bow.x) / 2 - px * mf, y: (t2.y + bow.y) / 2 - py * mf };
    if (style.glow || charge > 0.02) {
      ctx.strokeStyle = style.glow || eCol; ctx.globalAlpha = Math.min(0.5, 0.18 + charge * 0.4);
      ctx.lineWidth = (3.5 + charge * 4) * sc;
      ctx.beginPath(); ctx.moveTo(t1.x, t1.y); ctx.quadraticCurveTo(m1.x, m1.y, bow.x, bow.y);
      ctx.quadraticCurveTo(m2.x, m2.y, t2.x, t2.y); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (spr) {
      drawBowSprite(ctx, spr, bx, by, half, a);
    } else {
      const dpts = [];
      sampleQuad(t1, m1, bow, 8, dpts); dpts.pop();
      sampleQuad(bow, m2, t2, 8, dpts);
      drawDragonBow(ctx, dpts, 1.55 * sc, { x: fx, y: fy });
    }
    v_bowString(ctx, s, t1, t2, drawing, charge, sc, a, fx, fy, eCol, style);
    return;
  }

  // ===== STANDARD WOODEN RECURVE (the redesign) =====
  // Bow length: TALL — each limb reaches ~torso height above & below the hand,
  // so the whole bow spans roughly the figure's torso. The stave is one smooth
  // C-curve whose BELLY bulges toward the archer; the very tips RECURVE forward
  // (curl back toward the target).
  // Shape knobs (optional per-bow overrides; defaults = a deep recurve bow).
  const span = style.span != null ? style.span : 42;     // half-height of the bow
  const bellyK = style.belly != null ? style.belly : 18; // how far limbs arc toward target
  const recurveK = style.recurve != null ? style.recurve : 11; // tip curl length
  const rTip = style.rTip != null ? style.rTip : 1.6;    // stave half-width at the tips
  const rGrip = style.rGrip != null ? style.rGrip : 4.4; // stave half-width at the grip
  const half = span * sc + charge * 2 * sc;      // half-height of the bow (tall)
  const belly = (bellyK + charge * 3) * sc;      // how far the limbs arc toward target
  // The bow's BACK (convex) faces the target, so the limbs arc FORWARD; the
  // archer-facing side is the concave BELLY where the string seats. The very
  // tips RECURVE back toward the archer/string.
  const archerDir = -1;                           // sign toward the archer (away from target)

  // grip center sits at the hand.
  const gc = { x: bx, y: by };

  // Each limb is ONE quadratic from the grip out to the tip; the control point
  // is pushed FORWARD (toward target) at ~mid-limb so the limb arcs smoothly.
  const upTip = { x: gc.x + px * half + fx * archerDir * belly * 0.25, y: gc.y + py * half + fy * archerDir * belly * 0.25 };
  const loTip = { x: gc.x - px * half + fx * archerDir * belly * 0.25, y: gc.y - py * half + fy * archerDir * belly * 0.25 };
  const upMid = {
    x: gc.x + px * half * 0.5 + fx * belly,
    y: gc.y + py * half * 0.5 + fy * belly
  };
  const loMid = {
    x: gc.x - px * half * 0.5 + fx * belly,
    y: gc.y - py * half * 0.5 + fy * belly
  };
  // recurve nocks: the very ends curl BACK toward the archer (toward the string).
  const recurve = (recurveK + charge * 1.5) * sc;
  const upNock = { x: upTip.x + fx * archerDir * recurve + px * 1 * sc, y: upTip.y + fy * archerDir * recurve + py * 1 * sc };
  const loNock = { x: loTip.x + fx * archerDir * recurve - px * 1 * sc, y: loTip.y + fy * archerDir * recurve - py * 1 * sc };

  const wood = style.color || "#6e4d2b";
  const woodDk = shade(wood, -0.62);
  const woodCore = shade(wood, -0.30);
  const woodHi = shade(wood, 0.26);

  // Sample the full stave into points (upper nock .. grip .. lower nock) so we
  // can draw it as a filled, tapered, shaded ribbon (a 3D limb, not a thin tube).
  // Recurve tips are an extra short bezier curling forward.
  const pts = [];
  // upper recurve tip -> upper tip (short curl back toward the archer)
  v_quadSample(upNock, { x: upTip.x + fx * archerDir * recurve * 0.5, y: upTip.y + fy * archerDir * recurve * 0.5 }, upTip, 4, pts);
  pts.pop();
  v_quadSample(upTip, upMid, gc, 9, pts);          // upper limb -> grip
  pts.pop();
  v_quadSample(gc, loMid, loTip, 9, pts);          // grip -> lower limb
  pts.pop();
  v_quadSample(loTip, { x: loTip.x + fx * archerDir * recurve * 0.5, y: loTip.y + fy * archerDir * recurve * 0.5 }, loNock, 4, pts);

  // taper: thick at the grip, thin at the tips. Find the grip index (closest
  // sampled point to gc) so the taper peaks exactly at the handle.
  const N = pts.length, last = N - 1;
  let mid = 0, bestD = 1e9;
  for (let i = 0; i < N; i++) { const d = (pts[i].x - gc.x) ** 2 + (pts[i].y - gc.y) ** 2; if (d < bestD) { bestD = d; mid = i; } }
  function rad(i) {
    const t = i <= mid ? (mid ? i / mid : 1) : (last > mid ? 1 - (i - mid) / (last - mid) : 1);
    // t: 0 at tips, 1 at grip. Smooth + slightly biased so limbs stay solid.
    const center = Math.pow(t, 0.7);
    return (rTip + (rGrip - rTip) * center) * sc;   // slim tips -> thicker grip
  }

  // ---- soft energy glow hugging the limbs (tier glow + charge) ----
  if (style.glow || charge > 0.02) {
    ctx.strokeStyle = style.glow || eCol;
    ctx.globalAlpha = Math.min(0.5, 0.16 + charge * 0.4);
    ctx.lineWidth = (3.5 + charge * 4) * sc;
    ctx.beginPath();
    for (let i = 0; i < N; i++) { if (i === 0) ctx.moveTo(pts[i].x, pts[i].y); else ctx.lineTo(pts[i].x, pts[i].y); }
    ctx.stroke(); ctx.globalAlpha = 1;
  }

  // per-point outward normal (toward target = belly is back, so outer edge is forward)
  const nrm = [];
  for (let i = 0; i < N; i++) {
    const A = pts[Math.max(0, i - 1)], B = pts[Math.min(last, i + 1)];
    let tx = B.x - A.x, ty = B.y - A.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    let nx = -ty, ny = tx;
    // make +normal point toward the target (forward) so we know belly/back sides
    if (nx * fx + ny * fy < 0) { nx = -nx; ny = -ny; }
    nrm.push({ nx, ny, tx, ty });
  }

  // ---- filled stave ribbon: dark outline, wood body, core shadow, rim light ----
  function ribbon(scaleR, offN, col, alpha) {
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillStyle = col;
    ctx.beginPath();
    // one edge (+normal*r)
    for (let i = 0; i < N; i++) {
      const r = rad(i) * scaleR;
      const x = pts[i].x + nrm[i].nx * (r + offN), y = pts[i].y + nrm[i].ny * (r + offN);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    // back along the other edge
    for (let i = last; i >= 0; i--) {
      const r = rad(i) * scaleR;
      const x = pts[i].x - nrm[i].nx * (r - offN), y = pts[i].y - nrm[i].ny * (r - offN);
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // light from upper-left; for the bow, the lit edge is the back (toward archer)
  // upper-left in screen space; determine which stave edge faces upper-left:
  const lit = { x: 0.6, y: 0.8 };
  // dark outline (full)
  ribbon(1.4, 0, woodDk);
  // wood body
  ribbon(1.0, 0, wood);
  // core shadow on the lower-right facing edge: shift toward +/-normal by lit
  // We push a darker ribbon toward the lower-right side.
  (function staveShade() {
    // For each point decide shadow offset sign so shadow lands lower-right.
    ctx.fillStyle = woodCore; ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const r = rad(i);
      const sgn = (nrm[i].nx * lit.x + nrm[i].ny * lit.y) >= 0 ? 1 : -1; // toward lower-right
      const x = pts[i].x + nrm[i].nx * sgn * r, y = pts[i].y + nrm[i].ny * sgn * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    for (let i = last; i >= 0; i--) {
      const r = rad(i);
      const sgn = (nrm[i].nx * lit.x + nrm[i].ny * lit.y) >= 0 ? 1 : -1;
      const x = pts[i].x + nrm[i].nx * sgn * r * 0.15, y = pts[i].y + nrm[i].ny * sgn * r * 0.15;
      ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
  })();
  // bright rim light on the upper-left edge (thin)
  (function staveRim() {
    ctx.strokeStyle = woodHi; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.8 * sc; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const r = rad(i);
      const sgn = (nrm[i].nx * lit.x + nrm[i].ny * lit.y) >= 0 ? -1 : 1; // upper-left
      const x = pts[i].x + nrm[i].nx * sgn * r * 0.74, y = pts[i].y + nrm[i].ny * sgn * r * 0.74;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  })();
  // crisp dark edge along the BACK (outer/target side) so the bow reads as a
  // polished solid against the body — defines the hero silhouette.
  (function staveBackEdge() {
    ctx.strokeStyle = woodDk; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.9 * sc; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const r = rad(i);
      const x = pts[i].x + nrm[i].nx * r * 0.92, y = pts[i].y + nrm[i].ny * r * 0.92; // +normal = toward target
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  })();

  // ---- small dark nock caps at the recurved tips ----
  ctx.fillStyle = woodDk;
  [upNock, loNock].forEach(function (t) { ctx.beginPath(); ctx.arc(t.x, t.y, 1.7 * sc, 0, TAU); ctx.fill(); });
  if (style.tip) {
    ctx.fillStyle = style.tip;
    [upNock, loNock].forEach(function (t) { ctx.beginPath(); ctx.arc(t.x, t.y, 0.85 * sc, 0, TAU); ctx.fill(); });
  }

  // ---- slim grip: a subtle dark leather wrap over the stave at the hand
  // (just a short thicker/darker band, not a chunky riser block) ----
  const gripCol = style.grip || shade(wood, -0.5);
  const gh = 6 * sc;                              // grip half-height along the stave
  const gA = { x: gc.x + px * gh, y: gc.y + py * gh };
  const gB = { x: gc.x - px * gh, y: gc.y - py * gh };
  const gripW = rad(mid) * 2 + 1.4 * sc;
  ctx.lineCap = "round";
  ctx.strokeStyle = gripCol; ctx.lineWidth = gripW; line(ctx, gA, gB);
  ctx.strokeStyle = shade(gripCol, 0.2); ctx.lineWidth = Math.max(0.8, gripW - 2.4 * sc);
  line(ctx, { x: gc.x + px * (gh - 1.4 * sc), y: gc.y + py * (gh - 1.4 * sc) },
            { x: gc.x - px * (gh - 1.4 * sc), y: gc.y - py * (gh - 1.4 * sc) });
  // small riser gem (upgraded tiers)
  if (style.gem) {
    ctx.fillStyle = "#1c140c"; ctx.beginPath(); ctx.arc(gc.x, gc.y, 2.6 * sc, 0, TAU); ctx.fill();
    ctx.fillStyle = style.gem; ctx.beginPath(); ctx.arc(gc.x, gc.y, 1.7 * sc, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.8; ctx.fillStyle = "#fff";
    ctx.beginPath(); ctx.arc(gc.x - 0.8 * sc, gc.y - 0.8 * sc, 0.7 * sc, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  }

  // ---- string + arrow ----
  v_bowString(ctx, s, upNock, loNock, drawing, charge, sc, a, fx, fy, eCol, style);
}

// crisp string tip-to-tip; pulled to a sharp point at the draw hand when drawing.
function v_bowString(ctx, s, top, bot, drawing, charge, sc, a, fx, fy, eCol, style) {
  const pull = charge * 9 * sc;
  const nock = { x: s.drawHand.x - fx * pull, y: s.drawHand.y - fy * pull };
  ctx.lineCap = "round";
  // string
  ctx.strokeStyle = drawing ? "rgba(255,255,255,.85)" : "rgba(235,235,235,.6)";
  ctx.lineWidth = 1.3 * sc;
  ctx.beginPath(); ctx.moveTo(top.x, top.y);
  if (drawing) { ctx.lineTo(nock.x, nock.y); ctx.lineTo(bot.x, bot.y); }
  else { ctx.lineTo(bot.x, bot.y); }
  ctx.stroke();

  if (drawing) {
    const bx = s.bowHand.x, by = s.bowHand.y;
    const reach = (16 + charge * 16) * sc;
    const ax = bx + fx * reach, ay = by + fy * reach;
    // glow
    if (charge > 0.05) {
      ctx.strokeStyle = eCol; ctx.globalAlpha = 0.3 + charge * 0.4; ctx.lineWidth = (1.6 + charge * 3) * sc;
      ctx.beginPath(); ctx.moveTo(nock.x, nock.y); ctx.lineTo(ax, ay); ctx.stroke();
      ctx.fillStyle = eCol; ctx.globalAlpha = 0.3 + charge * 0.35;
      ctx.beginPath(); ctx.arc(ax, ay, (2 + charge * 3.5) * sc, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
    // shaft
    ctx.strokeStyle = charge > 0.1 ? "#fff" : (style.tip || "#caa15a");
    ctx.globalAlpha = charge > 0.1 ? 0.95 : 1; ctx.lineWidth = 1.9 * sc;
    ctx.beginPath(); ctx.moveTo(nock.x, nock.y); ctx.lineTo(ax, ay); ctx.stroke();
    ctx.globalAlpha = 1;
    // arrowhead
    const hs = (5 + charge * 4) * sc;
    ctx.fillStyle = charge > 0.4 ? eCol : (style.tip || "#caa15a");
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(a - 0.45) * hs, ay - Math.sin(a - 0.45) * hs);
    ctx.lineTo(ax - Math.cos(a + 0.45) * hs, ay - Math.sin(a + 0.45) * hs);
    ctx.closePath(); ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Dragon bow — scaled limbs with molten cracks, a spined spine, a dragon head
// on the upper limb, a curling tail on the lower, and a glowing heart at the
// grip. Shared by the in-hand bow (drawBow) and the shop preview (shop.js).
// pts: tip(0) .. grip(mid) .. tip(last). hint: outward dir (spikes/scales side).
// ---------------------------------------------------------------------------
function sampleQuad(p0, c, p1, n, out) {
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
               y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y });
  }
}

function drawDragonBow(ctx, pts, sc, hint) {
  const n = pts.length, last = n - 1, mid = Math.floor(last / 2);
  if (n < 3) return;                              // need head tip, grip, tail tip
  const grip = pts[mid];
  const nm = [];                                  // per-point tangent + outward normal
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(last, i + 1)];
    let tx = b.x - a.x, ty = b.y - a.y; const L = Math.hypot(tx, ty) || 1; tx /= L; ty /= L;
    let nx = -ty, ny = tx;
    if (nx * hint.x + ny * hint.y < 0) { nx = -nx; ny = -ny; }
    nm.push({ nx: nx, ny: ny, tx: tx, ty: ty });
  }
  const taper = function (i) { return 0.40 + 0.60 * Math.sin(Math.PI * i / last); }; // thin tips, thick grip
  const bw = 3.2 * sc;
  function disc(x, y, r, col, alpha) { ctx.globalAlpha = alpha == null ? 1 : alpha; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); ctx.globalAlpha = 1; }

  ctx.lineCap = "round"; ctx.lineJoin = "round";
  // faint molten under-glow hugging the limb (kept tight so the dark body reads)
  for (let i = 1; i < last; i++) disc(pts[i].x, pts[i].y, taper(i) * bw + 1.0 * sc, "#ff5a2a", 0.08);
  // solid dark scaled body — the dominant silhouette
  for (let i = 0; i < n; i++) disc(pts[i].x, pts[i].y, 0.8 * sc + taper(i) * bw, "#17100a");
  // rounded cross-section: bronze catch-light on the outer half, shadow on the inner
  for (let i = 0; i < n; i++) {
    const w = taper(i) * bw;
    disc(pts[i].x - nm[i].nx * w * 0.45, pts[i].y - nm[i].ny * w * 0.45, Math.max(0.4, w * 0.45), "#000", 0.32);
    disc(pts[i].x + nm[i].nx * w * 0.5, pts[i].y + nm[i].ny * w * 0.5, Math.max(0.4, w * 0.42), "#6e451d", 0.6);
  }
  // continuous gold edge along the outer rim (gleaming dragon-scale trim)
  ctx.strokeStyle = "#caa15a"; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.9 * sc;
  ctx.beginPath();
  for (let i = 0; i < n; i++) { const w = taper(i) * bw; const x = pts[i].x + nm[i].nx * w * 0.85, y = pts[i].y + nm[i].ny * w * 0.85; if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
  ctx.stroke(); ctx.globalAlpha = 1;
  // scale-row scallops marching along the limb
  for (let i = 2; i < last - 1; i++) {
    if (i % 2) continue;
    const w = taper(i) * bw, p = pts[i], ti = Math.atan2(nm[i].ty, nm[i].tx);
    ctx.strokeStyle = "#8a5a24"; ctx.globalAlpha = 0.4; ctx.lineWidth = 0.7 * sc;
    ctx.beginPath(); ctx.arc(p.x - nm[i].nx * w * 0.15, p.y - nm[i].ny * w * 0.15, w * 0.65, ti - 1.1, ti + 1.1); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // molten crack down the spine — a thin restrained accent, not a neon wire
  function crackPath() {
    ctx.beginPath();
    for (let i = 1; i < last; i++) {
      const off = ((i % 2) ? 0.16 : -0.06) * taper(i) * bw;
      const x = pts[i].x + nm[i].nx * off, y = pts[i].y + nm[i].ny * off;
      if (i === 1) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }
  ctx.strokeStyle = "#ff5a2a"; ctx.globalAlpha = 0.32; ctx.lineWidth = 1.5 * sc; crackPath(); ctx.stroke();
  ctx.strokeStyle = "#ff8a3b"; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.65 * sc; crackPath(); ctx.stroke();
  ctx.globalAlpha = 1;
  // back-swept spine spikes on the outer edge (between grip and tips)
  for (let i = 3; i < last - 2; i++) {
    if (i % 3) continue;
    const w = taper(i) * bw, p = pts[i], nmi = nm[i];
    const baseLen = Math.max(0.8, w * 0.45), len = 1.4 * sc + w * 0.9;
    const bx = p.x + nmi.nx * w * 0.7, by = p.y + nmi.ny * w * 0.7;
    const sweep = (i < mid) ? 1 : -1;                                   // sweep toward the nearer tip
    const tx = bx + nmi.nx * len + nmi.tx * len * 0.5 * sweep, ty = by + nmi.ny * len + nmi.ty * len * 0.5 * sweep;
    ctx.fillStyle = "#1a120c";
    ctx.beginPath();
    ctx.moveTo(bx - nmi.tx * baseLen, by - nmi.ty * baseLen);
    ctx.lineTo(tx, ty);
    ctx.lineTo(bx + nmi.tx * baseLen, by + nmi.ty * baseLen);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = "#caa15a"; ctx.globalAlpha = 0.5; ctx.lineWidth = 0.6 * sc;
    ctx.beginPath(); ctx.moveTo(bx + nmi.tx * baseLen * sweep, by + nmi.ty * baseLen * sweep); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // dragon head (top tip), tail curl (bottom tip), heart gem (grip)
  dragonHead(ctx, pts[0].x, pts[0].y, Math.atan2(pts[0].y - pts[1].y, pts[0].x - pts[1].x), sc, nm[0]);
  dragonTail(ctx, pts[last].x, pts[last].y, Math.atan2(pts[last].y - pts[last - 1].y, pts[last].x - pts[last - 1].x), sc, nm[last]);
  heartGem(ctx, grip.x, grip.y, 2.3 * sc);
}

// A stylized dragon head pointing along +ang (outward from the limb tip).
function dragonHead(ctx, x, y, ang, sc, nmTip) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  // make local +y point to the bow's inner (string) side so the jaw opens inward
  const flip = (-Math.sin(ang) * -nmTip.nx + Math.cos(ang) * -nmTip.ny) >= 0 ? 1 : -1;
  ctx.scale(sc, sc * flip);
  ctx.lineJoin = "round";
  ctx.fillStyle = "#1a120c";
  // upper skull + snout
  ctx.beginPath();
  ctx.moveTo(-3.2, -2.0); ctx.lineTo(3.4, -3.3); ctx.lineTo(8.4, -1.2);
  ctx.lineTo(9.6, 0.5); ctx.lineTo(5.8, 1.4); ctx.lineTo(0, 2.3); ctx.lineTo(-3.6, 1.1);
  ctx.closePath(); ctx.fill();
  // open lower jaw
  ctx.beginPath(); ctx.moveTo(3.0, 2.0); ctx.lineTo(8.0, 2.2); ctx.lineTo(7.0, 4.6); ctx.lineTo(2.8, 3.3); ctx.closePath(); ctx.fill();
  // back-swept horns (outer / -y side)
  ctx.beginPath(); ctx.moveTo(-1.4, -2.2); ctx.lineTo(-7.2, -6.6); ctx.lineTo(-2.4, -1.0); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(0.8, -2.6); ctx.lineTo(-3.4, -6.2); ctx.lineTo(1.6, -1.4); ctx.closePath(); ctx.fill();
  // bronze edge along the skull/snout
  ctx.strokeStyle = "#ffae3b"; ctx.globalAlpha = 0.7; ctx.lineWidth = 0.7; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-3.2, -2.0); ctx.lineTo(3.4, -3.3); ctx.lineTo(8.4, -1.2); ctx.lineTo(9.6, 0.5); ctx.stroke();
  ctx.globalAlpha = 1;
  // teeth
  ctx.fillStyle = "#f3ead2";
  for (let k = 0; k < 3; k++) { const tx = 4 + k * 1.5; ctx.beginPath(); ctx.moveTo(tx, 1.9); ctx.lineTo(tx + 0.5, 3.0); ctx.lineTo(tx + 1.0, 1.95); ctx.closePath(); ctx.fill(); }
  // glowing eye
  ctx.fillStyle = "#3a0a00"; ctx.beginPath(); ctx.arc(2.3, -0.5, 1.5, 0, TAU); ctx.fill();
  ctx.fillStyle = "#ff5a2a"; ctx.beginPath(); ctx.arc(2.3, -0.5, 1.0, 0, TAU); ctx.fill();
  ctx.fillStyle = "#ffe08a"; ctx.beginPath(); ctx.arc(2.1, -0.7, 0.42, 0, TAU); ctx.fill();
  // breath glow inside the mouth
  ctx.globalAlpha = 0.55; ctx.fillStyle = "#ff7a2a"; ctx.beginPath(); ctx.arc(7.2, 2.7, 1.1, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  ctx.restore();
}

// A curling, spiked dragon tail at the lower limb tip.
function dragonTail(ctx, x, y, ang, sc, nmTip) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
  const flip = (-Math.sin(ang) * nmTip.nx + Math.cos(ang) * nmTip.ny) >= 0 ? 1 : -1;
  ctx.scale(sc, sc * flip);
  const pt = function (t) { const aa = t * 2.1; return { x: Math.sin(aa) * 4.6, y: -(1 - Math.cos(aa)) * 4.6 - t * 1.2 }; };
  ctx.fillStyle = "#1a120c";
  for (let k = 0; k <= 8; k++) { const p = pt(k / 8); ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, 2.5 * (1 - k / 8)), 0, TAU); ctx.fill(); }
  const tip = pt(1);
  ctx.beginPath(); ctx.moveTo(tip.x, tip.y); ctx.lineTo(tip.x + 3.0, tip.y - 1.4); ctx.lineTo(tip.x + 0.6, tip.y - 3.0); ctx.closePath(); ctx.fill();
  // a barb off the curl
  ctx.beginPath(); ctx.moveTo(1.2, 0); ctx.lineTo(-2.2, -3.4); ctx.lineTo(2.4, -0.8); ctx.closePath(); ctx.fill();
  // molten line along the curl
  ctx.strokeStyle = "#ff7a2a"; ctx.globalAlpha = 0.8; ctx.lineWidth = 0.7; ctx.lineCap = "round";
  ctx.beginPath(); for (let k = 0; k <= 8; k++) { const p = pt(k / 8); if (k === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); } ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.restore();
}

// The dragon-heart gem (gold-framed glowing diamond) at the grip.
function heartGem(ctx, x, y, r) {
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = "#caa15a"; ctx.beginPath(); ctx.moveTo(0, -r * 1.7); ctx.lineTo(r * 1.2, 0); ctx.lineTo(0, r * 1.7); ctx.lineTo(-r * 1.2, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#1a0a06"; ctx.beginPath(); ctx.moveTo(0, -r * 1.25); ctx.lineTo(r * 0.85, 0); ctx.lineTo(0, r * 1.25); ctx.lineTo(-r * 0.85, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ff3a1a"; ctx.beginPath(); ctx.moveTo(0, -r * 0.95); ctx.lineTo(r * 0.62, 0); ctx.lineTo(0, r * 0.95); ctx.lineTo(-r * 0.62, 0); ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.5; ctx.fillStyle = "#ffd24a"; ctx.beginPath(); ctx.arc(0, 0, r * 0.5, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(-r * 0.25, -r * 0.35, r * 0.18, 0, TAU); ctx.fill();
  ctx.restore();
}

// Draw a real bow sprite (if the player added assets/bow_<id>.png) at the grip,
// aligned to the aim. Head-up; belly toward the hand. Best-effort orientation.
function drawBowSprite(ctx, img, bx, by, r, aim) {
  const h = img.naturalHeight || 1, w = img.naturalWidth || 1;
  const drawH = r * 2.6, drawW = drawH * w / h;
  ctx.save();
  ctx.translate(bx, by); ctx.rotate(aim); ctx.scale(1, -1);
  ctx.drawImage(img, -drawW * 0.20, -drawH / 2, drawW, drawH);
  ctx.restore();
}

// Lazy loader for optional bow sprites. Returns the <img> only once it has
// fully loaded with real pixels; null otherwise (so we fall back to vector art).
var BowSprites = (function () {
  const imgs = {};
  function get(id) {
    if (typeof Image === "undefined") return null;
    let img = imgs[id];
    if (!img) {
      img = imgs[id] = new Image();
      img.onerror = function () { img._failed = true; };
      try { img.src = "assets/bow_" + id + ".png"; } catch (e) { img._failed = true; }
    }
    return (!img._failed && img.complete && img.naturalWidth > 0) ? img : null;
  }
  return { get: get };
})();

// Runner's blade, drawn from the lead hand along the aim direction.
function drawKnife(ctx, s) {
  const sc = s.scale || 1;
  const a = s.aim, h = s.bowHand;
  const tipX = h.x + Math.cos(a) * 17 * sc, tipY = h.y + Math.sin(a) * 17 * sc;
  ctx.strokeStyle = "#2b2b30"; ctx.lineWidth = 4 * sc;
  ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(tipX, tipY); ctx.stroke();
  ctx.strokeStyle = "#cfd3da"; ctx.lineWidth = 2.4 * sc;
  ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(tipX, tipY); ctx.stroke();
}

// Soft draw/muzzle glow via stacked alpha arcs (no shadowBlur — mobile-safe).
function drawHandGlow(ctx, x, y, k, color) {
  for (let i = 3; i >= 1; i--) {
    ctx.globalAlpha = 0.10 * k * i;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 4 + i * 3 * k, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
