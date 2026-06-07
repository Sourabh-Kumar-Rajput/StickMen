// ---------------------------------------------------------------------------
// archer.js — a combatant (player or AI). Wraps a living skeleton, handles
// health/damage, drives per-type behaviour (archer / runner / fast / tank /
// bomber / shielded / boss), and converts to a ragdoll on death.
// ---------------------------------------------------------------------------
"use strict";

// Closed-form launch velocity to hit (tx,ty) from (sx,sy) at fixed speed v
// under gravity g (screen coords, y down). Returns {vx,vy} or null if out of
// range. Picks the flatter ("-" root) for a direct shot.
function solveBallistic(sx, sy, tx, ty, v, g) {
  const dx = tx - sx;
  let X = Math.abs(dx); if (X < 1) X = 1;
  const sgn = dx >= 0 ? 1 : -1;
  const Yup = -(ty - sy);
  const v2 = v * v;
  const root = v2 * v2 - g * (g * X * X + 2 * Yup * v2);
  if (root < 0) return null;
  const th = Math.atan((v2 - Math.sqrt(root)) / (g * X));
  return { vx: sgn * v * Math.cos(th), vy: -v * Math.sin(th) };
}

class Archer {
  constructor(o) {
    this.x = o.x;
    this.facing = o.facing || 1;
    this.isPlayer = !!o.isPlayer;
    this.type = o.type || (this.isPlayer ? "player" : "archer");
    this.scale = o.scale || 1;
    this.maxHp = o.hp || 100;
    this.hp = this.maxHp;
    this.color = o.color || "#16161d";
    this.outline = shade(this.color, -0.45);
    this.aim = this.facing > 0 ? -0.5 : Math.PI + 0.5;
    this.dead = false;
    this.ragdoll = null;
    this.remove = false;

    this.fireCd = randInt(0, 40);
    this.reload = o.reload || 80;
    this.skill = o.skill != null ? o.skill : 0.5;
    this.speed = o.speed || 0.6;
    this.launchV = o.launchV || 16;
    this.bombV = o.bombV || 14;
    this.homeX = o.homeX != null ? o.homeX : null;
    this.contactDmg = o.contactDmg || 16;

    this.guard = !!o.guard;          // shielded enemy: passive frontal block
    this.dmgResist = o.dmgResist || 0;
    this.isBoss = !!o.isBoss;
    this.boss = this.isBoss
      ? { phase: 0, pattern: "idle", telegraph: 0, cooldown: 50, patternT: 0, volleyLeft: 0 }
      : null;
    this.shield = null;              // player's raisable shield {active,timer,cd}
    // status effects (applied by elemental arrows)
    this.status = { fireT: 0, fireDps: 0, poisonT: 0, poisonDps: 0, freezeT: 0, slowT: 0, slowFactor: 1 };
    this._dotTick = 0;

    this.walk = 0;
    this.moving = false;     // legs animate only while actually travelling
    this.running = false;    // true => run gait (longer steps, lean, pump)
    this.drawing = false;
    this.flash = 0;
    this.s = null;
  }

  slowMul() { return this.status.slowT > 0 ? this.status.slowFactor : 1; }
  // tanks (dmgResist) and the boss shrug off attrition the same way they do hits
  dotResist() { return (1 - this.dmgResist) * (this.isBoss ? 0.35 : 1); }

  // Damage with no hit-FX/sound (used by DoT + black hole) — just attrition.
  tickDamage(amount, env) {
    if (this.dead) return;
    this.hp -= amount * this.dotResist();
    if (this.hp <= 0) this.die({ vx: 0, vy: -4 }, env, "torso");
  }

  applyStatus(el, charge) {
    if (this.dead || !el || el === "none") return;
    charge = charge || 0;
    const k = this.isBoss ? 0.35 : 1;     // bosses largely shrug off effects
    const st = this.status;
    if (el === "fire") { st.fireT = Math.max(st.fireT, Math.round(180 * k)); st.fireDps = 6 + charge * 4; }
    else if (el === "poison") { st.poisonT = Math.max(st.poisonT, Math.round(240 * k)); st.poisonDps = 10 + charge * 6; }
    else if (el === "ice") { st.freezeT = Math.max(st.freezeT, Math.round((72 + charge * 48) * k)); }
    else if (el === "air") { st.slowT = Math.max(st.slowT, Math.round(180 * k)); st.slowFactor = 0.4; }
  }

  skeleton(groundY) {
    return computeSkeleton(this.x, groundY, this.facing, this.aim, {
      draw: this.drawing,
      walk: (this.moving && !this.dead) ? this.walk : 0,
      run: this.running,
      lean: this.drawing ? 1 : 0,
      scale: this.scale
    });
  }

