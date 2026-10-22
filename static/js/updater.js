/* ============================================================
   updater.js —— 应用内检查更新
   固定地址读 latest.json（raw.githubusercontent.com，不限流、可跨域）：
   → 手机上不用重新扫二维码，打开应用就能看到"有新版"，点一下就下
   ============================================================ */
(function () {
  "use strict";
  var A = window.Aura;
  if (!A) return;

  /* 当前版本 —— 每次发版记得改这里 */
  var CURRENT = "1.0.1";

  /* 默认清单地址（仓库里的 latest.json，随 Release 一起更新） */
  var DEFAULT_MANIFEST = "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json";

  function manifestUrl() {
    return A.store.getStr("aura_update_url", "") || DEFAULT_MANIFEST;
  }

  function cmpVer(a, b) {
    var pa = String(a || "0").split(".").map(Number);
    var pb = String(b || "0").split(".").map(Number);
    for (var i = 0; i < 3; i++) {
      var x = pa[i] || 0, y = pb[i] || 0;
      if (x > y) return 1;
      if (x < y) return -1;
    }
    return 0;
  }

  function check() {
    return fetch(manifestUrl(), { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (m) {
        if (!m || !m.version) throw new Error("bad manifest");
        if (cmpVer(m.version, CURRENT) <= 0) return null;   /* 已是最新 */
        return m;
      })
      .catch(function () { return null; });
  }

  function showBar(m) {
    var bar = document.getElementById("update-bar");
    var btn = document.getElementById("ub-update");
    if (!bar) return;
    var txt = bar.querySelector(".ub-text");
    if (txt) txt.textContent = "有新版 v" + m.version;
    if (btn) {
      btn.textContent = "下载新版";
      btn.onclick = function () {
        window.open(m.url || m.apk, "_blank");
      };
    }
    bar.hidden = false;
  }

  function init() {
    check().then(function (m) {
      if (m) showBar(m);
    });
    /* 每 30 分钟查一次 */
    setInterval(function () {
      check().then(function (m) { if (m) showBar(m); });
    }, 30 * 60 * 1000);
  }

  A.updater = {
    CURRENT: CURRENT,
    check: check,
    init: init,
    showBar: showBar,
    manifestUrl: manifestUrl,
    cmpVer: cmpVer
  };
})();
