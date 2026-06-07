// ---------------------------------------------------------------------------
// game.js — orchestrator: fixed 1280x720 virtual world (letterboxed), unified
// pointer/touch input, fixed-timestep loop, weapons + shield, enemies + boss,
// themed biomes, effects, audio hooks, persistence, level editor, and the
// three+custom game modes. Exposes a `Game` object.
// ---------------------------------------------------------------------------
"use strict";

const CAMPAIGN = [
  { name: "First Blood",   enemies: [{ type: "archer", skill: 0.30, reload: 95 }, { type: "archer", skill: 0.32, reload: 95 }] },
  { name: "The Rush",      enemies: [{ type: "runner" }, { type: "archer", skill: 0.40 }, { type: "fast" }] },
  { name: "Crossfire",     enemies: [{ type: "archer", skill: 0.46 }, { type: "shielded", guard: true, skill: 0.45 }, { type: "archer", skill: 0.40 }] },
  { name: "Heavy Metal",   enemies: [{ type: "runner" }, { type: "tank", hp: 240, dmgResist: 0.35, speed: 0.32, scale: 1.35 }, { type: "archer", skill: 0.5 }] },
  { name: "Sharpshooters", enemies: [{ type: "shielded", guard: true, skill: 0.6 }, { type: "bomber" }, { type: "archer", skill: 0.6, reload: 60 }] },
  { name: "Last Stand",    enemies: [{ type: "fast" }, { type: "archer", skill: 0.62 }, { type: "tank", hp: 260, dmgResist: 0.4, speed: 0.3, scale: 1.4 }, { type: "shielded", guard: true, skill: 0.7, reload: 55 }] },
  { name: "The Warlord",   boss: true }
];