  update(env, target) {
    if (this.dead) return;
    if (this.flash > 0) this.flash--;
    this.moving = false; this.running = false;   // set true by whichever branch travels

    // --- status effects: damage-over-time, freeze, slow ---
    const st = this.status;
    this._dotTick = (this._dotTick + 1) % 6;
    if (st.fireT > 0) { st.fireT--; this.tickDamage(st.fireDps / 60 * env.dt, env); if (this.dead) return; if (this._dotTick === 0) Game.onDot(this, "fire"); }
    if (st.poisonT > 0) { st.poisonT--; this.tickDamage(st.poisonDps / 60 * env.dt, env); if (this.dead) return; if (this._dotTick === 3) Game.onDot(this, "poison"); }
    if (st.slowT > 0) st.slowT--;
    if (st.freezeT > 0) { st.freezeT--; this.facing = (target.x - this.x) >= 0 ? 1 : -1; this.s = this.skeleton(env.groundY); return; }

    if (this.fireCd > 0) this.fireCd--;
    this.facing = (target.x - this.x) >= 0 ? 1 : -1;

    if (this.isBoss) { this.runBossAI(env, target); return; }

    if (this.type === "runner" || this.type === "fast") {
      this.moving = true; this.running = true;
      this.walk += 0.33 * env.dt;
      this.x += this.facing * this.speed * this.slowMul() * env.dt * 1.7;
      this.s = this.skeleton(env.groundY);
      if (Math.abs(this.x - target.x) < 42 * this.scale && !target.dead) {
        target.damage("torso", { vx: this.facing * 5, vy: -3 }, this);
        this.die({ vx: this.facing * 4, vy: -7 }, env, "torso");
      }
      return;
    }

    if (this.type === "bomber") {
      if (this.homeX != null && this.x > this.homeX + 4) {
        this.moving = true;
        this.x -= this.speed * this.slowMul() * env.dt * 1.4; this.walk += 0.22 * env.dt;
        this.drawing = false; this.s = this.skeleton(env.groundY); return;
      }
      this.drawing = true;
      const sh = computeSkeleton(this.x, env.groundY, this.facing, this.aim, { scale: this.scale }).shoulder;
      const tx = target.s ? target.s.chest.x : target.x, ty = target.s ? target.s.chest.y : env.groundY - 90;
      const sol = solveBallistic(sh.x, sh.y, tx, ty, this.bombV, env.g);
      this.aim = sol ? Math.atan2(sol.vy, sol.vx) : (this.facing > 0 ? -0.9 : Math.PI + 0.9);
      this.s = this.skeleton(env.groundY);
      if (this.fireCd <= 0 && sol && !target.dead && env.spawnBomb) {
        const a = Math.atan2(sol.vy, sol.vx) + rand(-0.05, 0.05);
        const bx = this.s.shoulder.x + Math.cos(a) * this.s.armLen;
        const by = this.s.shoulder.y + Math.sin(a) * this.s.armLen;
        env.spawnBomb(bx, by, Math.cos(a) * this.bombV, Math.sin(a) * this.bombV, "enemy");
        this.fireCd = this.reload + randInt(0, 30);
      }
      return;
    }

    // generic ranged archer (also: tank, shielded)
    if (this.homeX != null && this.x > this.homeX + 4) {
      this.moving = true;
      this.x -= this.speed * this.slowMul() * env.dt * 1.6; this.walk += 0.26 * env.dt;
      this.drawing = false; this.s = this.skeleton(env.groundY); return;
    }
    this.drawing = true;
    const sh = computeSkeleton(this.x, env.groundY, this.facing, this.aim, { scale: this.scale }).shoulder;
    const tx = target.s ? target.s.chest.x : target.x, ty = target.s ? target.s.chest.y : env.groundY - 90;
    const sol = solveBallistic(sh.x, sh.y, tx, ty, this.launchV, env.g);
    this.aim = sol ? Math.atan2(sol.vy, sol.vx) : (this.facing > 0 ? -0.9 : Math.PI + 0.9);
    this.s = this.skeleton(env.groundY);
    if (this.fireCd <= 0 && sol && !target.dead) {
      const jit = (1 - this.skill) * 0.17;
      const a = Math.atan2(sol.vy, sol.vx) + rand(-jit, jit);
      const v = this.launchV * (1 + rand(-0.04, 0.04));
      const bx = this.s.shoulder.x + Math.cos(a) * this.s.armLen;
      const by = this.s.shoulder.y + Math.sin(a) * this.s.armLen;
      env.spawn(bx, by, Math.cos(a) * v, Math.sin(a) * v, "enemy");
      this.fireCd = this.reload + randInt(0, 30);
    }
  }

