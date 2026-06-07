// ---------------------------------------------------------------------------
// editor.js — global `Editor`: a touch-friendly level editor. Tap the lane to
// place enemies (type + position-as-width-fraction + auto delay), tap a marker
// to remove it, name + save to Store, or Test-play through the existing custom
// mode. Renders its own lane preview when Game.state === "editor".
// ---------------------------------------------------------------------------
"use strict";

const Editor = (function () {
  const TYPES = [
    { id: "archer",   label: "Archer",   color: "#7a2230" },
    { id: "runner",   label: "Runner",   color: "#b5603a" },
    { id: "fast",     label: "Fast",     color: "#c98a2a" },
    { id: "tank",     label: "Tank",     color: "#4a5a6a" },
    { id: "bomber",   label: "Bomber",   color: "#5a7a3a" },
    { id: "shielded", label: "Shielded", color: "#556070" }
  ];
  const COLORS = {};
  TYPES.forEach(function (t) { COLORS[t.id] = t.color; });

  let game = null;
  let current = { id: null, name: "", enemies: [] };
  let selType = "archer";
  let canvas = null;

  function $(id) { return document.getElementById(id); }

  function init(gameRef) {
    game = gameRef;
    canvas = $("game");
    // palette
    const pal = $("editorPalette");
    if (pal) {
      pal.innerHTML = "";
      TYPES.forEach(function (t) {
        const b = document.createElement("button");
        b.className = "pal-btn";
        b.textContent = t.label;
        b.dataset.type = t.id;
        b.style.borderColor = t.color;
        b.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); selectType(t.id); });
        pal.appendChild(b);
      });
    }
    bind("editorClear", function () { current.enemies = []; });
    bind("editorSave", save);
    bind("editorTest", test);
    bind("editorBack", close);
    // canvas placement (only acts while in editor state)
    canvas.addEventListener("pointerdown", onCanvas);
    selectType("archer");
  }

  function bind(id, fn) {
    const el = $(id);
    if (el) el.addEventListener("pointerdown", function (e) { e.stopPropagation(); e.preventDefault(); fn(); });
  }

  function selectType(id) {
    selType = id;
    const pal = $("editorPalette");
    if (pal) Array.prototype.forEach.call(pal.children, function (b) { b.classList.toggle("active", b.dataset.type === id); });
  }

  function open(id) {
    if (id) { const lv = Store.customGet(id); current = lv || { id: null, name: "", enemies: [] }; }
    else current = { id: null, name: "", enemies: [] };
    const nameInput = $("editorName");
    if (nameInput) nameInput.value = current.name || "";
    $("menu").classList.add("hidden");
    if ($("customPick")) $("customPick").classList.add("hidden");
    $("editor").classList.remove("hidden");
    game.startEditor();
  }
  function close() {
    $("editor").classList.add("hidden");
    game.quitToMenu();
  }

  function onCanvas(e) {
    if (game.state() !== "editor") return;
    if (e.target && e.target.closest && e.target.closest("button, input, .editor-bar")) return;
    const p = screenToVirtual(e.clientX, e.clientY);
    const d = game.dims();
    if (p.x < 0 || p.x > d.W) return;
    // remove a nearby marker, else add one
    let removed = false;
    for (let i = 0; i < current.enemies.length; i++) {
      const mx = current.enemies[i].xFrac * d.W;
      if (Math.abs(mx - p.x) < 26 && Math.abs(p.y - (d.groundY - 30)) < 70) { current.enemies.splice(i, 1); removed = true; break; }
    }
    if (!removed) {
      current.enemies.push({ type: selType, xFrac: clamp(p.x / d.W, 0.2, 0.98), delay: +(current.enemies.length * 0.7).toFixed(2) });
    }
  }

  function buildLevel() {
    const nameInput = $("editorName");
    current.name = (nameInput && nameInput.value.trim()) || "My Level";
    // normalize delays by current order so editing never leaves gaps/duplicates
    current.enemies.forEach(function (en, i) { en.delay = +(i * 0.7).toFixed(2); });
    return current;
  }
  function save() {
    if (!current.enemies.length) { game.toast("Place at least one enemy"); return; }
    const lv = buildLevel();
    current.id = Store.customSave(lv);
    game.toast("Saved “" + current.name + "”");
  }
  function test() {
    if (!current.enemies.length) { game.toast("Place at least one enemy"); return; }
    const lv = buildLevel();
    $("editor").classList.add("hidden");
    game.playCustom(JSON.parse(JSON.stringify(lv)));
  }

  function render(ctx) {
    const d = game.dims();
    const baseY = d.groundY;
    // lane guide
    ctx.strokeStyle = "rgba(0,0,0,.18)"; ctx.setLineDash([6, 8]); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, baseY - 60); ctx.lineTo(d.W, baseY - 60); ctx.stroke();
    ctx.setLineDash([]);
    // player position marker (left)
    ctx.fillStyle = "rgba(40,120,220,.85)";
    ctx.beginPath(); ctx.arc(Math.max(90, d.W * 0.1), baseY - 30, 9, 0, TAU); ctx.fill();
    ctx.fillStyle = "#1c1c22"; ctx.font = "700 13px system-ui,sans-serif"; ctx.textAlign = "center";
    ctx.fillText("YOU", Math.max(90, d.W * 0.1), baseY - 48);
    // markers
    current.enemies.forEach(function (en, i) {
      const x = en.xFrac * d.W, y = baseY - 30;
      ctx.fillStyle = COLORS[en.type] || "#7a2230";
      ctx.beginPath(); ctx.arc(x, y, 11, 0, TAU); ctx.fill();
      ctx.strokeStyle = "rgba(0,0,0,.3)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y + 11); ctx.lineTo(x, y + 26); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = "700 12px system-ui,sans-serif"; ctx.textAlign = "center";
      ctx.fillText((en.type[0] || "?").toUpperCase(), x, y + 4);
      ctx.fillStyle = "#1c1c22"; ctx.font = "600 11px system-ui,sans-serif";
      ctx.fillText(en.delay + "s", x, y + 40);
      // chargers ignore position — they always rush in from the right
      if (en.type === "runner" || en.type === "fast") {
        ctx.fillStyle = "rgba(28,28,34,.5)"; ctx.font = "700 13px system-ui,sans-serif";
        ctx.fillText("→ charges", x + 44, y + 4);
      }
    });
    ctx.textAlign = "left";
  }

  return { init: init, open: open, close: close, render: render, selectType: selectType };
})();
