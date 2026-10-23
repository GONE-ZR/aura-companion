/* ============================================================
   wave.js —— 顶部 2px 波动线（第七处 UI 授权 · 阶段六修正令）

   它不是仪表，是"她没藏住"：
     · 常驻 1px 淡墨直线（无起伏、无呼吸、无色）
     · 只有触发后的 2.4s 内才出现颜色与波形
     · 不提供任何可查询入口

   本版要点（修正令）：
     · 八色状态表（浅/深两套等效色，整体反相映射，不换族）
     · 顶部有全宽 banner 时**整体不挂载**（display:none + 停 rAF）
     · 分享钩子 waveHideForCapture / waveRestoreAfterCapture（幂等，不挂 UI）
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraWave = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var H = 4;                      /* 画布高：4px（w33 描边裁切修正后的授权值） */
  var DUR = 2400;                 /* 总时长 */
  var GROW_END = 700 / DUR;
  var HOLD_END = 1700 / DUR;
  var COOL_MS = 10 * 60 * 1000;
  var COOL_MAX = 3;
  var KEY_LOG = "aura_wave_log";
  var KEY_ON = "aura_wave";
  var BANNER_POLL = 600;          /* banner 轮询（只读布局，不做像素） */

  /* ---------------- 八色状态表（修正令 1.2 原值，不许另选） ---------------- */
  var PAL_LIGHT = {
    soft: "#C08A4A", smile: "#B8722A", calm: "#1A1A1A", low: "#5B6B7A",
    tired: "#857C8C", blank: "#6E7276", sulky: "#C9504A", serious: "#8E3B3B"
  };
  var PAL_DARK = {
    soft: "#D8A56B", smile: "#E09A4E", calm: "#F0EDE6", low: "#8FA1B2",
    tired: "#9C93A2", blank: "#8B8F93", sulky: "#D96761", serious: "#B85C5C"
  };

  /* 实测得到的“最小达标 alpha”（基准 0.70，0.05 递增；w6 表原文） */
  var ALPHA_LIGHT = {
    soft: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    smile: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    calm: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    low: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    tired: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    blank: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    sulky: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 },
    serious: { warm: 0.95, dusk: 0.95, cool: 0.95, gray: 0.95 }
  };
  var ALPHA_DARK = {
    soft: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    smile: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    calm: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    low: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    tired: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    blank: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    sulky: { warm: 0.70, dusk: 0.70, cool: 0.70, gray: 0.70 },
    serious: { warm: 0.75, dusk: 0.70, cool: 0.70, gray: 0.70 }
  };

  var canvas = null, ctx = null, wrapEl = null, cssW = 0, dpr = 1;
  var anim = null, animStart = 0, rafId = 0;
  var lastLayerId = null;
  var mounted = false, bannerOff = false, captureOff = false, pollTimer = 0;
  var rafCalls = 0;                 /* 只给测试读，不上界面 */
  var frames = 0, degraded = false, degTimer = 0;

  /* ---------------- 环境 ---------------- */
  function isDesktop() { return /Electron/i.test(navigator.userAgent || ""); }
  function reduced() { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } }
  function enabled() { try { return localStorage.getItem(KEY_ON) !== "0"; } catch (e) { return true; } }
  function darkBg() {
    var b = document.body;
    return b.getAttribute("data-night") === "1" || b.getAttribute("data-theme") === "dark";
  }
  function bgName() {
    var b = document.body.getAttribute("data-bg");
    return (b === "warm" || b === "dusk" || b === "cool" || b === "gray") ? b : "warm";
  }

  /* ---------------- 顶部 banner 检测（不硬编码“没填 Key”） ----------------
     判据：屏幕最上沿 1px 处最顶层的元素，既不是 #top 也不是波动线本身
           → 说明顶部被某个全宽提示条占了。
     新增 banner 无需改本模块。 */
  function bannerPresent() {
    try {
      var el = document.elementFromPoint(Math.max(1, Math.floor(window.innerWidth / 2)), 1);
      if (!el) return false;
      if (wrapEl && (el === wrapEl || wrapEl.contains(el))) return false;
      var top = document.getElementById("top") || document.querySelector(".top");
      if (top && (el === top || top.contains(el))) return false;
      /* 白名单：声明 data-wave-safe 的顶层装饰条不算 banner */
      if (el.closest && el.closest("[data-wave-safe]")) return false;
      /* 弹层/遮罩不算 banner（是否挂载由 overlayPresent 判） */
      var ovs = ["drawer", "sheet", "modal", "keygate", "scrim", "sheet-scrim", "modal-scrim", "review-page"];
      for (var i = 0; i < ovs.length; i++) {
        var o = document.getElementById(ovs[i]);
        if (o && (o === el || o.contains(el))) return false;
      }
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 只在主聊天页（弹层/半屏/全屏页面一律不挂） ---------------- */
  function isVisible(e) {
    if (!e || e.hidden) return false;
    var cs = getComputedStyle(e);
    if (cs.display === "none" || cs.visibility === "hidden" || Number(cs.opacity) < 0.05) return false;
    var r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }

  function overlayPresent() {
    try {
      var d = document.getElementById("drawer");
      if (d && d.getAttribute("aria-hidden") === "false") return true;
      var s = document.getElementById("sheet");
      if (s && s.getAttribute("aria-hidden") === "false") return true;
      var ids = ["modal", "keygate", "review-page", "onboarding"];
      for (var i = 0; i < ids.length; i++) {
        if (isVisible(document.getElementById(ids[i]))) return true;
      }
      var dialogs = document.querySelectorAll('[role="dialog"][aria-modal="true"]');
      for (var j = 0; j < dialogs.length; j++) {
        if (isVisible(dialogs[j])) return true;
      }
    } catch (e) { return false; }
    return false;
  }

  /* 异常形态：横屏 / 分屏 / 键盘顶起 / 取不到安全区 → 隐藏，不挤压元素 */
  function abnormalShape() {
    if (window.innerWidth > window.innerHeight) return true;              /* 横屏 */
    if (window.innerWidth < 280 || window.innerHeight < 480) return true;  /* 分屏窄条 / 键盘顶起 */
    if (window.visualViewport && window.innerHeight - window.visualViewport.height > 120) return true; /* 键盘 */
    return false;
  }

  function shouldHide() {
    return bannerOff || captureOff || abnormalShape() || overlayPresent();
  }

  /* ---------------- 冷却 ---------------- */
  function log() { try { return JSON.parse(localStorage.getItem(KEY_LOG) || "[]") || []; } catch (e) { return []; } }
  function saveLog(a) { try { localStorage.setItem(KEY_LOG, JSON.stringify(a.slice(-20))); } catch (e) { } }
  function cooling(now) { return log().filter(function (t) { return now - t < COOL_MS; }).length >= COOL_MAX; }
  function mark(now) {
    var a = log().filter(function (t) { return now - t < COOL_MS; });
    a.push(now); saveLog(a);
  }

  /* ---------------- 颜色 ---------------- */
  function colorFor(state, dark) {
    var pal = dark ? PAL_DARK : PAL_LIGHT;
    return pal[state] || (dark ? PAL_DARK.calm : PAL_LIGHT.calm);
  }
  function alphaFor(state, dark, bg) {
    var t = dark ? ALPHA_DARK : ALPHA_LIGHT;
    var row = t[state] || t.calm;
    return row[bg] || 0.70;
  }

  /* ---------------- 挂载 / 卸载 ---------------- */
  function build() {
    if (wrapEl) return;
    /* 低帧降级用的 3 帧关键帧（只在 <45fps 时挂） */
    if (!document.getElementById("wave-style")) {
      var st = document.createElement("style");
      st.id = "wave-style";
      st.textContent = "#wave-wrap.wave-lite canvas{animation:waveLite 2.4s linear 1}" +
        "@keyframes waveLite{0%{opacity:.15}33%{opacity:.85}66%{opacity:1}100%{opacity:.12}}" +
        /* 无障碍：淡入 150ms / 保持 800ms / 淡出 150ms = 1100ms */
        "#wave-wrap.wave-reduced canvas{animation:waveReduced 1.1s linear 1}" +
        "@keyframes waveReduced{0%{opacity:0}13.6%{opacity:1}86.4%{opacity:1}100%{opacity:0}}";
      document.head.appendChild(st);
    }
    wrapEl = document.createElement("div");
    wrapEl.id = "wave-wrap";
    wrapEl.setAttribute("aria-hidden", "true");
    wrapEl.style.cssText = [
      "position:fixed",
      "top:env(safe-area-inset-top,0px)",
      "left:env(safe-area-inset-left,0px)",
      "right:env(safe-area-inset-right,0px)",
      "height:" + H + "px",
      "pointer-events:none",
      "z-index:41",
      "overflow:hidden"
    ].join(";");

    canvas = document.createElement("canvas");
    canvas.id = "wave-line";
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText = "display:block;width:100%;height:" + H + "px";
    wrapEl.appendChild(canvas);
    document.body.appendChild(wrapEl);

    ctx = canvas.getContext("2d");
    resize();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("orientationchange", resize, { passive: true });
    mounted = true;
  }

  function resize() {
    if (!canvas) return;
    dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    cssW = canvas.clientWidth || window.innerWidth;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(H * dpr);
    ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawStatic();
  }

  function stopRaf() {
    if (rafId) { try { cancelAnimationFrame(rafId); } catch (e) { } rafId = 0; }
    anim = null;
  }

  /* 把画布彻底复位到静止态（换触发/关开关/钩子恢复都走这里） */
  function resetToStatic() {
    stopRaf();
    if (degTimer) { clearTimeout(degTimer); degTimer = 0; }
    if (wrapEl) wrapEl.classList.remove("wave-lite");
    degraded = false;
    frames = 0;
    if (ctx) ctx.clearRect(0, 0, cssW, H);
    drawStatic();
  }

  function applyVisibility() {
    if (!wrapEl) return;
    var hide = shouldHide();
    wrapEl.style.display = hide ? "none" : "block";
    canvas.style.display = hide ? "none" : "block";
    wrapEl.setAttribute("data-off", hide ? (bannerOff ? "banner" : captureOff ? "capture" : overlayPresent() ? "overlay" : "shape") : "");
    if (hide) stopRaf();
  }

  /* 统一同步：banner / 页面 / 异常形态 → 整体不挂载（不是被盖住，是不存在） */
  function sync() {
    if (isDesktop()) return;
    if (!wrapEl) build();
    var wasOff = bannerOff;
    bannerOff = bannerPresent();
    applyVisibility();
    if (wasOff && !bannerOff && !captureOff) { resize(); drawStatic(); }  /* 恢复挂载；不补播漏掉的波动 */
  }

  function startPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(sync, BANNER_POLL);
  }

  /* ---------------- 静止 ---------------- */
  function drawStatic() {
    if (!ctx || shouldHide()) return;
    ctx.clearRect(0, 0, cssW, H);
    var c = darkBg() ? "rgba(240,237,230,0.12)" : "rgba(26,26,26,0.10)";
    drawFlat(c, 1);
  }

  function drawFlat(color, width) {
    var g = ctx.createLinearGradient(0, 0, cssW, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.12, color);
    g.addColorStop(0.88, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(cssW, H / 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- 波形 ---------------- */
  function wavePath(opt) {
    var w = opt.w * opt.progress;
    var n = 220;
    /* 描边 1.5px 上下各外溢 0.75px：峰值中心最多只能到 H/2 - 0.75，
       否则峰顶会被画布边界切平（w33）。这里按“描边留白”整体缩放振幅与基线弧。 */
    var half = H / 2;
    var maxOff = half - 0.75;
    var need = opt.amp / 2 + Math.abs(opt.baseCurve);
    var scale = need > maxOff ? (maxOff / need) : 1;
    var amp = opt.amp * scale;
    var curve = opt.baseCurve * scale;
    ctx.beginPath();
    for (var i = 0; i <= n; i++) {
      var t = i / n;
      var x = t * w;
      var y = half + curve;
      var ph = t * opt.peaks;
      var frac = ph - Math.floor(ph);
      if (frac > 0.42 && frac < 0.72) {
        var u = (frac - 0.42) / 0.30;
        y -= (amp / 2) * Math.sin(u * Math.PI);
      }
      if (frac > 0.22 && frac < 0.42) {
        var u2 = (frac - 0.22) / 0.20;
        y += 0.25 * scale * Math.sin(u2 * Math.PI);
      }
      y += Math.sin(i * 1.7 + opt.jitter) * 0.3 * (amp / 2);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
  }

  function drawFrame(now) {
    if (bannerOff || captureOff || shouldHide()) { anim = null; rafId = 0; return; }
    var t = now - animStart;
    var p = Math.min(1, t / DUR);
    var a = anim;
    frames += 1;
    ctx.clearRect(0, 0, cssW, H);

    var colorAlpha;
    if (p < GROW_END) colorAlpha = p / GROW_END;
    else if (p < HOLD_END) colorAlpha = 1;
    else colorAlpha = Math.max(0, 1 - (p - HOLD_END) / (1 - HOLD_END));

    var grow = p < GROW_END ? Math.max(0.02, p / GROW_END) : 1;
    var g = ctx.createLinearGradient(0, 0, cssW, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.12, a.color);
    g.addColorStop(0.88, a.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = g;
    ctx.globalAlpha = Math.max(0.12, a.alpha * colorAlpha);
    wavePath({ w: cssW, amp: a.amp, peaks: a.peaks, jitter: a.jitter, baseCurve: a.baseCurve, progress: grow });
    ctx.stroke();
    ctx.restore();

    /* 低帧降级：前 0.9s 平均 <45fps → 改走 3 帧 CSS 关键帧 */
    if (!degraded && t > 900) {
      var fpsNow = frames / (t / 1000);
      if (fpsNow < 45) { degrade(a); return; }
    }

    if (p < 1) {
      rafCalls += 1;
      rafId = requestAnimationFrame(drawFrame);
    } else {
      anim = null; rafId = 0;
      drawStatic();
    }
  }

  /* 降级：画一张完整波形，交给 CSS 3 帧淡入淡出（不再 rAF） */
  function degrade(a) {
    degraded = true;
    stopRaf();
    ctx.clearRect(0, 0, cssW, H);
    var g = ctx.createLinearGradient(0, 0, cssW, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.12, a.color);
    g.addColorStop(0.88, a.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.lineWidth = 1.5; ctx.lineCap = "round"; ctx.strokeStyle = g; ctx.globalAlpha = a.alpha;
    wavePath({ w: cssW, amp: a.amp, peaks: a.peaks, jitter: a.jitter, baseCurve: a.baseCurve, progress: 1 });
    ctx.stroke();
    ctx.restore();
    wrapEl.classList.add("wave-lite");
    degTimer = setTimeout(function () {
      degTimer = 0;
      if (wrapEl) wrapEl.classList.remove("wave-lite");
      degraded = false;
      drawStatic();
    }, DUR);
  }

  /* ---------------- 振幅（钳制顺序固定） ---------------- */
  function amplitude(intensity, isConceal) {
    var amp = 1 + Math.max(0, Math.min(1, intensity)) * 2.0;   /* 1~3px */
    amp = Math.max(1, Math.min(3, amp));
    if (isConceal) amp += 0.5;
    amp = Math.max(1, Math.min(3, amp));
    return Math.min(amp, H);
  }

  /* 实际画出来的振幅（扣掉描边留白后的值，供 w23 打印） */
  function drawnOf(a) {
    var maxOff = H / 2 - 0.75;
    var need = a.amp / 2 + Math.abs(a.baseCurve);
    var s = need > maxOff ? maxOff / need : 1;
    return +(a.amp * s).toFixed(2);
  }

  /* ---------------- 触发 ---------------- */
  function maybe(input) {
    input = input || {};
    if (!enabled()) return { fired: false, reason: "off" };
    if (isDesktop()) return { fired: false, reason: "desktop" };
    if (!wrapEl) build();
    sync();
    if (bannerOff) return { fired: false, reason: "banner" };     /* 不消耗冷却 */
    if (captureOff) return { fired: false, reason: "capture" };
    if (input.safety) return { fired: false, reason: "safety" };
    if (input.first) return { fired: false, reason: "first" };
    if (input.offline) return { fired: false, reason: "offline" };
    if (document.hidden) return { fired: false, reason: "hidden" };
    if (!input.layerId || input.layerId === lastLayerId) return { fired: false, reason: "same-round" };

    var now = Date.now();
    if (cooling(now)) return { fired: false, reason: "cooldown" };

    var v = Number(input.valence || 0);
    var a = Number(input.arousal || 0);
    var intent = input.intent || "express";
    var d = Math.abs(Number(input.delta || 0));
    var newResidue = Number(input.newResidue || 0);
    var state = input.state || "calm";

    var hit = d >= 0.08 || newResidue >= 0.15 || intent === "conceal" || !!input.tierCross;
    if (!hit) return { fired: false, reason: "below-threshold" };

    lastLayerId = input.layerId;
    mark(now);
    resetToStatic();          /* 先清掉上一轮残留（含降级类、旧 rAF） */
    rafCalls = 0;

    var dark = darkBg();
    var bg = bgName();
    var isConceal = intent === "conceal";
    var inten = Math.max(d / 0.15, newResidue, isConceal ? 0.6 : 0);
    var amp = amplitude(inten, isConceal);

    anim = {
      color: colorFor(state, dark),
      alpha: alphaFor(state, dark, bg),
      amp: amp,
      peaks: a >= 0.4 ? 2 : 1,
      jitter: (input.residueId || String(now)).split("").reduce(function (s, c) { return s + c.charCodeAt(0); }, 0) % 97,
      baseCurve: v < 0 ? 0.5 : (v > 0 ? -0.5 : 0)
    };

    if (reduced()) {
      var snap = { color: anim.color, alpha: anim.alpha, peaks: anim.peaks };
      drawReduced(anim);
      return { fired: true, mode: "reduced", amp: amp, peaks: snap.peaks, color: snap.color, alpha: snap.alpha };
    }

    animStart = performance.now();
    rafCalls = 0;
    frames = 0;
    degraded = false;
    if (wrapEl) wrapEl.classList.remove("wave-lite");
    rafId = requestAnimationFrame(drawFrame);
    return { fired: true, amp: amp, drawnAmp: drawnOf(anim), peaks: anim.peaks, color: anim.color, alpha: anim.alpha };
  }

  function drawReduced(a) {
    ctx.clearRect(0, 0, cssW, H);
    var g = ctx.createLinearGradient(0, 0, cssW, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.12, a.color);
    g.addColorStop(0.88, a.color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    ctx.lineWidth = 1.5;
    ctx.lineCap = "round";
    ctx.strokeStyle = g;
    ctx.globalAlpha = 1;
    wavePath({ w: cssW, amp: a.amp, peaks: a.peaks, jitter: a.jitter, baseCurve: a.baseCurve, progress: 1 });
    ctx.stroke();
    ctx.restore();
    anim = null;                       /* 无障碍模式没有 rAF 动画 */
    if (wrapEl) {
      wrapEl.classList.remove("wave-reduced");
      void wrapEl.offsetWidth;         /* 重启动画 */
      wrapEl.classList.add("wave-reduced");
    }
    setTimeout(function () {
      if (wrapEl) wrapEl.classList.remove("wave-reduced");
      if (!shouldHide()) drawStatic();
    }, 1100);
  }

  /* ---------------- 分享钩子（幂等；不挂 UI、不建功能） ---------------- */
  function waveHideForCapture() {
    captureOff = true;
    stopRaf();
    applyVisibility();
    return true;
  }
  function waveRestoreAfterCapture() {
    captureOff = false;
    applyVisibility();
    if (!shouldHide()) { resize(); resetToStatic(); }   /* 只回静止，不回波动中途 */
    return true;
  }

  /* ---------------- 设置项绑定（唯一文案：她藏不住的时候） ---------------- */
  function bindUi() {
    var sw = document.getElementById("in-wave");
    if (!sw) return;
    function paint() { sw.setAttribute("aria-checked", enabled() ? "true" : "false"); }
    paint();
    if (sw.__waveBound) return;
    sw.__waveBound = true;
    sw.addEventListener("click", function () {
      var wasOn = enabled();
      try { localStorage.setItem(KEY_ON, wasOn ? "0" : "1"); } catch (e) { }
      paint();
      if (wasOn) { resetToStatic(); }   /* 关闭：熄灭颜色，只留静止淡线 */
      else { drawStatic(); }
    });
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    if (isDesktop()) return;
    build();
    bindUi();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { resetToStatic(); }
    });
    sync();
    startPoll();
  }

  /* 只给测试读（界面无任何入口） */
  function state() {
    return {
      enabled: enabled(), desktop: isDesktop(), reduced: reduced(), cooling: cooling(Date.now()),
      mounted: mounted && !shouldHide(), bannerOff: bannerOff, captureOff: captureOff, degraded: degraded,
      rafCalls: rafCalls, animating: !!(anim && rafId),
      reducedClass: wrapEl ? wrapEl.classList.contains("wave-reduced") : false
    };
  }

  /* 生产构建不暴露任何“可查询入口”：只有显式带 __AURA_WAVE_DEBUG__ 时才挂 state 与测试助手 */
  var api = {
    H: H, DUR: DUR,
    init: init, resize: resize, maybe: maybe, drawStatic: drawStatic,
    sync: sync,
    waveHideForCapture: waveHideForCapture,
    waveRestoreAfterCapture: waveRestoreAfterCapture
  };
  if (typeof window !== "undefined" && window.__AURA_WAVE_DEBUG__ === true) {
    api.state = state;
    api._colorFor = colorFor;
    api._alphaFor = alphaFor;
    api._amplitude = amplitude;
    api._palette = { light: PAL_LIGHT, dark: PAL_DARK };
    api._alphaTable = { light: ALPHA_LIGHT, dark: ALPHA_DARK };
  }
  return api;
});
