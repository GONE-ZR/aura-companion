/* ============================================================
   emotion-ui.js —— 五通道映射（任务书 §七 L1）

   通道：表情 / 姿态 / 背景 / 气泡 / 打字节奏
   允许轻微错位（嘴上说没事、背景已变灰）—— 这是真实感来源，不要强行同步。

   表情走已有的 Aura.expr（expressions.js 的 9 张脸），
   其余四通道由 body[data-*] + CSS 过渡实现（600–1200ms）。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraEmotionUI = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var EASE_MS = 900;                 /* 600–1200 之间 */
  var current = { e: "calm", b: "warm", i: 0 };

  /* 状态 → 五通道（§七 表） */
  function channelsFor(state, intensity) {
    var i = typeof intensity === "number" ? intensity : 1;
    switch (state) {
      case "tired":
      case "low":
        return { face: "tired", pose: "shrink", bg: "gray", bubble: "terse", rhythm: "slow" };
      case "sulky":
        return { face: i >= 2 ? "sulky" : "tease", pose: "arms", bg: "dusk", bubble: "prickly", rhythm: "fast" };
      case "serious":
        return { face: "serious", pose: "upright", bg: "cool", bubble: "clipped", rhythm: "steady" };
      case "blank":
        return { face: "blank", pose: "formal", bg: "gray", bubble: "plain", rhythm: "flat" };
      case "soft":
        return { face: "soft", pose: "front", bg: "warm", bubble: "normal", rhythm: "normal" };
      default:
        return { face: i >= 2 ? "smile" : "calm", pose: "front", bg: "warm", bubble: "normal", rhythm: "normal" };
    }
  }

  /* 打字节奏（ms）—— chat.js 的 thinkDelay 用它 */
  function rhythmDelay(state, base) {
    var b = typeof base === "number" ? base : 320;
    switch (state) {
      case "tired": return Math.round(b * 1.9);
      case "low": return Math.round(b * 2.1);
      case "sulky": return Math.round(b * 0.6);
      case "serious": return Math.round(b * 1.2);
      case "blank": return Math.round(b * 1.0);
      default: return Math.round(b * 0.9);
    }
  }

  /* ---------------- 应用 ---------------- */
  function applyMeta(meta) {
    if (!meta) return;
    current.e = meta.e || current.e;
    current.b = meta.b || current.b;
    current.i = typeof meta.i === "number" ? meta.i : current.i;

    var body = document.body;
    if (!body) return;

    /* 表情：交给 expressions.js（非法键它自己会降级） */
    try {
      if (window.Aura && window.Aura.expr && window.Aura.expr.set) {
        window.Aura.expr.set(current.e, current.i);
      }
    } catch (e) { /* ignore */ }

    /* 背景 */
    body.setAttribute("data-bg", current.b);

    /* 姿态 / 气泡：由状态推（meta 里没有这两个键） */
    var ch = channelsFor(mapStateFromFace(current.e), current.i);
    body.setAttribute("data-pose", ch.pose);
    body.setAttribute("data-bubble", ch.bubble);
  }

  /* 表情键 → 状态（用于姿态/气泡；表情是模型给的，状态是我们自己的） */
  function mapStateFromFace(face) {
    switch (face) {
      case "tired": return "tired";
      case "sulky": case "tease": return "sulky";
      case "serious": return "serious";
      case "blank": return "blank";
      case "soft": case "smile": return "soft";
      default: return "calm";
    }
  }

  /* 由引擎状态直接驱动五通道（用户消息刚处理完时用） */
  function applyState(state, intensity) {
    var ch = channelsFor(state, intensity);
    var body = document.body;
    if (!body) return ch;
    body.setAttribute("data-bg", ch.bg);
    body.setAttribute("data-pose", ch.pose);
    body.setAttribute("data-bubble", ch.bubble);
    try {
      if (window.Aura && window.Aura.expr && window.Aura.expr.set) {
        window.Aura.expr.set(ch.face, typeof intensity === "number" ? intensity : 1);
      }
    } catch (e) { /* ignore */ }
    return ch;
  }

  /* 气泡节奏：把 N 条气泡按顺序慢慢吐出来（不是一次性刷完） */
  function bubbleSchedule(state, count) {
    var step = 380;
    if (state === "tired" || state === "low") step = 900;
    else if (state === "sulky") step = 220;
    else if (state === "serious") step = 520;
    else if (state === "blank") step = 460;
    return { step: step, count: count };
  }

  return {
    EASE_MS: EASE_MS,
    channelsFor: channelsFor,
    rhythmDelay: rhythmDelay,
    applyMeta: applyMeta,
    applyState: applyState,
    mapStateFromFace: mapStateFromFace,
    bubbleSchedule: bubbleSchedule,
    current: function () { return current; }
  };
});
