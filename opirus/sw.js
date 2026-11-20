/* 오피러스 카세트 v1.0 — 서비스워커
   원칙: 네트워크 우선. 새 버전을 바로 받아 오고, 끊겼을 때만 저장해 둔 화면을 쓴다.
   · 앱 셸(HTML·CSS·JS·아이콘)만 캐시한다. 음원 파일은 기기 메모리에서만 다뤄 캐시하지 않는다.
   · 같은 출처(same-origin) GET 요청만 다룬다. */
var CACHE = "opirus-v1.0.1";
var SHELL = [
  "./",
  "./index.html",
  "./css/style.css?v=101",
  "./js/app.js?v=101",
  "./manifest.json",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: "reload" })).catch(function () {});
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;
  var scopePath = new URL(self.registration.scope).pathname;
  if (url.pathname.indexOf(scopePath) !== 0) return;

  e.respondWith(
    fetch(req, { cache: req.mode === "navigate" ? "no-cache" : "default" }).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy).catch(function () {}); });
      }
      return res;
    }).catch(function () {
      return caches.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        if (req.mode === "navigate") return caches.match("./index.html");
        return new Response("", { status: 504, statusText: "offline" });
      });
    })
  );
});
