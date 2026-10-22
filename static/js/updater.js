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
  var CURRENT = "1.0.8";

  /* 清单地址：国内直连 raw 是被墙的，所以优先用加速通道。
     gh-proxy.com（实测 1.1 秒）→ GitHub Pages（自己的域名）→ raw（备用） */
  var MANIFESTS = [
    "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json",
    "https://gone-zr.github.io/aura-companion/downloads/latest.json",
    "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json"
  ];

  function manifestList() {
    var custom = A.store.getStr("aura_update_url", "");
    return custom ? [custom].concat(MANIFESTS) : MANIFESTS;
  }

  function manifestUrl() {
    return manifestList()[0];
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

  /* 依次试多个通道，第一个拿到的算 */
  function check() {
    var list = manifestList();
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var u = list[i++];
      return fetch(u, { cache: "no-store" })
        .then(function (r) {
          if (!r.ok) throw new Error("http " + r.status);
          return r.json();
        })
        .then(function (m) {
          if (!m || !m.version) throw new Error("bad manifest");
          if (cmpVer(m.version, CURRENT) <= 0) return null;   /* 已是最新 */
          m._source = u;
          return m;
        })
        .catch(function () { return next(); });
    }
    return next().catch(function () { return null; });
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
        /* 下载走能通的通道（gh-proxy 优先）。
           APK 的 WebView 里 window.open 常常被吞，所以先用它试，
           打不开就把地址交给系统浏览器（location.href 会被 Capacitor 拦下并外开）。 */
        var name = (m.apk || "aura-companion.apk");
        var url = "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/" + name;
        var native = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
        if (native) {
          /* Capacitor 会把"跳到外部网址"交给系统浏览器，浏览器负责下载+安装 */
          try { location.href = url; } catch (e) { }
          btn.textContent = "已交给浏览器…";
          setTimeout(function () { btn.textContent = "下载新版"; }, 4000);
          return;
        }
        var opened = null;
        try { opened = window.open(url, "_blank"); } catch (e) { opened = null; }
        if (!opened) {
          if (A.ui && A.ui.toast) A.ui.toast("没打开？复制这个地址到浏览器：" + url);
          try { window.prompt("下载地址（复制到浏览器打开）", url); } catch (e3) { }
        }
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