  runBossAI(env, target) {
    const b = this.boss;
    b.patternT++;
    const frac = this.hp / this.maxHp;
    b.phase = frac > 0.66 ? 0 : frac > 0.33 ? 1 : 2;

    // walk back to home from either side (charge can leave the boss left of home)
    if (this.homeX != null && Math.abs(this.x - this.homeX) > 4 && b.pattern !== "charge") {
      this.moving = true;
      this.x += Math.sign(this.homeX - this.x) * this.speed * this.slowMul() * env.dt * 1.2; this.walk += 0.2 * env.dt;
      this.s = this.skeleton(env.groundY); return;
    }
    const sh = computeSkeleton(this.x, env.groundY, this.facing, this.aim, { scale: this.scale }).shoulder;
    const tx = target.s ? target.s.chest.x : target.x, ty = target.s ? target.s.chest.y : env.groundY - 90;
    const sol = solveBallistic(sh.x, sh.y, tx, ty, this.launchV, env.g);
    if (sol) this.aim = Math.atan2(sol.vy, sol.vx);
    this.drawing = (b.pattern === "volley");
    this.s = this.skeleton(env.groundY);

    if (b.pattern === "idle") {
      if (b.cooldown > 0) { b.cooldown--; return; }
      const opts = b.phase >= 1 ? ["volley", "charge", "summon"] : ["volley", "charge"];
      b.pattern = opts[randInt(0, opts.length - 1)];
      b.telegraph = b.pattern === "charge" ? 42 : 30;
      b.patternT = 0; b.volleyLeft = 4 + b.phase * 2;
      return;
    }
    if (b.telegraph > 0) { b.telegraph--; return; }

    if (b.pattern === "volley") {
      if (this.fireCd <= 0 && sol && b.volleyLeft > 0 && !target.dead) {
        const spread = [-0.18, 0, 0.18][b.volleyLeft % 3];
        const a = Math.atan2(sol.vy, sol.vx) + spread;
        env.spawn(this.s.shoulder.x + Math.cos(a) * this.s.armLen,
                  this.s.shoulder.y + Math.sin(a) * this.s.armLen,
                  Math.cos(a) * this.launchV, Math.sin(a) * this.launchV, "enemy");
        this.fireCd = 10; b.volleyLeft--;
      }
      if (b.volleyLeft <= 0) { b.pattern = "idle"; b.cooldown = 64; }
    } else if (b.pattern === "charge") {
      this.moving = true; this.running = true;
      this.x += this.facing * 3.4 * this.slowMul() * env.dt; this.walk += 0.42 * env.dt;
      this.x = clamp(this.x, target.x + 40, env.W - 120);   // never overshoot the player / off-screen
      this.s = this.skeleton(env.groundY);
      if (Math.abs(this.x - target.x) < 64 && !target.dead) {
        target.damage("torso", { vx: this.facing * 9, vy: -5 }, this);
        b.pattern = "idle"; b.cooldown = 90;
      }
      if (b.patternT > 130) { b.pattern = "idle"; b.cooldown = 80; }
    } else if (b.pattern === "summon" && env.summon) {
      const n = 2 + b.phase;
      for (let i = 0; i < n; i++) {
        env.summon({ type: (i % 2 ? "fast" : "archer"), hp: 60, skill: 0.45, x: this.x - this.facing * (70 + i * 44) });
      }
      b.pattern = "idle"; b.cooldown = 120;
    }
  }

  isFrontal(imp) {
    const vx = (imp && imp.vx) || 0;
    return Math.sign(vx) === -this.facing && Math.abs(vx) > 1.5;
  }

  // override (optional): explicit damage amount, used by explosion AoE so the
  // weapon's configured blast damage applies instead of the part's base value.
  damage(part, imp, src, override) {
    if (this.dead) return;
    if (this.guard && part !== "head" && this.isFrontal(imp)) { Game.onBlock(this, imp); return; }
    const headDmg = this.isBoss ? 120 : 1000;
    let dmg = override != null ? override : (part === "head" ? headDmg : (part === "torso" ? 34 : 16));
    if (this.dmgResist) dmg *= (1 - this.dmgResist);
    this.hp -= dmg;
    this.flash = 6;
    Game.onHit(this, part, imp, dmg);
    if (this.hp <= 0) this.die(imp, Game.env, part);
  }

  die(imp, env, part) {
    if (this.dead) return;
    this.dead = true;
    this.drawing = false;
    if (!this.s) this.s = this.skeleton(env.groundY);
    this.ragdoll = new Ragdoll(this.s, this.color);
    const ix = (imp && imp.vx) || 0, iy = (imp && imp.vy) || 0;
    this.ragdoll.impulseAll(ix * 0.35, iy * 0.35);
    this.ragdoll.impulse(part === "head" ? "head" : "chest", ix * 0.5, iy * 0.5 - (part === "head" ? 2 : 0));
    Game.onKill(this, part);
  }