const Game = (function () {
  const GRAV = 0.42, STEP = 1000 / 60;
  const VW = 1280, VH = 720;              // fixed virtual resolution
  const BOSS_EVERY = 5;
  const W = VW, H = VH;                   // gameplay coords are virtual

  const TYPE_COLOR = {
    archer: "#7a2230", runner: "#b5603a", fast: "#c98a2a",
    tank: "#445163", bomber: "#5a7a3a", shielded: "#556070", boss: "#5a1020"
  };

  const THEMES = {
    grassland: { key: "grassland", sky: ["#cfe8f5", "#eaf4f7", "#e6efdd"], far: "#bcd0e8", far2: "#cfe2c2", mid: "#bcd9ad", groundTop: "#caa46a", groundEdge: "#7d9a55", props: "tree", bloodColor: "#b3122a", dust: ["#d8c79a", "#c9b27e"] },
    desert:    { key: "desert", sky: ["#ffe7b0", "#ffd98f", "#e9c27a"], far: "#e7b377", far2: "#d99a5b", mid: "#caa15a", groundTop: "#d9b066", groundEdge: "#b5894a", props: "cactus", bloodColor: "#a3101f", dust: ["#e7cd9a", "#d2b074"] },
    snow:      { key: "snow", sky: ["#dbe9f5", "#eaf2fb", "#f3f7fc"], far: "#b9c7d8", far2: "#cdd9e6", mid: "#dde7f0", groundTop: "#eef3f8", groundEdge: "#c4d2df", props: "pine", bloodColor: "#c21024", dust: ["#ffffff", "#dfe9f2"], weather: "snow" },
    dungeon:   { key: "dungeon", sky: ["#2a2230", "#241d2b", "#1b1622"], far: "#3a2f44", far2: "#332a3d", mid: "#2c2434", groundTop: "#3a3340", groundEdge: "#26212c", props: "pillar", bloodColor: "#8e0d1c", dust: ["#5a5060", "#463d4f"], torch: true }
  };

  let canvas, ctx, dpr = 1;
  let groundY = VH - 70;
  let enemyV = 16, playerVmax = 25, pullK = 0.15;
  let state = "menu", mode = null;

  let player = null, enemies = [], arrows = [], ragdolls = [], particles = [], texts = [];
  let pending = [], spawnClock = 0, betweenWaves = 0;
  let score = 0, kills = 0, wave = 0, level = 0;
  let shake = 0, shakeX = 0, shakeY = 0;
  let last = 0, acc = 0;
  let bossActive = false, bossRef = null;
  let duelStart = 0, pendingCustom = null;
  let chargeT = 0;            // bow charge while holding (frames)
  let blackholes = [];        // active singularities
  let runCoins = 0;           // coins earned this run (for the result screen)

  const weapons = { sel: "normal" };
  function currentBow() { return BOWS[Store.getEquippedBow()] || BOWS.training; }
  function applyBowStyle(p) { const b = currentBow(); p.bowColor = b.color; p.bowGlow = b.glow; p.bowTip = b.tip; p.bowGem = b.gem; p.bowEnergy = b.energy; p.bowArt = b.id; }
  function chargeFrac() { return clamp(chargeT / CHARGE_MAX, 0, 1); }
  function isOwnedAmmo(id) { return !!(AMMO[id] && (AMMO[id].owned || Store.ownsAmmo(id))); }

  let currentTheme = null, animClock = 0, cacheCanvas = null, cacheCtx = null, cacheKey = null;

  const input = { aiming: false, sx: 0, sy: 0, mx: 0, my: 0, pointerId: -1 };
  const env = {};

  function $(id) { return document.getElementById(id); }
  function sfx(n, o) { if (typeof Sound !== "undefined") Sound.play(n, o); }
  function music(t) { if (typeof Sound !== "undefined") Sound.startMusic(t); }
  function stopMusic() { if (typeof Sound !== "undefined") Sound.stopMusic(); }
  function unlockAudio() { if (typeof Sound !== "undefined") Sound.unlock(); }

  // ---- setup -------------------------------------------------------------
  function init() {
    canvas = $("game");
    ctx = canvas.getContext("2d");
    env.spawn = spawnArrow;
    env.spawnBomb = spawnBomb;
    env.summon = summonAdd;
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("orientationchange", resize);
    canvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    setupLifecycle();
    requestAnimationFrame(loop);
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth, cssH = window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    const scale = Math.min(cssW / VW, cssH / VH);
    VIEW.scale = scale;
    VIEW.offX = (cssW - VW * scale) / 2;
    VIEW.offY = (cssH - VH * scale) / 2;
    VIEW.dpr = dpr;
    groundY = VH - 70;
    // frozen balance constants (deterministic across devices)
    playerVmax = clamp(Math.sqrt(GRAV * 1.15 * VW), 18, 34);
    enemyV = clamp(Math.sqrt(GRAV * 0.95 * VW), 15, 30);
    pullK = playerVmax / (VW * 0.22);
    // theme cache is resolution-independent (virtual coords) — no rebuild on resize
    if (player) player.x = Math.max(90, VW * 0.1);
  }

  function setupLifecycle() {
    document.addEventListener("visibilitychange", function () { if (document.hidden && state === "play") pause(); });
    window.addEventListener("blur", function () { if (state === "play") pause(); });
  }
  function requestFullscreenLandscape() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen;
    if (req) { try { Promise.resolve(req.call(el)).catch(function () {}); } catch (e) {} }
    if (screen.orientation && screen.orientation.lock) {
      try { screen.orientation.lock("landscape").catch(function () {}); } catch (e) {}
    }
  }

  // ---- input -------------------------------------------------------------
  function hitUIElement(e) {
    const el = e.target;
    return !!(el && el.closest && el.closest("button, input, #hud, .screen, #overlay, #menu, #howto, #editor, #customPick, .editor-bar"));
  }
  function inBounds(p) { return p.x >= 0 && p.x <= VW && p.y >= 0 && p.y <= VH; }
  function aimVec() {
    const dx = input.sx - input.mx, dy = input.sy - input.my;
    const len = Math.hypot(dx, dy) || 1;
    return { dx, dy, len, nx: dx / len, ny: dy / len };
  }

  function onDown(e) {
    if (hitUIElement(e)) return;
    if (state !== "play" || !player || player.dead || player.fireCd > 0) return;
    if (input.aiming) return;
    const p = screenToVirtual(e.clientX, e.clientY);
    if (!inBounds(p)) return;
    input.pointerId = e.pointerId;
    input.aiming = true;
    input.sx = input.mx = p.x;
    input.sy = input.my = p.y;
    player.drawing = true;
    chargeT = 0;
    if (e.pointerType !== "mouse") e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    unlockAudio();
    sfx("bowDraw");
  }
  function onMove(e) {
    if (!input.aiming || e.pointerId !== input.pointerId) return;
    const p = screenToVirtual(e.clientX, e.clientY);
    input.mx = p.x; input.my = p.y;
    const v = aimVec(); player.aim = Math.atan2(v.ny, v.nx);
  }
  function onUp(e) {
    if (!input.aiming || (e && e.pointerId !== input.pointerId)) return;
    input.aiming = false; input.pointerId = -1;
    if (player) player.drawing = false;
    try { if (e) canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    if (e) { const p = screenToVirtual(e.clientX, e.clientY); input.mx = p.x; input.my = p.y; } // fire from the exact release point
    const v = aimVec();
    if (v.len < 14) { chargeT = 0; return; }   // canceled release still resets charge
    const baseSpeed = clamp(v.len * pullK, 8, playerVmax);
    player.aim = Math.atan2(v.ny, v.nx);
    fireFromInput(player.aim, baseSpeed);
    chargeT = 0;
  }

  function fireFromInput(aim, baseSpeed) {
    const A = AMMO[weapons.sel] || AMMO.normal;
    const bow = currentBow();
    const charge = chargeFrac();
    const s = player.s;
    const speed = baseSpeed * A.speedMult * (1 + charge * 0.18);   // charge adds a little zip
    const dmgMult = bow.damage * A.dmg * (1 + charge * bow.chargeBonus);
    const accent = A.element === "none" ? null : (ELEM_COLOR[A.element] || null);
    const energy = accent || bow.energy;          // FX color: element, else bow energy
    function shoot(a) {
      const bx = s.shoulder.x + Math.cos(a) * ARM_LEN, by = s.shoulder.y + Math.sin(a) * ARM_LEN;
      spawnArrow(bx, by, Math.cos(a) * speed, Math.sin(a) * speed, "player", {
        kind: A.kind, element: A.element, accent: accent, energy: energy, dmgMult: dmgMult, charge: charge,
        spinV: A.spinV, aoe: A.aoe, sticks: A.kind !== "explosive"
      });
    }
    if (A.count && A.count > 1) { const sp = A.spread || 0.12; shoot(aim - sp); shoot(aim); shoot(aim + sp); }
    else shoot(aim);
    player.fireCd = A.fireCd;
    // muzzle flash on release (brighter with charge)
    addGlow(s.bowHand.x, s.bowHand.y, 12 + charge * 28, energy || "#ffd24a", 8);
    if (charge > 0.3) addBurst(s.bowHand.x, s.bowHand.y, Math.round(2 + charge * 8), energy || "#ffd24a");
    sfx("release", { gain: 0.6 + charge * 0.4 });
    UI.setWeapons(snapshot());
  }
  function spawnArrow(x, y, vx, vy, owner, opts) { const a = new Arrow(x, y, vx, vy, owner, opts); arrows.push(a); return a; }
  function spawnBomb(x, y, vx, vy, owner) {
    const blastR = clamp(Math.sqrt(W) * 3.4, 80, 150);
    return spawnArrow(x, y, vx, vy, owner, { kind: "bomb", fuse: 90, aoe: { radius: blastR, dmg: 32, selfRadius: 0, selfDmg: 0 } });
  }

  function selectWeapon(id) {
    if (!AMMO[id] || !isOwnedAmmo(id)) return;   // only owned ammo
    weapons.sel = id; sfx("click"); UI.setWeapons(snapshot());
  }
  function getWeapons() { return snapshot(); }
  function snapshot() {
    return {
      sel: weapons.sel,
      coins: Store.getCoins(),
      list: AMMO_ORDER.filter(isOwnedAmmo).map(function (id) {
        const w = AMMO[id];
        return { id: id, name: w.name, icon: w.icon, color: ELEM_COLOR[w.element] || "#c9a24a" };
      })
    };
  }
  function refreshLoadout() {
    if (!isOwnedAmmo(weapons.sel)) weapons.sel = "normal";
    if (player) applyBowStyle(player);
    UI.setWeapons(snapshot());
  }
  function raiseShield() {
    const sh = player && player.shield;
    if (state !== "play" || !sh || sh.cd > 0 || sh.active) return;
    sh.active = true; sh.timer = SHIELD.dur; sfx("click"); UI.setShield(true, false);
  }

  // ---- modes -------------------------------------------------------------
  function startMode(m) {
    mode = m; reset();
    if (m === "duel") setupDuel();
    else if (m === "survival") { wave = 0; nextSurvivalWave(); }
    else if (m === "campaign") { level = 0; startLevel(0); }
    else if (m === "custom") { if (!pendingCustom) { quitToMenu(); return; } startCustom(pendingCustom); }
    state = "play";
    UI.hideScreens(); UI.showHud();
    UI.setWeapons(snapshot()); UI.setShield(false, false);
    music(audioTheme());
    updateStats();
  }
  function reset() {
    enemies = []; arrows = []; ragdolls = []; particles = []; texts = []; blackholes = [];
    pending = []; spawnClock = 0; betweenWaves = 0; shake = 0;
    score = 0; kills = 0; runCoins = 0; bossActive = false; bossRef = null;
    weapons.sel = "normal"; chargeT = 0;
    player = new Archer({ x: Math.max(90, VW * 0.1), facing: 1, isPlayer: true, hp: 100, color: "#16161d" });
    player.aim = -0.5;
    player.shield = { active: false, timer: 0, cd: 0 };
    applyBowStyle(player); player.accentColor = null; player.charge = 0;
    player.s = player.skeleton(groundY);
  }
  function setupDuel() {
    const e = new Archer({ x: VW + 40, facing: -1, type: "archer", hp: 100, skill: 0.55, reload: 80, launchV: enemyV });
    e.homeX = VW * 0.72; e.s = e.skeleton(groundY); enemies.push(e);
    duelStart = Date.now();
    setTheme();
  }
  function spawnEnemy(spec) {
    const t = spec.type || "archer";
    const e = new Archer(Object.assign({ x: VW + 40, facing: -1, color: TYPE_COLOR[t] || "#7a2230", launchV: enemyV, bombV: enemyV * 0.62 }, spec));
    if (t === "archer" || t === "tank" || t === "shielded" || t === "bomber") {
      e.homeX = spec.homeX != null ? spec.homeX : rand(VW * 0.5, VW * 0.74);
    }
    e.s = e.skeleton(groundY); enemies.push(e); return e;
  }
  function pickType(w) {
    const pool = ["archer", "archer", "runner"];
    if (w >= 2) pool.push("fast");
    if (w >= 3) pool.push("tank");
    if (w >= 4) pool.push("bomber");
    if (w >= 5) pool.push("shielded");
    return pool[randInt(0, pool.length - 1)];
  }
  function specFor(type, w) {
    switch (type) {
      case "runner": return { type: "runner", hp: 60, speed: 0.9 + w * 0.04, contactDmg: 14 + w };
      case "fast": return { type: "fast", hp: 45, speed: 1.5 + w * 0.05, contactDmg: 12 + w };
      case "tank": return { type: "tank", hp: 200 + w * 18, dmgResist: 0.35, speed: 0.32, skill: 0.4, reload: 110, scale: 1.35 };
      case "bomber": return { type: "bomber", hp: 70, bombV: enemyV * 0.62, reload: 120, speed: 0.45 };
      case "shielded": return { type: "shielded", guard: true, hp: 90, skill: Math.min(0.8, 0.4 + w * 0.03), reload: 80, speed: 0.5 };
      default: return { type: "archer", hp: 80, skill: Math.min(0.85, 0.35 + w * 0.04), reload: Math.max(45, 90 - w * 4), speed: 0.5 };
    }
  }
  function nextSurvivalWave() {
    wave++;
    if (wave % BOSS_EVERY === 0) { spawnBoss(); UI.toast("BOSS WAVE"); sfx("bossWarn"); music("boss"); setTheme(); updateStats(); return; }
    const n = 2 + Math.floor(wave * 1.2);
    for (let i = 0; i < n; i++) pending.push({ at: i * 42 + randInt(0, 30), spec: specFor(pickType(wave), wave) });
    spawnClock = 0; music("survival"); setTheme(); updateStats();
  }
  function startLevel(i) {
    level = i; const L = CAMPAIGN[i];
    if (L.boss) { spawnBoss(); UI.toast("Level " + (i + 1) + ": " + L.name); sfx("bossWarn"); music("boss"); setTheme(); updateStats(); return; }
    for (let k = 0; k < L.enemies.length; k++) {
      const sp = L.enemies[k];
      pending.push({ at: k * 55, spec: Object.assign({ hp: (sp.type === "runner" || sp.type === "fast") ? 60 : 80, reload: 75, speed: 0.5 }, sp) });
    }
    spawnClock = 0; setTheme(); UI.toast("Level " + (i + 1) + ": " + L.name); updateStats();
  }
  function startCustom(level0) {
    for (let k = 0; k < level0.enemies.length; k++) {
      const en = level0.enemies[k];
      const spec = specFor(en.type, 4);
      if (en.type === "archer" || en.type === "tank" || en.type === "shielded" || en.type === "bomber") spec.homeX = clamp(en.xFrac || 0.7, 0.2, 0.98) * VW;
      pending.push({ at: Math.max(0, Math.round((en.delay != null ? en.delay : k * 0.7) * 60)), spec: spec });
    }
    spawnClock = 0; setTheme(); UI.toast(level0.name || "Custom Level"); updateStats();
  }
  function spawnBoss() {
    const e = new Archer({ x: VW + 60, facing: -1, type: "boss", isBoss: true, scale: 2.2, hp: 1100, color: TYPE_COLOR.boss, skill: 0.6, reload: 60, launchV: enemyV, speed: 0.6 });
    e.homeX = Math.min(VW * 0.62, VW - 240); e.s = e.skeleton(groundY);
    enemies.push(e); bossRef = e; bossActive = true;
    UI.toast("THE WARLORD APPROACHES");
  }
  function summonAdd(spec) {
    const t = spec.type || "archer";
    const e = new Archer(Object.assign({ facing: -1, color: TYPE_COLOR[t] || "#7a2230", launchV: enemyV, x: VW * 0.6 }, spec));
    if (t === "archer" || t === "shielded" || t === "tank" || t === "bomber") e.homeX = rand(VW * 0.5, VW * 0.72);
    e.s = e.skeleton(groundY); enemies.push(e);
  }

  // ---- loop --------------------------------------------------------------
  function loop(t) {
    if (!last) last = t;
    let dt = t - last; last = t;
    if (dt > 250) dt = 250;
    if (state === "play") { acc += dt; while (acc >= STEP) { update(); acc -= STEP; } }
    else acc = 0;
    render();
    requestAnimationFrame(loop);
  }

  function update() {
    env.g = GRAV; env.groundY = groundY; env.W = W; env.dt = 1;
    if (player.fireCd > 0) player.fireCd--;
    const sh = player.shield;
    if (sh) {
      if (sh.active) { if (--sh.timer <= 0) { sh.active = false; sh.cd = SHIELD.cd; UI.setShield(false, true); } }
      else if (sh.cd > 0) { if (--sh.cd <= 0) UI.setShield(false, false); }
    }
    // player status effects (defensive — applied if an enemy ever lands one)
    const ps = player.status;
    if (ps.fireT > 0) { ps.fireT--; player.tickDamage(ps.fireDps / 60, env); }
    if (ps.poisonT > 0 && !player.dead) { ps.poisonT--; player.tickDamage(ps.poisonDps / 60, env); }
    if (ps.slowT > 0) ps.slowT--;
    if (ps.freezeT > 0) ps.freezeT--;

    player.drawing = input.aiming;
    if (input.aiming) chargeT = Math.min(chargeT + currentBow().chargeRate, CHARGE_MAX);
    player.charge = input.aiming ? chargeFrac() : 0;
    const selA = AMMO[weapons.sel] || AMMO.normal;
    player.accentColor = selA.element === "none" ? null : (ELEM_COLOR[selA.element] || null);
    applyBowStyle(player);
    player.fxT = animClock;
    player.s = player.skeleton(groundY);

    for (const e of enemies) e.update(env, player);
    handleSpawns();
    for (const a of arrows) {
      a.update(GRAV, groundY);
      if (a.stuck && !a._dusted && a.y >= groundY - 1 && a.kind !== "explosive" && a.kind !== "bomb") { addDust(a.x, groundY, 5, currentTheme.dust); a._dusted = true; }
    }
    collide();
    updateBlackholes();
    for (const r of ragdolls) r.update(env);
    updateEffects();
    cleanup();
    modeLogic();

    shake *= 0.86; if (shake < 0.4) shake = 0;
    shakeX = (Math.random() * 2 - 1) * shake;
    shakeY = (Math.random() * 2 - 1) * shake;
    animClock++;
    if (player) UI.setHp(player.hp / player.maxHp);
  }

  function handleSpawns() {
    spawnClock++;
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= spawnClock) { spawnEnemy(pending[i].spec); pending.splice(i, 1); }
    }
  }

  function collide() {
    // shield blocks frontal enemy projectiles
    const sh = player && player.shield;
    if (player && !player.dead && sh && sh.active) {
      const c = player.s.chest, f = player.facing;
      for (const a of arrows) {
        if (a.stuck || a.exploded || a.owner === "player") continue;
        for (let i = 0; i <= 6; i++) {
          const sx = lerp(a.px, a.x, i / 6), sy = lerp(a.py, a.y, i / 6);
          const dx = sx - c.x, dy = sy - c.y, d = Math.hypot(dx, dy);
          if (d < SHIELD.reach + 18 && Math.cos(Math.atan2(dy, dx)) * f >= Math.cos(SHIELD.arc)) {
            a.stuck = true; a.deadTime = 0;
            if (a.kind === "explosive" || a.kind === "bomb") a.exploded = true; // fizzles
            addBurst(sx, sy, 6, "#cfe7ff"); sfx("block");
            break;
          }
        }
      }
    }
    // projectile vs body
    for (const a of arrows) {
      if (a.stuck || a.exploded) continue;
      const targets = a.owner === "player" ? enemies : (player && !player.dead ? [player] : []);
      let hitT = null, hitPart = null;
      for (const t of targets) {
        if (t.dead || !t.s) continue;
        const segs = archerHitSegments(t.s);
        let found = null; const N = 6;
        for (let i = 0; i <= N && !found; i++) {
          const sx = lerp(a.px, a.x, i / N), sy = lerp(a.py, a.y, i / N);
          for (const sg of segs) { if (pointSegDist(sx, sy, sg.ax, sg.ay, sg.bx, sg.by) < sg.r) { found = sg; break; } }
        }
        if (found) { hitT = t; hitPart = found.part; break; }
      }
      if (hitT) {
        a.stuck = true; a.deadTime = 0;
        if (a.kind === "explosive" || a.kind === "bomb") { explode(a); }
        else if (a.element === "blackhole") { a.exploded = true; spawnBlackhole(a.x, a.y, a.owner, a.dmgMult); }
        else {
          if (a.element && a.element !== "none") hitT.applyStatus(a.element, a.charge || 0); // before damage so fire spreads on a kill
          const base = hitPart === "head" ? (hitT.isBoss ? 120 : 1000) : (hitPart === "torso" ? 34 : 16);
          const dmg = hitPart === "head" ? base : Math.round(base * (a.dmgMult || 1));
          const ch = a.charge || 0, kb = 1 + ch * 1.4;            // charged shots hit much harder
          hitT.damage(hitPart, { vx: a.vx * 0.5 * kb, vy: a.vy * 0.5 * kb - ch * 2 }, a, dmg);
          if (a.owner === "player") impactFX(a.x, a.y, ch, a.energy || a.accent, a.vx, a.vy);
          if (hitT.dead && hitT.ragdoll && a.sticks) a.stickToRagdoll(hitT.ragdoll);
        }
      }
    }
    // detonations / singularities on ground or fuse
    for (const a of arrows) if (a.explodeOnGround && !a.exploded) {
      if (a.element === "blackhole") { a.exploded = true; spawnBlackhole(a.x, Math.min(a.y, groundY), a.owner, a.dmgMult); }
      else explode(a);
    }
  }

  function explode(a) {
    a.exploded = true; a.stuck = true; a.deadTime = 0;
    const cfg = a.aoe || AMMO.bomb.aoe;
    const mult = a.dmgMult || 1;   // bow power + charge scale the blast
    addExplosion(a.x, Math.min(a.y, groundY));
    shake = Math.max(shake, 14);
    sfx("explosion", { pan: clamp((a.x / W) * 2 - 1, -1, 1) });
    function hurt(t, rad, dmg) {
      if (!t || t.dead || !t.s) return;
      const c = t.s.chest, dd = Math.hypot(c.x - a.x, c.y - a.y);
      if (dd < rad) {
        const k = 1 - dd / rad;
        const ang = Math.atan2(c.y - a.y, c.x - a.x);
        const part = dd < rad * 0.4 ? "torso" : "limb";
        t.damage(part, { vx: Math.cos(ang) * 10 * k, vy: Math.sin(ang) * 10 * k - 3 }, a, Math.round(dmg * (0.4 + 0.6 * k)));
      }
    }
    if (a.owner === "player") { for (const e of enemies) hurt(e, cfg.radius, cfg.dmg * mult); if (cfg.selfDmg) hurt(player, cfg.selfRadius, cfg.selfDmg); }
    else if (player) hurt(player, cfg.radius, cfg.dmg);
  }

  function modeLogic() {
    if (player.dead) { gameOver(); return; }
    const alive = enemies.filter(function (e) { return !e.dead && !e.remove; }).length;
    const clear = alive === 0 && pending.length === 0;
    if (mode === "duel") { if (clear) win("Victory!", "You won the duel. Sharp shooting."); }
    else if (mode === "survival") {
      if (clear) { betweenWaves++; if (betweenWaves > 90) { betweenWaves = 0; Store.addCoins(20); runCoins += 20; nextSurvivalWave(); } }
      else betweenWaves = 0;
    } else if (mode === "campaign") {
      if (clear) { if (level + 1 < CAMPAIGN.length) levelComplete(); else win("Campaign Complete!", "You cleared every level. Legendary."); }
    } else if (mode === "custom") {
      if (clear) win("Level Clear!", pendingCustom && pendingCustom.name ? "“" + pendingCustom.name + "” cleared." : "Nice shooting.");
    }
  }

  // ---- effects -----------------------------------------------------------
  function bloodColor() { return (currentTheme && currentTheme.bloodColor) || "#b3122a"; }
  function onHit(t, part, imp, dmg) {
    const x = part === "head" ? t.s.head.x : t.s.chest.x;
    const y = part === "head" ? t.s.head.y : t.s.chest.y;
    addBlood(x, y, (imp && imp.vx) || 0, (imp && imp.vy) || 0, part === "head" ? 16 : 9);
    if (part !== "limb") addGlow(x, y, 14, "#ff5a4a", 10);
    if (t.hp > 0 && !t.isPlayer) addText(x, y - 8, "-" + Math.round(dmg), "#ff7a7a", 24);
    if (t.isPlayer) shake = Math.max(shake, 6);
    sfx(part === "head" ? "headshot" : "flesh", { pan: clamp((x / W) * 2 - 1, -1, 1) });
  }
  function onKill(e, part) {
    if (e.isPlayer) { shake = Math.max(shake, 18); sfx("defeat"); return; }
    if (e.status && e.status.fireT > 0) spreadFire(e);   // a burning corpse ignites its neighbours
    ragdolls.push(e.ragdoll); e.remove = true; kills++;
    let pts = part === "head" ? 15 : 10;
    let coin = part === "head" ? 8 : 5;
    if (e.isBoss) {
      pts = 200; coin = 120; bossActive = false;
      addText(e.s.head.x, e.s.head.y - 20, "BOSS DOWN", "#ffd24a", 42);
      shake = Math.max(shake, 28);
    } else {
      addText(e.s.head.x, e.s.head.y - 12, part === "head" ? "HEADSHOT" : "+" + pts, part === "head" ? "#ffd24a" : "#eaeaf0", part === "head" ? 30 : 24);
      if (part === "head") addBurst(e.s.head.x, e.s.head.y, 12, bloodColor());
      shake = Math.max(shake, part === "head" ? 15 : 8);
    }
    score += pts;
    grantCoins(coin, e.s.head.x, e.s.head.y - 30);
    sfx("enemyDeath", { pan: clamp((e.s.chest.x / W) * 2 - 1, -1, 1) });
    updateStats();
  }
  function onBlock(t, imp) {
    addText(t.s.chest.x, t.s.chest.y - 10, "BLOCKED", "#bfe3ff", 22);
    addBurst(t.s.chest.x + t.facing * 16, t.s.chest.y, 6, "#cfe7ff");
    sfx("block");
  }
  function onDot(e, kind) {
    if (!e.s) return;
    const col = kind === "fire" ? "#ff7a2a" : "#7ad13b";
    particles.push({ x: e.s.chest.x + rand(-8, 8), y: e.s.chest.y - rand(0, 20), vx: rand(-0.6, 0.6), vy: rand(-1.6, -0.4), life: randInt(12, 22), max: 22, size: rand(1.5, 3), color: col, type: "shard", grav: kind === "fire" ? -0.03 : 0.04, drag: 0.95 });
  }
  function grantCoins(n, x, y) { Store.addCoins(n); runCoins += n; addText(x, y, "+" + n + "🪙", "#ffd24a", 18); }
  function spreadFire(src) {
    if (!src.s) return; const c = src.s.chest;
    addExplosion(c.x, c.y);
    for (const o of enemies) { if (o === src || o.dead || o.remove || !o.s) continue; if (Math.hypot(o.s.chest.x - c.x, o.s.chest.y - c.y) < 150) { o.applyStatus("fire", 0.5); addBurst(o.s.chest.x, o.s.chest.y, 5, "#ff8a2a"); } }
  }

  // ---- black hole singularity ----
  function spawnBlackhole(x, y, owner, dmgMult) {
    blackholes.push({ x: x, y: Math.min(y, groundY - 10), t: 130, maxT: 130, r: 150, owner: owner, dmgMult: dmgMult || 1 });
    shake = Math.max(shake, 10);
    sfx("explosion", { pan: clamp((x / W) * 2 - 1, -1, 1), gain: 0.7 });
  }
  function updateBlackholes() {
    for (const bh of blackholes) {
      bh.t--;
      const victims = bh.owner === "player" ? enemies : (player && !player.dead ? [player] : []);
      for (const v of victims) {
        if (v.dead || !v.s) continue;
        const c = v.s.chest, dx = bh.x - c.x, dy = bh.y - c.y, d = Math.hypot(dx, dy) || 1;
        if (d < bh.r) { if (!v.isBoss) v.x += (dx / d) * (1 - d / bh.r) * 2.2; v.tickDamage(0.5 * bh.dmgMult, env); }
      }
      if (bh.t % 2 === 0) { const a = rand(0, TAU); particles.push({ x: bh.x + Math.cos(a) * bh.r * 0.8, y: bh.y + Math.sin(a) * bh.r * 0.8, vx: -Math.cos(a) * 3, vy: -Math.sin(a) * 3, life: 20, max: 20, size: rand(1.5, 3), color: "#b06bff", type: "shard", grav: 0, drag: 0.96 }); }
      if (bh.t <= 0) {
        addExplosion(bh.x, bh.y); shake = Math.max(shake, 16);
        const v2 = bh.owner === "player" ? enemies : (player && !player.dead ? [player] : []);
        for (const v of v2) { if (v.dead || !v.s) continue; if (Math.hypot(bh.x - v.s.chest.x, bh.y - v.s.chest.y) < bh.r * 0.8) v.tickDamage(40 * bh.dmgMult, env); }
      }
    }
    blackholes = blackholes.filter(function (b) { return b.t > 0; });
  }
  function drawBlackholes() {
    for (const bh of blackholes) {
      const rr = bh.r * 0.34 * (0.85 + 0.15 * Math.sin(animClock * 0.3));
      ctx.strokeStyle = "rgba(176,107,255,.5)"; ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) { ctx.globalAlpha = 0.3 * (1 - i / 3); ctx.beginPath(); ctx.arc(bh.x, bh.y, rr + i * 7 + (animClock % 28), 0, TAU); ctx.stroke(); }
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#15101f"; ctx.beginPath(); ctx.arc(bh.x, bh.y, rr, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(200,150,255,.85)"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(bh.x, bh.y, rr, 0, TAU); ctx.stroke();
    }
  }
  function addBlood(x, y, vx, vy, n) {
    const col = bloodColor();
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: vx * 0.15 + rand(-2.6, 2.6), vy: vy * 0.15 + rand(-3.2, 1), life: randInt(18, 40), max: 40, size: rand(2, 4.2), color: col, type: "blood" });
  }
  function addBurst(x, y, n, color) {
    for (let i = 0; i < n; i++) { const a = rand(0, TAU), sp = rand(1, 4); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1, life: randInt(10, 22), max: 22, size: rand(1.5, 3), color: color, type: "shard", grav: 0.12, drag: 0.92 }); }
  }
  function addExplosion(x, y) {
    for (let i = 0; i < 22; i++) { const a = rand(0, TAU), sp = rand(2, 7); particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: randInt(16, 30), max: 30, size: rand(2, 4.5), color: i < 7 ? "#ffd24a" : (i < 14 ? "#ff7a2a" : "#555"), type: "shard", grav: 0.18, drag: 0.92 }); }
    addGlow(x, y, 34, "#ffb43b", 14);
  }
  function addDust(x, y, n, pal) {
    pal = pal || ["#d8c79a", "#c9b27e"];
    for (let i = 0; i < n; i++) particles.push({ x, y, vx: rand(-1.5, 1.5), vy: rand(-2.2, -0.3), life: randInt(14, 26), max: 26, size: rand(2, 5), color: pal[i % pal.length], type: "dust", grav: 0.05, drag: 0.94 });
  }
  function addGlow(x, y, r, color, life) { particles.push({ x, y, vx: 0, vy: 0, life: life, max: life, size: r, color: color, type: "glow" }); }
  // arrow impact: a small white spark spray when uncharged, a big colored burst when charged
  function impactFX(x, y, charge, color, vx, vy) {
    const ang = Math.atan2(vy || 0, vx || 1);
    const col = color || "#e8e8ee";
    const n = Math.round(8 + charge * 24);
    addGlow(x, y, 10 + charge * 42, col, 9 + charge * 8);
    for (let i = 0; i < n; i++) {
      const a2 = ang + rand(-1.1, 1.1);
      const s = rand(1, 2.5 + charge * 6);
      particles.push({
        x, y,
        vx: Math.cos(a2) * s + Math.cos(ang) * charge * 3,
        vy: Math.sin(a2) * s + Math.sin(ang) * charge * 3 - 1,
        life: randInt(12, 28), max: 28, size: rand(1.2, 2.4 + charge * 2.6),
        color: (i % 3 === 0) ? "#ffffff" : col, type: "shard", grav: 0.12, drag: 0.92
      });
    }
    if (charge > 0.4) shake = Math.max(shake, 5 + charge * 10);
  }
  function addText(x, y, txt, color, size) { texts.push({ x, y, txt, color: color || "#fff", size: size || 26, life: 50, max: 50, vy: -0.7 }); }

  function updateEffects() {
    for (const p of particles) {
      p.life--;
      const gg = p.grav != null ? p.grav : 0.22;
      p.vy += gg; if (p.drag) { p.vx *= p.drag; p.vy *= p.drag; }
      p.x += p.vx; p.y += p.vy;
      if ((p.type == null || p.type === "blood") && p.y > groundY) { p.y = groundY; p.vy *= -0.3; p.vx *= 0.6; }
    }
    if (particles.length > 400) particles.splice(0, particles.length - 400);
    for (const t of texts) { t.life--; t.y += t.vy; }
  }
  function cleanup() {
    enemies = enemies.filter(function (e) { return !e.remove; });
    arrows = arrows.filter(function (a) { return !(a.stuck && a.deadTime > 600) && a.x > -80 && a.x < W + 80 && a.y < H + 80; });
    if (arrows.length > 140) arrows.splice(0, arrows.length - 140);
    if (ragdolls.length > 14) ragdolls.splice(0, ragdolls.length - 14);
    particles = particles.filter(function (p) { return p.life > 0; });
    texts = texts.filter(function (t) { return t.life > 0; });
  }

  // ---- flow --------------------------------------------------------------
  function starsFor(hp, max) { const f = hp / max; return f > 0.66 ? 3 : f > 0.33 ? 2 : 1; }
  function gameOver() {
    if (state !== "play") return;
    state = "over"; UI.hideHud(); stopMusic();
    let msg, badge = "";
    if (mode === "survival") { const r = Store.recordSurvival(wave, score); if (r.bestWave || r.bestScore) badge = "New best!"; msg = "You reached Wave " + wave + " with " + kills + " kills. Score " + score + "."; }
    else if (mode === "campaign") msg = "You fell on Level " + (level + 1) + ".";
    else if (mode === "custom") msg = "You fell. Try again.";
    else { Store.recordDuel(false); msg = "Your opponent bested you."; }
    UI.showOver("Defeated", msg, [
      { label: "Retry", act: function () { startMode(mode); } },
      { label: "Menu", act: quitToMenu, ghost: true }
    ], { badge: badge });
  }
  function win(title, msg) {
    if (state !== "play") return;
    state = "over"; UI.hideHud(); sfx("victory"); stopMusic();
    let badge = "";
    Store.addCoins(mode === "duel" ? 60 : mode === "campaign" ? 100 : 25);
    if (mode === "duel") { const r = Store.recordDuel(true, Date.now() - duelStart); if (r.fastest) badge = "Fastest win!"; }
    else if (mode === "campaign") Store.recordCampaignFurthest(CAMPAIGN.length);
    msg += "  (🪙 " + Store.getCoins() + ")";
    UI.showOver(title, msg, [
      { label: "Play again", act: function () { startMode(mode); } },
      { label: "Menu", act: quitToMenu, ghost: true }
    ], { badge: badge });
  }
  function levelComplete() {
    if (state !== "play") return;
    state = "over";
    const nextI = level + 1;
    const stars = starsFor(player.hp, player.maxHp);
    const r = Store.recordCampaignLevel(level, stars, Math.round(player.hp));
    Store.recordCampaignFurthest(nextI);
    Store.addCoins(40); runCoins += 40;
    sfx("levelComplete");
    const starStr = "★".repeat(stars) + "☆".repeat(3 - stars);
    UI.showOver("Level Complete", CAMPAIGN[level].name + " cleared.  " + starStr + "  (Health restored)", [
      { label: "Continue", act: function () { player.hp = player.maxHp; UI.hideScreens(); state = "play"; startLevel(nextI); music(audioTheme()); } },
      { label: "Menu", act: quitToMenu, ghost: true }
    ], { badge: r.firstClear ? "First clear!" : (r.moreStars ? "New record!" : "") });
  }
  function pause() {
    if (state !== "play") return;
    state = "paused"; if (typeof Sound !== "undefined") Sound.setMusicGain(0.25);
    UI.showOver("Paused", "", [
      { label: "Resume", act: resume },
      { label: "Restart", act: function () { startMode(mode); }, ghost: true },
      { label: "Menu", act: quitToMenu, ghost: true }
    ]);
  }
  function resume() { if (state === "paused") { state = "play"; if (typeof Sound !== "undefined") Sound.setMusicGain(1); UI.hideScreens(); } }
  function quitToMenu() {
    state = "menu"; mode = null;
    enemies = []; arrows = []; ragdolls = []; particles = []; texts = []; pending = [];
    player = null; bossActive = false; bossRef = null;
    currentTheme = THEMES.grassland; cacheKey = null;
    UI.hideHud(); UI.hideScreens(); UI.showMenu();
    music("menu");
  }
  function startEditor() { state = "editor"; UI.hideHud(); currentTheme = THEMES.grassland; cacheKey = null; }
  function playCustom(level0) { pendingCustom = level0; startMode("custom"); }

  function audioTheme() {
    if (bossActive) return "boss";
    if (mode === "survival") return "survival";
    if (mode === "campaign") return "campaign";
    return "field";
  }
  function updateStats() {
    let s = "";
    if (mode === "duel") s = "⚔ Duel";
    else if (mode === "survival") s = "⛨ Wave " + wave + " &nbsp; ★ " + score;
    else if (mode === "campaign") s = "\u{1F3F0} Level " + (level + 1) + "/" + CAMPAIGN.length;
    else if (mode === "custom") s = "\u{1F6E0} " + (pendingCustom && pendingCustom.name ? pendingCustom.name : "Custom") + " &nbsp; ★ " + score;
    s += " &nbsp; 🪙 " + Store.getCoins();
    UI.setStats(s);
  }

  // ---- themes / background ----------------------------------------------
  function themeFor(m, lv, wv) {
    if (m === "campaign") return ["grassland", "grassland", "desert", "desert", "snow", "dungeon", "dungeon"][lv] || "grassland";
    if (m === "survival") return ["grassland", "desert", "snow", "dungeon"][Math.floor(((wv || 1) - 1) / 3) % 4];
    return "grassland";
  }
  function setTheme() { currentTheme = THEMES[themeFor(mode, level, wave)] || THEMES.grassland; cacheKey = null; }
  function silhouette(c, baseY, amp, phase, period) {
    c.beginPath(); c.moveTo(0, baseY);
    for (let x = 0; x <= W; x += 40) { const y = baseY - (Math.sin(x / period + phase) * 0.5 + 0.5) * amp; c.lineTo(x, y); }
    c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
  }
  // Bake the entire static scene (sky, silhouettes, ground, props) once per
  // theme — it is fully resolution-independent (W/H/groundY are constants), so
  // only the animated weather is drawn live each frame.
  function ensureCache(theme) {
    if (cacheKey === theme.key) return;
    if (!cacheCanvas) { cacheCanvas = document.createElement("canvas"); cacheCtx = cacheCanvas.getContext("2d"); }
    cacheCanvas.width = W; cacheCanvas.height = H;
    const c = cacheCtx, sg = c.createLinearGradient(0, 0, 0, H);
    sg.addColorStop(0, theme.sky[0]); sg.addColorStop(0.55, theme.sky[1]); sg.addColorStop(1, theme.sky[2]);
    c.fillStyle = sg; c.fillRect(0, 0, W, H);
    c.fillStyle = theme.far; silhouette(c, groundY - 70, 90, 0.0, 320);
    c.fillStyle = theme.far2; silhouette(c, groundY - 30, 130, 1.7, 260);
    c.fillStyle = theme.mid; silhouette(c, groundY - 10, 70, 0, 200);
    c.fillStyle = theme.groundTop; c.fillRect(0, groundY, W, H - groundY);
    drawProps(c, theme);
    c.fillStyle = theme.groundEdge; c.fillRect(0, groundY - 5, W, 8);
    c.strokeStyle = "rgba(0,0,0,0.06)"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, groundY); c.lineTo(W, groundY); c.stroke();
    cacheKey = theme.key;
  }
  function cloud(ctx, x, y, s) { ctx.beginPath(); ctx.arc(x, y, 22 * s, 0, TAU); ctx.arc(x + 24 * s, y + 6 * s, 18 * s, 0, TAU); ctx.arc(x - 22 * s, y + 6 * s, 16 * s, 0, TAU); ctx.fill(); }
  function drawWeather(c, theme, t) {
    if (theme.weather === "snow") {
      c.fillStyle = "rgba(255,255,255,.85)";
      for (let i = 0; i < 55; i++) { const x = (i * 137 + t * 1.2) % (W + 40) - 20; const y = ((i * 53) + t * 2.0) % groundY; c.beginPath(); c.arc(x, y, 1.6 + (i % 3) * 0.6, 0, TAU); c.fill(); }
    } else if (theme.torch) {
      const fl = 0.5 + 0.5 * Math.sin(t * 0.3);
      c.fillStyle = "rgba(255,150,40," + (0.10 * fl) + ")";
      c.beginPath(); c.arc(W * 0.2, groundY - 130, 70, 0, TAU); c.fill();
      c.beginPath(); c.arc(W * 0.82, groundY - 130, 70, 0, TAU); c.fill();
    } else {
      c.fillStyle = "rgba(255,255,255,.5)";
      for (let i = 0; i < 3; i++) { const cx = ((i * 440 + t * 0.3) % (W + 280)) - 140; cloud(c, cx, 80 + i * 42, 1 + i * 0.2); }
    }
  }
  function propAt(c, theme, x, s) {
    const gy = groundY;
    if (theme.props === "tree") {
      c.fillStyle = "#6a4a2a"; c.fillRect(x - 4 * s, gy - 44 * s, 8 * s, 44 * s);
      c.fillStyle = "#5b7d3a"; c.beginPath(); c.arc(x, gy - 50 * s, 26 * s, 0, TAU); c.fill();
      c.fillStyle = "#6b8f45"; c.beginPath(); c.arc(x - 10 * s, gy - 44 * s, 18 * s, 0, TAU); c.fill();
    } else if (theme.props === "cactus") {
      c.fillStyle = "#4f7d3a"; c.fillRect(x - 5 * s, gy - 50 * s, 10 * s, 50 * s);
      c.fillRect(x - 18 * s, gy - 34 * s, 8 * s, 20 * s); c.fillRect(x - 18 * s, gy - 34 * s, 18 * s, 8 * s);
      c.fillRect(x + 10 * s, gy - 42 * s, 8 * s, 26 * s); c.fillRect(x + 10 * s, gy - 42 * s, 8 * s, 8 * s);
    } else if (theme.props === "pine") {
      c.fillStyle = "#5a4326"; c.fillRect(x - 3 * s, gy - 18 * s, 6 * s, 18 * s);
      c.fillStyle = "#3f6b4a";
      for (let j = 0; j < 3; j++) { const yy = gy - 18 * s - j * 15 * s; c.beginPath(); c.moveTo(x, yy - 22 * s); c.lineTo(x - 16 * s, yy); c.lineTo(x + 16 * s, yy); c.closePath(); c.fill(); }
    } else if (theme.props === "pillar") {
      c.fillStyle = "#3a3340"; c.fillRect(x - 10 * s, gy - 90 * s, 20 * s, 90 * s);
      c.fillStyle = "#2a2530"; c.fillRect(x - 14 * s, gy - 90 * s, 28 * s, 8 * s); c.fillRect(x - 14 * s, gy - 8 * s, 28 * s, 8 * s);
    }
  }
  function drawProps(c, theme) {
    const xs = [150, 430, 770, 1050, 1220];
    for (let i = 0; i < xs.length; i++) propAt(c, theme, xs[i], 0.7 + (i % 2) * 0.22);
  }
  function drawTheme(c, theme, scroll, t) {
    ensureCache(theme); c.drawImage(cacheCanvas, 0, 0, W, H);
    drawWeather(c, theme, t);
  }
  function drawBackground() { if (!currentTheme) currentTheme = THEMES.grassland; drawTheme(ctx, currentTheme, 0, animClock); }

  // ---- render ------------------------------------------------------------
  function render() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    const s = VIEW.scale * dpr;
    ctx.setTransform(s, 0, 0, s, VIEW.offX * dpr, VIEW.offY * dpr);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, VW, VH); ctx.clip();

    if (state === "editor") { drawBackground(); if (typeof Editor !== "undefined") Editor.render(ctx); ctx.restore(); return; }

    drawBackground();
    ctx.save();
    ctx.translate(shakeX, shakeY);

    drawBlackholes();
    for (const r of ragdolls) r.draw(ctx);
    for (const e of enemies) if (!e.remove) e.draw(ctx, groundY);
    if (player) player.draw(ctx, groundY);
    drawShield();
    for (const a of arrows) a.draw(ctx);
    for (const p of particles) drawParticle(p);
    if (input.aiming && player && !player.dead) drawAimPreview();
    if (bossActive && bossRef && !bossRef.dead) drawBossTelegraph();
    for (const tx of texts) drawText(tx);

    ctx.restore(); // shake
    if (bossActive && bossRef && !bossRef.dead) drawBossBar();
    ctx.restore(); // clip
  }
  function drawParticle(p) {
    if (p.type === "glow") {
      for (let i = 3; i >= 1; i--) { ctx.globalAlpha = (p.life / p.max) * 0.12 * i; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * i * 0.5, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1; return;
    }
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    ctx.globalAlpha = 1;
  }
  function drawText(t) {
    ctx.globalAlpha = Math.max(0, t.life / t.max);
    ctx.fillStyle = t.color; ctx.font = "800 " + t.size + "px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(t.txt, t.x, t.y);
    ctx.globalAlpha = 1; ctx.textAlign = "left";
  }
  function drawShield() {
    if (!player || player.dead || !player.shield || !player.shield.active) return;
    const c = player.s.chest, f = player.facing, center = f > 0 ? 0 : Math.PI;
    ctx.strokeStyle = "rgba(180,210,255,.35)"; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.arc(c.x, c.y, SHIELD.reach, center - SHIELD.arc, center + SHIELD.arc); ctx.stroke();
    ctx.strokeStyle = "rgba(120,180,255,.8)"; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(c.x, c.y, SHIELD.reach, center - SHIELD.arc, center + SHIELD.arc); ctx.stroke();
  }
  function drawAimPreview() {
    const A = AMMO[weapons.sel] || AMMO.normal;
    const v = aimVec();
    if (v.dx === 0 && v.dy === 0) return;            // not dragged yet — no degenerate arc
    const charge = chargeFrac();
    const speed = clamp(v.len * pullK, 8, playerVmax) * A.speedMult * (1 + charge * 0.18); // includes charge, like the shot
    const s = player.s;
    const ox = s.shoulder.x + Math.cos(player.aim) * ARM_LEN;
    const oy = s.shoulder.y + Math.sin(player.aim) * ARM_LEN;
    const accent = A.element === "none" ? null : (ELEM_COLOR[A.element] || null);
    const offsets = (A.count && A.count > 1) ? [-(A.spread || 0.12), 0, (A.spread || 0.12)] : [0];
    ctx.fillStyle = accent ? rgbaHex(accent, 0.6) : "rgba(30,30,40,0.5)";
    for (const off of offsets) {
      let x = ox, y = oy;
      let vx = Math.cos(player.aim + off) * speed, vy = Math.sin(player.aim + off) * speed;
      for (let i = 0; i < 70; i++) {
        vy += GRAV * A.gravMult; x += vx; y += vy;
        if (y > groundY || x > W || x < 0) break;
        if (i % 3 === 0) { ctx.beginPath(); ctx.arc(x, y, 2.2 + charge * 1.2, 0, TAU); ctx.fill(); }
      }
    }
    // charge ring at the bow hand (grows + tints with charge/element)
    const ring = accent || "#ffd24a";
    ctx.strokeStyle = rgbaHex(ring, 0.35 + charge * 0.55); ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.bowHand.x, s.bowHand.y, 9 + charge * 12, 0, TAU); ctx.stroke();
  }
  function drawBossBar() {
    const e = bossRef;
    const bw = Math.min(560, W * 0.7), bx = (W - bw) / 2, by = 18, bh = 16;
    const pct = clamp(e.hp / e.maxHp, 0, 1);
    ctx.fillStyle = "rgba(0,0,0,.4)"; ctx.fillRect(bx - 3, by - 3, bw + 6, bh + 6);
    ctx.fillStyle = "#2b2b30"; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = "#c0303a"; ctx.fillRect(bx, by, bw * pct, bh);
    ctx.fillStyle = "#fff"; ctx.font = "800 14px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText("THE WARLORD", W / 2, by + bh + 16); ctx.textAlign = "left";
  }
  function drawBossTelegraph() {
    const e = bossRef, b = e.boss;
    if (!b || b.telegraph <= 0 || !e.s) return;
    ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(animClock * 0.4));
    if (b.pattern === "charge") {
      ctx.strokeStyle = "rgba(230,60,60,.85)"; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(e.s.chest.x, e.s.chest.y); ctx.lineTo(player.s.chest.x, e.s.chest.y); ctx.stroke();
    } else if (b.pattern === "volley") {
      ctx.strokeStyle = "rgba(230,160,40,.8)"; ctx.lineWidth = 2;
      [-0.18, 0, 0.18].forEach(function (sp) { const a = e.aim + sp; ctx.beginPath(); ctx.moveTo(e.s.shoulder.x, e.s.shoulder.y); ctx.lineTo(e.s.shoulder.x + Math.cos(a) * 130, e.s.shoulder.y + Math.sin(a) * 130); ctx.stroke(); });
    } else if (b.pattern === "summon") {
      ctx.strokeStyle = "rgba(170,90,230,.8)"; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(e.s.chest.x, e.s.chest.y, 44 + 10 * Math.sin(animClock * 0.3), 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return {
    init: init, startMode: startMode, pause: pause, resume: resume, quitToMenu: quitToMenu,
    onHit: onHit, onKill: onKill, onBlock: onBlock, onDot: onDot, env: env,
    isPlaying: function () { return state === "play"; },
    state: function () { return state; },
    selectWeapon: selectWeapon, getWeapons: getWeapons, raiseShield: raiseShield,
    refreshLoadout: refreshLoadout, getCoins: function () { return Store.getCoins(); },
    startEditor: startEditor, playCustom: playCustom,
    dims: function () { return { W: W, H: H, groundY: groundY, dpr: dpr }; },
    metrics: function () { return { mode: mode, wave: wave, score: score, level: level }; },
    toast: function (t) { UI.toast(t); },
    requestFullscreenLandscape: requestFullscreenLandscape
  };
})();
