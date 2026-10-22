/* ============================================================
   service-worker.js —— 更新机制（第 23 章）
   规则：
   a. SW 自身响应头 no-cache（Flask 侧已设）
   b. CACHE_NAME 带构建版本号
   c. install → skipWaiting()
   d. activate → clients.claim() + 清理所有旧缓存
   e. /api/ 一律 network-only
   f. HTML network-first + 缓存兜底；CSS/JS/图标 cache-first
   ============================================================ */

/* 版本号由后端在响应时注入（app.py 会把 __APP_VERSION__ 换成真实版本号）。
   ⚠️ 必须让 SW 文件的字节随部署变化 —— 浏览器是靠"SW 脚本字节变了"来判断
   要不要装新 SW 的。版本号写死的话，改了 CSS/JS 浏览器压根不知道有新版本，
   更新提示条永远不出现，缓存优先的 CSS/JS 也会一直是旧的。 */
var CACHE_NAME = "aura-__APP_VERSION__";

var PRECACHE = [
  "/",
  "/manifest.json",
  "/static/css/app.css",
  "/static/js/settings.js",
  "/static/js/mood.js",
  "/static/js/memory.js",
  "/static/js/chat.js",
  "/static/js/voice.js",
  "/static/js/wallpaper.js",
  "/static/js/weather.js",
  "/static/js/app.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon-180.png"
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      /* 单个资源失败不应让整次安装失败 */
      return Promise.all(PRECACHE.map(function (url) {
        return cache.add(new Request(url, { cache: "reload" })).catch(function () { return null; });
      }));
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE_NAME) return caches.delete(k);
        return null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;      /* 跨域（天气接口）不拦 */

  /* API 一律走网络，永不缓存 */
  if (url.pathname.indexOf("/api/") === 0) {
    event.respondWith(fetch(req));
    return;
  }

  /* HTML：网络优先，失败回落缓存 */
  if (req.mode === "navigate" || (req.headers.get("accept") || "").indexOf("text/html") !== -1) {
    event.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match("/");
        });
      })
    );
    return;
  }

  /* CSS / JS / 图标：缓存优先 */
  event.respondWith(
    caches.match(req).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (c) { c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