  draw(ctx, groundY) {
    if (this.dead) { if (this.ragdoll) this.ragdoll.draw(ctx); return; }
    const isRunner = (this.type === "runner" || this.type === "fast");
    const col = this.flash > 0 ? "#d6324a" : this.color;
    drawArcher(ctx, this.s, {
      color: col, outline: this.outline,
      weapon: isRunner ? "knife" : "bow",
      draw: this.drawing,
      charge: this.isPlayer ? (this.charge || 0) : 0,
      accent: this.isPlayer ? this.accentColor : null,
      bowColor: this.isPlayer ? this.bowColor : null,
      bowGlow: this.isPlayer ? this.bowGlow : null,
      bowTip: this.isPlayer ? this.bowTip : null,
      bowGem: this.isPlayer ? this.bowGem : null,
      bowEnergy: this.isPlayer ? this.bowEnergy : null,
      bowArt: this.isPlayer ? this.bowArt : null,
      t: this.isPlayer ? (this.fxT || 0) : 0,
      glow: (this.isPlayer && this.drawing) ? (0.2 + (this.charge || 0) * 0.35) : 0
    });
    if (this.guard) this.drawGuard(ctx);
    this.drawStatus(ctx);
    if (!this.isPlayer && !this.isBoss) this.drawHpBar(ctx);
  }

  drawStatus(ctx) {
    const st = this.status, s = this.s, sc = this.scale || 1;
    if (st.freezeT > 0) {
      ctx.fillStyle = "rgba(120,200,255,.30)";
      ctx.beginPath(); ctx.arc(s.chest.x, s.chest.y - 6 * sc, 28 * sc, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(200,235,255,.9)"; ctx.lineWidth = 2 * sc;
      for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; ctx.beginPath(); ctx.moveTo(s.chest.x + Math.cos(a) * 10 * sc, s.chest.y - 6 * sc + Math.sin(a) * 10 * sc); ctx.lineTo(s.chest.x + Math.cos(a) * 26 * sc, s.chest.y - 6 * sc + Math.sin(a) * 26 * sc); ctx.stroke(); }
    }
    if (st.fireT > 0) {
      for (let i = 0; i < 4; i++) {
        const fx = s.chest.x + rand(-9, 9) * sc, fy = s.chest.y - rand(0, 34) * sc;
        ctx.globalAlpha = 0.65; ctx.fillStyle = i % 2 ? "#ff7a2a" : "#ffd24a";
        ctx.beginPath(); ctx.arc(fx, fy, (3.5 - i * 0.5) * sc + 2, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    if (st.poisonT > 0) {
      ctx.fillStyle = "rgba(120,210,60,.65)";
      for (let i = 0; i < 3; i++) { ctx.beginPath(); ctx.arc(s.chest.x + rand(-11, 11) * sc, s.chest.y - rand(0, 26) * sc, 2 + i, 0, TAU); ctx.fill(); }
    }
    if (st.slowT > 0) {
      ctx.strokeStyle = "rgba(200,220,255,.45)"; ctx.lineWidth = 1.5 * sc;
      ctx.beginPath(); ctx.arc(s.chest.x, s.chest.y, 23 * sc, 0, TAU); ctx.stroke();
    }
  }

  drawGuard(ctx) {
    const sc = this.scale || 1, c = this.s.chest, f = this.facing;
    const cx = c.x + f * 16 * sc, cy = c.y;
    ctx.strokeStyle = "rgba(165,170,180,.95)"; ctx.lineWidth = 5 * sc;
    ctx.beginPath(); ctx.moveTo(cx, cy - 18 * sc); ctx.lineTo(cx, cy + 18 * sc); ctx.stroke();
    ctx.strokeStyle = "rgba(90,95,105,.9)"; ctx.lineWidth = 2 * sc;
    ctx.beginPath(); ctx.arc(cx - f * 3 * sc, cy, 19 * sc, -0.9, 0.9); ctx.stroke();
  }

  drawHpBar(ctx) {
    const pct = clamp(this.hp / this.maxHp, 0, 1);
    const w = 34, h = 4;
    const x = this.s.chest.x - w / 2, y = this.s.head.y - this.s.headR - 12;
    ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
    ctx.fillStyle = "#2b2b30"; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = pct > 0.5 ? "#5ac85a" : pct > 0.25 ? "#e8b13a" : "#e2483a";
    ctx.fillRect(x, y, w * pct, h);
  }
}
