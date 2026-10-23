/* ============================================================
   manga.js —— 漫画风 V0 · 日式日常系（结构层）

   做四件事：
     ① 把 #log 包进「两格」舞台（立绘格 60% + 对话格），格间 10px 白沟
     ② 每格加一层描边（SVG feTurbulence 抖动，scale 0.9），只抖边框不抖字
     ③ 状态 → 网点四档 + 立绘体量 + 拟声词（L1 得意黑）
     ④ 每条气泡只随机一次圆角与 ±1.5° 旋转（不每帧抖）

   不做（V0 范围外）：分镜切换、七态镜头、反应格、速度线、集中线、
   戳她/拖气泡/眨眼/呼吸、真立绘素材（这里用程序化色块剪影占位）。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraManga = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* 状态 → 网点档位（§3.4） */
  var DOTS = { calm: "8", soft: "8", tired: "15", low: "15", sulky: "8", serious: "30", blank: "0" };

  /* 拟声词（L1）：日常系要克制，用很轻的拟声，不用爆炸字 */
  var SFX = {
    calm: "…",          /* 安静 */
    soft: "呼",         /* 轻轻 */
    tired: "呼—",       /* 叹气 */
    low: "……",
    sulky: "哼",
    serious: "——",
    blank: ""
  };

  var stage = null;
  var artPanel = null;
  var logPanel = null;
  var sfxEl = null;
  var observer = null;

  function el(tag, cls) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    return e;
  }

  /* ---------------- 描边抖动用的 SVG filter ---------------- */
  function ensureFilter() {
    if (document.getElementById("manga-defs")) return;
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("id", "manga-defs");
    svg.setAttribute("width", "0");
    svg.setAttribute("height", "0");
    svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
    svg.innerHTML =
      '<filter id="ink-wobble" x="-6%" y="-6%" width="112%" height="112%">' +
      '<feTurbulence type="fractalNoise" baseFrequency="0.021" numOctaves="2" seed="7" result="noise"/>' +
      '<feDisplacementMap in="SourceGraphic" in2="noise" scale="0.9" xChannelSelector="R" yChannelSelector="G"/>' +
      "</filter>";
    document.body.appendChild(svg);
  }

  function makingPanel(kind) {
    var p = el("section", "panel panel-" + kind);
    var ink = el("div", "panel-ink");
    p.appendChild(ink);
    return p;
  }

  /* ---------------- 结构：把 #log 装进对话格 ---------------- */
  function buildStage() {
    if (stage) return;
    var log = document.getElementById("log");
    if (!log || !log.parentNode) return;

    stage = el("div");
    stage.id = "stage";

    artPanel = makingPanel("art");
    var fig = el("div", "art-figure");
    var fbody = el("i", "fig-body");
    var fhead = el("i", "fig-head");
    var fhair = el("i", "fig-hair");
    fig.appendChild(fbody);
    fig.appendChild(fhead);
    fig.appendChild(fhair);
    var b1 = el("div", "beta-1");   /* 纯黑块只留一处（头发那处已占一格） */
    sfxEl = el("div", "art-sfx");
    artPanel.appendChild(fig);
    artPanel.appendChild(b1);
    artPanel.appendChild(sfxEl);

    /* 反白字：全页只一处，字号仍是正文字号（§5） */
    var knock = el("div", "sfx-knock");
    knock.textContent = "静";
    knock.style.cssText = "position:absolute;left:10px;bottom:12px;z-index:4";
    artPanel.appendChild(knock);

    logPanel = makingPanel("log");
    log.parentNode.insertBefore(stage, log);
    stage.appendChild(artPanel);
    stage.appendChild(logPanel);
    logPanel.appendChild(log);            /* #log 保留原 id，别的模块不用改 */

    ensureFilter();
    observeMessages();
  }

  /* ---------------- 每条气泡只随机一次 ---------------- */
  function decorate(node) {
    if (!node || node.nodeType !== 1 || node.dataset.mangaDone) return;
    if (!node.classList || !node.classList.contains("msg")) return;
    node.dataset.mangaDone = "1";

    var b = node.querySelector(".bubble");
    if (!b) return;
    /* 四个角各自 8~16px，且互不相同 */
    var pool = [8, 9, 10, 11, 12, 13, 14, 15, 16];
    function pick(used) {
      for (var i = 0; i < 12; i++) {
        var v = pool[Math.floor(Math.random() * pool.length)];
        if (used.indexOf(v) === -1) return v;
      }
      return 12;
    }
    var used = [];
    ["--b1", "--b2", "--b3", "--b4"].forEach(function (k) {
      var v = pick(used);
      used.push(v);
      b.style.setProperty(k, v + "px");
    });
    /* 轻微旋转 ±1.5°，每条随机一次（写死在元素上，不每帧变） */
    var rot = (Math.random() * 3 - 1.5).toFixed(2);
    b.style.setProperty("--brot", rot + "deg");
  }

  function decorateAll() {
    var log = document.getElementById("log");
    if (!log) return;
    var nodes = log.querySelectorAll(".msg");
    for (var i = 0; i < nodes.length; i++) decorate(nodes[i]);
  }

  function observeMessages() {
    var log = document.getElementById("log");
    if (!log || observer) return;
    observer = new MutationObserver(function (records) {
      records.forEach(function (r) {
        if (r.addedNodes) {
          for (var i = 0; i < r.addedNodes.length; i++) decorate(r.addedNodes[i]);
        }
      });
    });
    observer.observe(log, { childList: true });
    decorateAll();
  }

  /* ---------------- 状态 ---------------- */
  function applyState(state) {
    var st = state || "calm";
    document.body.setAttribute("data-st", st);
    document.body.setAttribute("data-dots", DOTS[st] || "8");
    if (sfxEl) {
      var s = SFX[st] || "";
      sfxEl.textContent = s;
      sfxEl.style.display = s ? "block" : "none";
    }
  }

  function currentState() {
    try {
      if (window.Aura && window.Aura.chat && window.Aura.chat.engineState) {
        var s = window.Aura.chat.engineState();
        return (s && s.state) || "calm";
      }
    } catch (e) { }
    return "calm";
  }

  /* ---------------- 低端机降级：连续 2 秒 <45fps ---------------- */
  function watchFps() {
    var frames = 0;
    var t0 = performance.now();
    var lowSince = 0;
    function tick(now) {
      frames += 1;
      var dt = now - t0;
      if (dt >= 1000) {
        var fps = frames * 1000 / dt;
        if (fps < 45) {
          if (!lowSince) lowSince = now;
          else if (now - lowSince > 2000) {
            document.body.setAttribute("data-lite", "1");
            return;                      /* 降级后不再测 */
          }
        } else {
          lowSince = 0;
        }
        frames = 0;
        t0 = now;
      }
      requestAnimationFrame(tick);
    }
    if (window.requestAnimationFrame) requestAnimationFrame(tick);
  }

  function init() {
    if (!document.body.classList.contains("comic")) return;
    buildStage();
    applyState(currentState());
    setInterval(function () { applyState(currentState()); }, 1500);
    watchFps();
  }

  return {
    init: init,
    applyState: applyState,
    buildStage: buildStage,
    decorateAll: decorateAll,
    DOTS: DOTS,
    SFX: SFX
  };
});
