// ---------------------------------------------------------------------------
// main.js — UI/DOM glue: menus, HUD (weapon bar / shield / mute), overlays,
// custom-level picker, bests, audio unlock, lifecycle + Capacitor hooks, boot.
// ---------------------------------------------------------------------------
"use strict";

const UI = (function () {
  const $ = function (id) { return document.getElementById(id); };
  let weaponBuilt = false;

  function showHud() { $("hud").classList.remove("hidden"); }
  function hideHud() { $("hud").classList.add("hidden"); }
  function showMenu() { $("menu").classList.remove("hidden"); renderBests(); }
  function hideScreens() {
    ["menu", "overlay", "howto", "customPick", "editor", "shop"].forEach(function (id) { $(id).classList.add("hidden"); });
  }

  function showOver(title, msg, buttons, opts) {
    opts = opts || {};
    $("overlayTitle").textContent = title;
    $("overlayMsg").textContent = msg || "";
    const badge = $("overlayBadge");
    if (opts.badge) { badge.textContent = opts.badge; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
    const bc = $("overlayButtons");
    bc.innerHTML = "";
    buttons.forEach(function (b) {
      const el = document.createElement("button");
      el.textContent = b.label;
      if (b.ghost) el.classList.add("ghost");
      el.addEventListener("click", function () { if (typeof Sound !== "undefined") Sound.play("click"); b.act(); });
      bc.appendChild(el);
    });
    $("overlay").classList.remove("hidden");
  }

  let toastTimer = null;
  function toast(text) {
    let el = $("toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = text;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1600);
  }

  function setStats(html) { $("stats").innerHTML = html; }
  function setHp(p) { $("playerHp").style.width = Math.max(0, p * 100) + "%"; }

  let lastCount = -1;
  function buildWeapons(snap) {
    const bar = $("weaponBar");
    bar.innerHTML = "";
    snap.list.forEach(function (w) {
      const b = document.createElement("button");
      b.className = "weapon-btn"; b.dataset.weapon = w.id;
      b.style.setProperty("--wc", w.color || "#c9a24a");
      b.innerHTML = "<span>" + w.icon + "</span><span class='wname'>" + w.name + "</span>";
      b.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); Game.selectWeapon(w.id); });
      bar.appendChild(b);
    });
    weaponBuilt = true; lastCount = snap.list.length;
  }
  function setWeapons(snap) {
    if (!weaponBuilt || lastCount !== snap.list.length) buildWeapons(snap);
    snap.list.forEach(function (w) {
      const b = document.querySelector('.weapon-btn[data-weapon="' + w.id + '"]');
      if (b) b.classList.toggle("active", w.id === snap.sel);
    });
  }
  function setShield(active, onCd) {
    const b = $("shieldBtn");
    b.classList.toggle("active", !!active);
    b.classList.toggle("cooldown", !!onCd && !active);
  }

  function renderBests() {
    const el = $("bests");
    if (typeof Store === "undefined") { el.innerHTML = ""; return; }
    const d = Store.all();
    const chips = [];
    chips.push("🪙 " + (d.coins | 0) + " coins");
    if (d.survival.bestWave) chips.push("Survival: Wave " + d.survival.bestWave + " · " + d.survival.bestScore + " pts");
    if (d.campaign.furthest) chips.push("Campaign: " + d.campaign.furthest + "/" + (typeof CAMPAIGN !== "undefined" ? CAMPAIGN.length : 7) + " cleared");
    if (d.duel.bestStreak) chips.push("Duel streak: " + d.duel.bestStreak);
    el.innerHTML = chips.map(function (c) { return "<span class='chip'>" + c + "</span>"; }).join("");
  }

  function showCustomPicker() {
    const list = $("customList");
    const items = (typeof Store !== "undefined") ? Store.customList() : [];
    if (!items.length) list.innerHTML = "<div class='custom-empty'>No custom levels yet. Make one in the Level Editor!</div>";
    else {
      list.innerHTML = "";
      items.forEach(function (it) {
        const row = document.createElement("div"); row.className = "custom-row";
        row.innerHTML = "<span class='cname'>" + escapeHtml(it.name) + "</span><span class='cmeta'>" + it.count + " enemies</span>";
        const play = mkBtn("Play", function () { hideScreens(); Game.playCustom(Store.customGet(it.id)); });
        const edit = mkBtn("Edit", function () { Editor.open(it.id); }); edit.classList.add("ghost");
        const del = mkBtn("✕", function () { Store.customDelete(it.id); showCustomPicker(); }); del.classList.add("ghost");
        row.appendChild(play); row.appendChild(edit); row.appendChild(del);
        list.appendChild(row);
      });
    }
    hideScreens(); $("customPick").classList.remove("hidden");
  }
  function mkBtn(label, fn) {
    const b = document.createElement("button"); b.textContent = label;
    b.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); if (typeof Sound !== "undefined") Sound.play("click"); fn(); });
    return b;
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  function updateMute() { $("muteBtn").textContent = (typeof Sound !== "undefined" && Sound.isMuted()) ? "🔇" : "🔊"; }

  return {
    showHud: showHud, hideHud: hideHud, showMenu: showMenu, hideScreens: hideScreens,
    showOver: showOver, toast: toast, setStats: setStats, setHp: setHp,
    setWeapons: setWeapons, setShield: setShield, renderBests: renderBests,
    showCustomPicker: showCustomPicker, updateMute: updateMute
  };
})();

