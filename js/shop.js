// ---------------------------------------------------------------------------
// shop.js — global `Shop`: the Armory. Spend coins to buy + equip bows and
// unlock elemental arrows. Reads/writes `Store`; tells `Game` to refresh the
// loadout after a change. Loaded after game.js, before main.js.
// ---------------------------------------------------------------------------
"use strict";

const Shop = (function () {
  let game = null, tab = "bows";
  function $(id) { return document.getElementById(id); }

  function init(g) {
    game = g;
    $("shopTabBows").addEventListener("click", function () { tab = "bows"; render(); });
    $("shopTabArrows").addEventListener("click", function () { tab = "arrows"; render(); });
    $("shopBack").addEventListener("click", close);
  }

  function open() {
    tab = "bows";
    $("menu").classList.add("hidden");
    $("shop").classList.remove("hidden");
    render();
  }
  function close() { $("shop").classList.add("hidden"); if (typeof UI !== "undefined") UI.showMenu(); }

  function render() {
    $("shopCoins").textContent = Store.getCoins();
    $("shopTabBows").classList.toggle("active", tab === "bows");
    $("shopTabArrows").classList.toggle("active", tab === "arrows");
    const list = $("shopList");
    list.innerHTML = "";
    if (tab === "bows") BOW_ORDER.forEach(function (id) { list.appendChild(bowRow(BOWS[id])); });
    else AMMO_ORDER.forEach(function (id) { if (id !== "normal") list.appendChild(ammoRow(AMMO[id])); });
  }

  function makeRow(drawPrev, name, desc, stat, btn) {
    const row = document.createElement("div");
    row.className = "shop-row";
    const cv = document.createElement("canvas");
    cv.className = "shop-prev"; cv.width = 168; cv.height = 66;
    try { drawPrev(cv.getContext("2d"), cv.width, cv.height); } catch (e) {}
    row.appendChild(cv);
    const info = document.createElement("div");
    info.className = "shop-info";
    info.innerHTML = "<div class='shop-name'>" + name + "</div><div class='shop-desc'>" + desc + "</div><div class='shop-stat'>" + stat + "</div>";
    row.appendChild(info);
    row.appendChild(btn);
    return row;
  }
  function bowRow(b) {
    const owned = Store.ownsBow(b.id), equipped = Store.getEquippedBow() === b.id;
    const btn = document.createElement("button");
    if (equipped) { btn.textContent = "Equipped"; btn.disabled = true; btn.classList.add("owned"); }
    else if (owned) { btn.textContent = "Equip"; btn.onclick = function () { Store.equipBow(b.id); after(); }; }
    else { btn.textContent = "Buy " + b.price + "🪙"; btn.onclick = function () { tryBuy(function () { return Store.buyBow(b.id, b.price); }, btn); }; }
    return makeRow(function (g, w, h) { drawBowPreview(g, b, w, h); }, b.name, b.desc, "DMG ×" + b.damage.toFixed(1) + "  ·  Charge +" + Math.round(b.chargeBonus * 100) + "%", btn);
  }
  function ammoRow(a) {
    const owned = Store.ownsAmmo(a.id);
    const btn = document.createElement("button");
    if (owned) { btn.textContent = "Owned"; btn.disabled = true; btn.classList.add("owned"); }
    else { btn.textContent = "Buy " + a.price + "🪙"; btn.onclick = function () { tryBuy(function () { return Store.buyAmmo(a.id, a.price); }, btn); }; }
    return makeRow(function (g, w, h) { drawArrowPreview(g, a, w, h); }, a.name, a.desc, "DMG ×" + a.dmg.toFixed(1), btn);
  }

  // --- catalog previews (canvas) ---
  // A recurve stave: tip -> apex (grip) -> tip, with the ends curling back (recurve).
  function staveCurve(x0, x1, cy, amp) {
    const pts = [], N = 36;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = x0 + (x1 - x0) * t;
      let y = cy - Math.sin(Math.PI * t) * amp;
      if (t < 0.12) y += (0.12 - t) / 0.12 * amp * 0.55;   // left recurve hook
      if (t > 0.88) y += (t - 0.88) / 0.12 * amp * 0.55;   // right recurve hook
      pts.push({ x: x, y: y });
    }
    return pts;
  }
  function widthAt(t) { return 1.3 + (1 - Math.abs(t - 0.5) * 2) * 3.0; } // thick at grip, thin at tips
  function brush(g, pts, wfn, color, alpha, dy) {
    g.globalAlpha = alpha == null ? 1 : alpha; g.fillStyle = color;
    for (let i = 0; i < pts.length; i++) { g.beginPath(); g.arc(pts[i].x, pts[i].y + (dy || 0), wfn(i / (pts.length - 1)), 0, TAU); g.fill(); }
    g.globalAlpha = 1;
  }
  function catalogArrow(g, x0, x1, y, headCol) {
    g.strokeStyle = "#7a5a33"; g.lineWidth = 2; g.lineCap = "round";
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x1 - 7, y); g.stroke();
    g.fillStyle = "#cfd3da";
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 7, y - 3); g.lineTo(x0 + 10, y); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + 7, y + 3); g.lineTo(x0 + 10, y); g.closePath(); g.fill();
    g.fillStyle = headCol || "#c9cdd4";
    g.beginPath(); g.moveTo(x1, y); g.lineTo(x1 - 9, y - 4.5); g.lineTo(x1 - 9, y + 4.5); g.closePath(); g.fill();
  }
  function drawDragonPreview(g, b, W, H) {
    const spr = (typeof BowSprites !== "undefined") ? BowSprites.get("dragon") : null;
    if (spr) {
      const dh = H - 8, dw = dh * (spr.naturalWidth || 1) / (spr.naturalHeight || 1);
      g.drawImage(spr, (W - dw) / 2, (H - dh) / 2, dw, dh);
      return;
    }
    g.lineCap = "round"; g.lineJoin = "round";
    // vertical "C": head rears up at the top, tail curls at the bottom, the
    // scaled belly bulges left and the glowing string runs down the right.
    const y0 = 9, y1 = H - 9, cx = W * 0.46, amp = 15, N = 18, pts = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, y = y0 + (y1 - y0) * t;
      let x = cx - Math.sin(Math.PI * t) * amp;
      if (t < 0.13) x += (0.13 - t) / 0.13 * amp * 0.7;   // top recurve hook
      if (t > 0.87) x += (t - 0.87) / 0.13 * amp * 0.7;   // bottom recurve hook
      pts.push({ x: x, y: y });
    }
    drawDragonBow(g, pts, 1.7, { x: -1, y: 0 });           // spikes/scales face the outer (left) edge
    // glowing string, tip to tip (down the right)
    g.strokeStyle = "rgba(255,150,60,.8)"; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[N].x, pts[N].y); g.stroke();
    // a fiery arrow nocked on the string, pointing right
    catalogArrow(g, cx + 2, W - 8, H / 2, "#ff8a3b");
  }
  function drawBowPreview(g, b, W, H) {
    if (b.id === "dragon") { drawDragonPreview(g, b, W, H); return; }
    const cy = H * 0.55, x0 = 18, x1 = W - 14, midx = (x0 + x1) / 2, amp = H * 0.36;
    g.lineCap = "round"; g.lineJoin = "round";
    const pts = staveCurve(x0, x1, cy, amp);
    const apex = pts[Math.round(pts.length / 2)], mid = Math.round(pts.length / 2);
    const gripCol = shade(b.color, -0.72), wrapCol = shade(b.color, 0.20);   // dark leather + tan cord
    if (b.glow) brush(g, pts, function (t) { return widthAt(t) * 2.0; }, b.glow, 0.45);   // energy aura
    brush(g, pts, function (t) { return widthAt(t) + 1.3; }, "#120d08", 1);               // dark outline
    brush(g, pts, function (t) { return widthAt(t); }, b.color, 1);                        // wood / colored limb
    brush(g, pts, function (t) { return Math.max(0.6, widthAt(t) * 0.4); }, shade(b.color, 0.32), 0.85, -1.2); // grain sheen
    // dark wrapped nocks at the curled tips (+ a small tier accent)
    [pts[0], pts[pts.length - 1]].forEach(function (t) { g.fillStyle = gripCol; g.beginPath(); g.arc(t.x, t.y, 2.8, 0, TAU); g.fill(); });
    if (b.tip) { g.fillStyle = b.tip; g.beginPath(); g.arc(pts[0].x, pts[0].y, 1.2, 0, TAU); g.fill(); g.beginPath(); g.arc(pts[pts.length - 1].x, pts[pts.length - 1].y, 1.2, 0, TAU); g.fill(); }
    // string (chord, tip to tip)
    g.strokeStyle = "rgba(235,235,240,.8)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(pts[0].x, pts[0].y); g.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y); g.stroke();
    // tan cord wraps flanking the leather grip
    g.strokeStyle = wrapCol; g.lineWidth = 4.4;
    [mid - 4, mid + 4].forEach(function (i) { const p = pts[i]; g.beginPath(); g.moveTo(p.x, p.y - 4); g.lineTo(p.x, p.y + 4); g.stroke(); });
    // leather grip (dark) with a lighter inner sheen
    g.strokeStyle = gripCol; g.lineWidth = 7; g.beginPath(); g.moveTo(apex.x, apex.y - 6); g.lineTo(apex.x, apex.y + 7); g.stroke();
    g.strokeStyle = shade(gripCol, 0.18); g.lineWidth = 3.5; g.beginPath(); g.moveTo(apex.x, apex.y - 4); g.lineTo(apex.x, apex.y + 5); g.stroke();
    if (b.gem) {
      g.fillStyle = "#0e0a06"; g.beginPath(); g.arc(apex.x, apex.y, 4.2, 0, TAU); g.fill();
      g.fillStyle = b.gem; g.beginPath(); g.arc(apex.x, apex.y, 2.7, 0, TAU); g.fill();
      g.fillStyle = "rgba(255,255,255,.9)"; g.beginPath(); g.arc(apex.x - 1, apex.y - 1, 0.9, 0, TAU); g.fill();
    }
    catalogArrow(g, midx - 8, x1 - 2, cy, b.tip || b.energy);
  }
  function drawArrowPreview(g, a, W, H) {
    const accent = a.element === "none" ? null : (ELEM_COLOR[a.element] || null);
    const fake = new Arrow(0, 0, 1, 0, "player", { kind: a.kind, element: a.element, accent: accent, charge: 0.5 });
    fake.life = 12; fake.angle = 0; fake.trail = [];
    g.save(); g.translate(W * 0.56, H / 2); g.scale(2.5, 2.5); fake.draw(g); g.restore();
  }

  function tryBuy(fn, btn) {
    if (typeof Sound !== "undefined") Sound.unlock();
    if (fn()) { if (typeof Sound !== "undefined") Sound.play("levelComplete"); after(); }
    else { flash(btn, "Need more 🪙"); if (typeof Sound !== "undefined") Sound.play("click"); }
  }
  function after() { if (game && game.refreshLoadout) game.refreshLoadout(); render(); }
  function flash(btn, msg) {
    const old = btn.textContent; btn.textContent = msg; btn.classList.add("nope");
    setTimeout(function () { btn.textContent = old; btn.classList.remove("nope"); }, 900);
  }

  return { init: init, open: open, close: close };
})();
