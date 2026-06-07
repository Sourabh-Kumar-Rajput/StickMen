// ---------------------------------------------------------------------------
// storage.js — global `Store`: localStorage-backed persistence with a try/catch
// wrapper that degrades to an in-memory object (Safari private mode, file://
// quota blocks, Capacitor). Holds per-mode bests, settings, and custom levels.
// Everything lives under one namespaced JSON blob.
// ---------------------------------------------------------------------------
"use strict";

const Store = (function () {
  const KEY = "sa_save_v1";
  let mem = null;            // in-memory mirror
  let available = true;

  const DEFAULT = {
    survival: { bestWave: 0, bestScore: 0 },
    campaign: { furthest: 0, levels: {} },   // levels[idx] = { stars, bestHp }
    duel: { wins: 0, streak: 0, bestStreak: 0, fastestMs: 0 },
    settings: { biome: "grassland" },        // audio settings live in Sound
    custom: {},                              // id -> levelObj
    coins: 150,                              // a little starter cash for the shop
    ownedAmmo: { normal: true },             // bought ammo ids
    ownedBows: { training: true },           // bought bow ids
    equippedBow: "training"
  };

  function read() {
    if (mem) return mem;
    try {
      const raw = localStorage.getItem(KEY);
      mem = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT));
    } catch (e) {
      available = false;
      mem = JSON.parse(JSON.stringify(DEFAULT));
    }
    // backfill any missing top-level sections
    for (const k in DEFAULT) if (mem[k] == null) mem[k] = JSON.parse(JSON.stringify(DEFAULT[k]));
    // one-time coin top-up (applies even to an existing save)
    if (!mem.grant10k) { mem.coins = (mem.coins | 0) + 10000; mem.grant10k = true; try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) {} }
    return mem;
  }
  function write() {
    try { localStorage.setItem(KEY, JSON.stringify(mem)); return true; }
    catch (e) { available = false; return false; }
  }

  function get(key, fallback) { const d = read(); return d[key] != null ? d[key] : fallback; }
  function set(key, value) { const d = read(); d[key] = value; return write(); }
  function all() { return JSON.parse(JSON.stringify(read())); }

  function recordSurvival(wave, score) {
    const d = read(); const s = d.survival; const res = { bestWave: false, bestScore: false };
    if (wave > s.bestWave) { s.bestWave = wave; res.bestWave = true; }
    if (score > s.bestScore) { s.bestScore = score; res.bestScore = true; }
    write(); return res;
  }
  function recordCampaignLevel(levelIndex, stars, restHp) {
    const d = read(); const lv = d.campaign.levels;
    const prev = lv[levelIndex]; const res = { firstClear: !prev, moreStars: false };
    if (!prev) lv[levelIndex] = { stars: stars || 0, bestHp: restHp || 0 };
    else {
      if ((stars || 0) > prev.stars) { prev.stars = stars; res.moreStars = true; }
      if ((restHp || 0) > prev.bestHp) prev.bestHp = restHp;
    }
    write(); return res;
  }
  function recordCampaignFurthest(levelReachedIndex) {
    const d = read();
    if (levelReachedIndex > d.campaign.furthest) { d.campaign.furthest = levelReachedIndex; write(); return true; }
    return false;
  }
  function recordDuel(won, elapsedMs) {
    const d = read(); const du = d.duel; const res = { streak: du.streak, fastest: false };
    if (won) {
      du.wins++; du.streak++;
      if (du.streak > du.bestStreak) du.bestStreak = du.streak;
      if (elapsedMs && (du.fastestMs === 0 || elapsedMs < du.fastestMs)) { du.fastestMs = elapsedMs; res.fastest = true; }
    } else du.streak = 0;
    res.streak = du.streak; write(); return res;
  }

  function getSettings() { return JSON.parse(JSON.stringify(read().settings)); }
  function setSettings(partial) { const d = read(); Object.assign(d.settings, partial || {}); return write(); }

  // ---- economy / loadout ----
  function getCoins() { return read().coins | 0; }
  function addCoins(n) { const d = read(); d.coins = (d.coins | 0) + (n | 0); write(); return d.coins; }
  function spend(n) { n = Math.max(0, n | 0); const d = read(); if ((d.coins | 0) < n) return false; d.coins -= n; write(); return true; }
  function ownedAmmo() { return JSON.parse(JSON.stringify(read().ownedAmmo)); }
  function ownedBows() { return JSON.parse(JSON.stringify(read().ownedBows)); }
  function ownsAmmo(id) { return !!read().ownedAmmo[id]; }
  function ownsBow(id) { return !!read().ownedBows[id]; }
  function buyAmmo(id, price) { const d = read(); if (d.ownedAmmo[id]) return true; if (!spend(price)) return false; d.ownedAmmo[id] = true; write(); return true; }
  function buyBow(id, price) { const d = read(); if (d.ownedBows[id]) { d.equippedBow = id; write(); return true; } if (!spend(price)) return false; d.ownedBows[id] = true; d.equippedBow = id; write(); return true; }
  function equipBow(id) { const d = read(); if (!d.ownedBows[id]) return false; d.equippedBow = id; write(); return true; }
  function getEquippedBow() { return read().equippedBow || "training"; }

  // ---- custom levels ----
  function newId() { return "lvl_" + Date.now().toString(36) + "_" + Math.floor(Math.random() * 1e4).toString(36); }
  function customList() {
    const c = read().custom; const out = [];
    for (const id in c) out.push({ id: id, name: c[id].name || "Untitled", count: (c[id].enemies || []).length, updated: c[id].updated || 0 });
    out.sort(function (a, b) { return b.updated - a.updated; });
    return out;
  }
  function customGet(id) { const c = read().custom; return c[id] ? JSON.parse(JSON.stringify(c[id])) : null; }
  function customSave(level) {
    const d = read();
    if (!level.id) level.id = newId();
    level.updated = Date.now();
    d.custom[level.id] = JSON.parse(JSON.stringify(level));
    write(); return level.id;
  }
  function customDelete(id) { const d = read(); if (d.custom[id]) { delete d.custom[id]; write(); return true; } return false; }
  function customExport(id) { const l = customGet(id); return l ? JSON.stringify(l) : null; }
  function customImport(jsonString) {
    try {
      const l = JSON.parse(jsonString);
      if (!l || !Array.isArray(l.enemies) || l.enemies.length === 0 || l.enemies.length > 60) return null;
      // sanitize each entry so a malformed paste can't corrupt the save / break play
      l.enemies = l.enemies.filter(function (en) { return en && typeof en.type === "string"; }).map(function (en) {
        return { type: en.type, xFrac: clamp(typeof en.xFrac === "number" ? en.xFrac : 0.7, 0, 1), delay: Math.max(0, +en.delay || 0) };
      });
      if (!l.enemies.length) return null;
      l.name = typeof l.name === "string" ? l.name.slice(0, 24) : "Imported";
      l.id = null; return customSave(l);
    } catch (e) { return null; }
  }

  return {
    get available() { return available; },
    get: get, set: set, all: all,
    recordSurvival: recordSurvival, recordCampaignLevel: recordCampaignLevel,
    recordCampaignFurthest: recordCampaignFurthest, recordDuel: recordDuel,
    getSettings: getSettings, setSettings: setSettings,
    getCoins: getCoins, addCoins: addCoins, spend: spend,
    ownedAmmo: ownedAmmo, ownedBows: ownedBows, ownsAmmo: ownsAmmo, ownsBow: ownsBow,
    buyAmmo: buyAmmo, buyBow: buyBow, equipBow: equipBow, getEquippedBow: getEquippedBow,
    customList: customList, customGet: customGet, customSave: customSave,
    customDelete: customDelete, customExport: customExport, customImport: customImport
  };
})();