window.addEventListener("DOMContentLoaded", function () {
  if (typeof Sound !== "undefined") Sound.init();
  Game.init();
  if (typeof Editor !== "undefined") Editor.init(Game);
  if (typeof Shop !== "undefined") Shop.init(Game);
  UI.updateMute();
  UI.renderBests();

  function unlock() { if (typeof Sound !== "undefined") Sound.unlock(); }

  // mode buttons
  document.querySelectorAll("#menu [data-mode]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      unlock();
      if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) Game.requestFullscreenLandscape();
      Game.startMode(btn.dataset.mode);
    });
  });
  document.getElementById("shopBtn").addEventListener("click", function () { unlock(); Shop.open(); });
  document.getElementById("playCustomBtn").addEventListener("click", function () { unlock(); UI.showCustomPicker(); });
  document.getElementById("editorBtn").addEventListener("click", function () { unlock(); Editor.open(); });
  document.getElementById("howtoBtn").addEventListener("click", function () { document.getElementById("howto").classList.remove("hidden"); });
  document.getElementById("howtoClose").addEventListener("click", function () { document.getElementById("howto").classList.add("hidden"); });
  document.getElementById("customNew").addEventListener("click", function () { Editor.open(); });
  document.getElementById("customBack").addEventListener("click", function () { UI.hideScreens(); UI.showMenu(); });

  document.getElementById("pauseBtn").addEventListener("click", function () { Game.pause(); });
  document.getElementById("muteBtn").addEventListener("click", function () {
    unlock(); if (typeof Sound !== "undefined") Sound.toggleMuted(); UI.updateMute();
  });
  document.getElementById("shieldBtn").addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); Game.raiseShield(); });

  // keyboard
  window.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "p" || e.key === "P") && Game.isPlaying()) { Game.pause(); return; }
    if (!Game.isPlaying()) return;
    const i = "123456789".indexOf(e.key);
    if (i >= 0) { const list = Game.getWeapons().list; if (i < list.length) Game.selectWeapon(list[i].id); }
    if (e.key === "q" || e.key === "Q" || e.key === "Shift") Game.raiseShield();
  });

  // first-gesture audio unlock fallback
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });

  // (auto-pause on background is wired once in game.js setupLifecycle)

  // Capacitor native shell: back button + status bar (guarded; no imports)
  if (window.Capacitor && Capacitor.Plugins) {
    const App = Capacitor.Plugins.App, SB = Capacitor.Plugins.StatusBar;
    if (SB) { try { SB.setOverlaysWebView({ overlay: true }); SB.setStyle({ style: "DARK" }); } catch (e) {} }
    if (App) App.addListener("backButton", function () {
      if (Game.isPlaying()) Game.pause();
      else if (document.getElementById("menu").classList.contains("hidden")) Game.quitToMenu();
      else App.exitApp();
    });
  }
});
