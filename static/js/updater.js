/* ============================================================
   updater.js —— 应用内检查更新（状态机版）
   状态只有五个：idle / checking / downloading / switching / failed
   规则：
     · 所有异步分支 finally 复位（inFlight / 中间态）
     · fetch 一律 8 秒超时（AbortController）
     · disabled 时必须写清在做什么，不许静默变灰
     · hasUpdate 三处写回 false（已是最新 / 切换成功 / 拉取失败）
   ============================================================ */
(function () {
  "use strict";
  var A = window.Aura;
  if (!A) return;

  /* 当前 APK 版本（与 configVersion 无关，各自单一来源） */
  var CURRENT = "1.0.21";
  var TIMEOUT_MS = 8000;

  var MANIFESTS = [
    "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json",
    "https://gone-zr.github.io/aura-companion/downloads/latest.json",
    "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json"
  ];

  var STATE = { IDLE: "idle", CHECKING: "checking", DOWNLOADING: "downloading", SWITCHING: "switching", FAILED: "failed" };

  var state = STATE.IDLE;
  var lastError = null;          /* { kind, text } */
  var hasUpdate = false;
  var latest = null;
  var inFlight = false;
  var progress = 0;
  var dismissUntil = 0;
  var errorVisible = false;      /* 用户主动检查失败 → 显示“重试”条；后台静默失败 → 不显示 */

  /* ---------------- 版本比较：只读 manifest.version 一个字段 ---------------- */
  function appVersionOf(m) {
    return m && typeof m.version === "string" ? m.version : "";
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

  function manifestList() {
    var custom = A.store.getStr("aura_update_url", "");
    /* 用户显式指定了更新源就只认它（不再和内置通道混着试，避免"永远有新版"） */
    return custom ? [custom] : MANIFESTS;
  }

  /* ---------------- 带 8 秒超时的 fetch ---------------- */
  function fetchJSON(url) {
    var ctl = (typeof AbortController !== "undefined") ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, TIMEOUT_MS);
    var p = fetch(url, { cache: "no-store", signal: ctl ? ctl.signal : undefined })
      .then(function (r) {
        if (!r.ok) { var e = new Error("http " + r.status); e.kind = (r.status === 404) ? "bad-source" : "network"; throw e; }
        return r.json();
      })
      .then(function (m) { clearTimeout(timer); return m; })
      .catch(function (e) {
        clearTimeout(timer);
        if (e && e.name === "AbortError") { var t = new Error("timeout"); t.kind = "timeout"; throw t; }
        throw e;
      });
    return p;
  }

  /* ---------------- 检查：三种失败分开 ---------------- */
  function check() {
    var list = manifestList();
    var got = [];
    var errors = [];
    return Promise.all(list.map(function (u) {
      return fetchJSON(u)
        .then(function (m) { if (m && appVersionOf(m)) got.push(m); else { var e = new Error("bad-manifest"); e.kind = "bad-source"; errors.push(e); } })
        .catch(function (e) { errors.push(e); });
    })).then(function () {
      if (!got.length) {
        var kinds = errors.map(function (e) { return e.kind; });
        var kind = "network";
        if (kinds.length && kinds.every(function (k) { return k === "bad-source"; })) kind = "bad-source";
        else if (kinds.indexOf("timeout") >= 0) kind = "timeout";
        var err = new Error(kind === "bad-source" ? "更新源配置有误"
          : kind === "timeout" ? "连接超时，请检查网络"
            : "无法连接到更新服务器");
        err.kind = kind;
        throw err;
      }
      got.sort(function (a, b) { return cmpVer(appVersionOf(b), appVersionOf(a)); });
      var best = got[0];
      if (cmpVer(appVersionOf(best), CURRENT) <= 0) {
        hasUpdate = false; latest = null;      /* ① 已是最新 → 写回 false */
        renderBar();
        return null;
      }
      hasUpdate = true; latest = best;
      return best;
    });
  }

  /* ---------------- 渲染：只读 hasUpdate + state ---------------- */
  function el(id) { return document.getElementById(id); }

  function renderBar() {
    var bar = el("update-bar");
    var btn = el("ub-update");
    var txt = bar ? bar.querySelector(".ub-text") : null;
    if (!bar) return;

    /* 可见性：检查中不显示（避免和 toast 重复）；
       下载/切换必须显示，否则百分比没地方放；失败条只在用户主动检查时显示 */
    var show = false;
    if (state === STATE.FAILED && errorVisible) show = true;
    else if (state === STATE.DOWNLOADING || state === STATE.SWITCHING) show = true;
    else if (hasUpdate === true && state === STATE.IDLE) show = true;
    bar.hidden = !show;
    if (!show) {
      if (btn) { btn.textContent = "现在更新"; btn.disabled = false; }
      return;
    }

    if (txt) {
      txt.textContent = state === STATE.FAILED && lastError
        ? lastError.text
        : state === STATE.DOWNLOADING ? "正在下载新版 v" + appVersionOf(latest)
          : state === STATE.SWITCHING ? "下载完成，正在切换…"
            : "有新版 v" + appVersionOf(latest);
    }
    if (btn) {
      btn.disabled = (state === STATE.SWITCHING);
      if (state === STATE.FAILED) btn.textContent = "重试";
      else if (state === STATE.SWITCHING) btn.textContent = "正在切换…";
      else if (state === STATE.DOWNLOADING) btn.textContent = "下载中 " + progress + "%";
      else btn.textContent = "现在更新";
    }
  }

  /* ---------------- 失败处理 ---------------- */
  function fail(e, silent) {
    var kind = (e && e.kind) || "network";
    var text = kind === "bad-source" ? "更新源配置有误"
      : kind === "timeout" ? "连接超时，请检查网络"
        : "无法连接到更新服务器";
    if (e && e.name === "AbortError") text = "连接超时，请检查网络";
    lastError = { kind: kind, text: text };
    state = STATE.FAILED;
    /* ② 拉取失败不沿用上次的 hasUpdate：不再提示更新 */
    hasUpdate = false;
    errorVisible = !silent;
    renderBar();
    if (!silent && A.ui && A.ui.toast) A.ui.toast(text);
  }

  /* ---------------- 主流程 ---------------- */
  function startCheck(silent) {
    if (inFlight) return Promise.resolve(null);      /* 防连点 */
    inFlight = true;
    state = STATE.CHECKING;
    lastError = null;
    progress = 0;
    errorVisible = false;
    if (!silent && A.ui && A.ui.toast) A.ui.toast("正在检查更新…");
    return check()
      .then(function (m) {
        state = STATE.IDLE;
        renderBar();
        return m;
      })
      .catch(function (e) { fail(e, silent); return null; })
      .finally(function () { inFlight = false; });   /* 所有分支统一复位 */
  }

  function apkUrl(m) {
    /* 自定义源可以直接给绝对地址（本地/自建服务器），否则走固定的 gh-proxy 路径 */
    if (m && typeof m.url === "string" && /^https?:\/\//i.test(m.url)) return m.url;
    var name = (m && m.apk) || "aura-companion.apk";
    return "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/" + name;
  }

  function isNative() {
    return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  }

  /* APK：WebView 里装不了 blob，交给系统浏览器（有明确文案，不静默） */
  function handOff(m) {
    state = STATE.SWITCHING;
    renderBar();
    var url = apkUrl(m);
    try { location.href = url; } catch (e) { console.warn("[update] 打开浏览器失败", e); }
    setTimeout(function () {
      hasUpdate = false;          /* ③ 切换成功后写回 false：banner 不再常驻 */
      latest = null;
      state = STATE.IDLE;
      renderBar();
    }, 1500);
  }

  /* 浏览器 / 桌面：真下载，带百分比 */
  function startDownload(m) {
    if (state === STATE.DOWNLOADING || state === STATE.SWITCHING) return;
    if (isNative()) { handOff(m); return; }
    state = STATE.DOWNLOADING;
    progress = 0;
    renderBar();

    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", apkUrl(m), true);
      xhr.responseType = "blob";
      xhr.timeout = 120000;
      xhr.onprogress = function (e) {
        if (e.lengthComputable) { progress = Math.max(1, Math.round(e.loaded / e.total * 100)); renderBar(); }
      };
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) { resolve(xhr.response); return; }
        var err = new Error("http " + xhr.status);
        err.kind = (xhr.status === 404) ? "bad-source" : "network";
        reject(err);
      };
      xhr.onerror = function () { var e = new Error("net"); e.kind = "network"; reject(e); };
      xhr.ontimeout = function () { var e = new Error("timeout"); e.kind = "timeout"; reject(e); };
      xhr.send();
    }).then(function (blob) {
      state = STATE.SWITCHING;
      progress = 100;
      renderBar();
      try {
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (m && m.apk) || "aura-companion.apk";
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 15000);
      } catch (e) { console.warn("[update] 触发下载失败", e); }
      setTimeout(function () {
        hasUpdate = false;        /* ③ 切换成功后写回 false */
        latest = null;
        state = STATE.IDLE;
        renderBar();
      }, 1500);
    }).catch(function (e) {
      fail(e);
    }).finally(function () {
      /* 兜底：没有落到 failed / switching 的话，不许卡在中间态 */
      if (state === STATE.DOWNLOADING) fail({ kind: "network" });
    });
  }

  /* 按钮唯一入口：按状态决定做什么 */
  function onPrimaryClick() {
    if (inFlight) return;
    if (state === STATE.FAILED) { startCheck(); return; }
    if (!latest) { startCheck(); return; }
    startDownload(latest);
  }

  function dismiss() {
    hasUpdate = false;
    dismissUntil = Date.now() + 6 * 3600 * 1000;   /* 这次先不看 */
    renderBar();
  }

  function init() {
    /* 网页端有 SW，交给 SW；这里只管 APK / 无 SW 环境 */
    var hasSW = "serviceWorker" in navigator && location.protocol !== "file:" && !isNative();
    if (hasSW) return;
    startCheck(true);          /* 启动时静默检查：失败不要弹 toast 骚扰 */
    setInterval(function () {
      if (Date.now() < dismissUntil) return;
      startCheck(true);
    }, 30 * 60 * 1000);
  }

  A.updater = {
    CURRENT: CURRENT,
    STATE: STATE,
    check: check,
    init: init,
    startCheck: startCheck,
    onPrimaryClick: onPrimaryClick,
    dismiss: dismiss,
    renderBar: renderBar,
    manifestUrl: function () { return manifestList()[0]; },
    appVersionOf: appVersionOf,
    cmpVer: cmpVer,
    /* 只给测试读 */
    _state: function () { return { state: state, hasUpdate: hasUpdate, latest: latest, inFlight: inFlight, lastError: lastError, progress: progress }; }
  };
})();
