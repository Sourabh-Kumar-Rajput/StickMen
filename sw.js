// sw.js — cache-first service worker for offline play (browser/PWA only).
// IMPORTANT: bump CACHE whenever any asset below changes, or clients keep
// serving the old precached bundle forever (cache-first). Skipped on file://
// and inside Capacitor/Tauri (which bundle assets themselves).
const CACHE = "stickman-archers-v7";
const ASSETS = [
  "./", "./index.html", "./css/style.css",
  "./js/utils.js", "./js/ragdoll.js", "./js/stickman.js", "./js/weapons.js",
  "./js/arrow.js", "./js/archer.js", "./js/audio.js", "./js/storage.js",
  "./js/game.js", "./js/editor.js", "./js/shop.js", "./js/main.js",
  "./manifest.json", "./icons/icon-192.png", "./icons/icon-512.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(function (hit) {
      return hit || fetch(e.request).then(function (net) {
        const cp = net.clone();
        caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
        return net;
      }).catch(function () {
        // only fall back to the app shell for navigations, not asset misses
        return e.request.mode === "navigate" ? caches.match("./index.html") : Response.error();
      });
    })
  );
});
