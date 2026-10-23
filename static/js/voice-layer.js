/* ============================================================
   voice-layer.js —— B 份 §1：一个音色 + 三层语气 + 分段合成

   铁律
     · 只有一个音色（voiceId 固定），改的是 rate/pitch/停顿
     · 三层**整体替换**，不做加权平均
     · 数值永远不出现在界面
     · 撒娇：生气禁止、每月 ≤3、不因要求而撒、不加 bond

   导出
     engagement(inputs)            → 0~1
     tierOf(engagement)            → {name, rate, pitch}
     emotionOverride(core)         → null | {rate, pitch, maxChars, tail, volume, pauseMs}
     cuteGate(ctx)                 → {ok, reason}
     paramsFor(ctx)                → {layer, rate, pitch, volume, tail, pauseScale, maxChars}
     plan(text, params)            → [{text, rate, pitch, pauseAfter, tail, fadeMs}]
     cacheKey(text, voiceId, params)
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraVoiceLayer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var PITCH_MIN = 0.88, PITCH_MAX = 1.12;
  var RATE_MIN = 0.80, RATE_MAX = 1.12;
  var CUTE_MONTHLY_MAX = 3;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round3(v) { return Math.round(v * 1000) / 1000; }

  /* ---------------- 第一层：热情度 ---------------- */
  function engagement(input) {
    input = input || {};
    var bond = typeof input.bond === "number" ? input.bond : 0.3;
    var valence = typeof input.valence === "number" ? input.valence : 0;
    var ue = typeof input.userEngagement === "number" ? clamp(input.userEngagement, 0, 1) : 0.5;
    return clamp(0.5 * bond + 0.3 * ((valence + 1) / 2) + 0.2 * ue, 0, 1);
  }

  /* 用户投入度：最近 3 轮平均长度（相对历史）+ 问号数 + 间隔 */
  function userEngagement(input) {
    input = input || {};
    var lens = input.lastUserLengths || [];
    var avg = lens.length ? lens.reduce(function (a, b) { return a + b; }, 0) / lens.length : 0;
    var ref = input.historyAvgLen || 12;
    var lenScore = clamp(avg / Math.max(6, ref), 0, 1);

    var qs = input.lastUserQuestions || 0;
    var qScore = clamp(qs / 2, 0, 1);

    var gapMin = typeof input.gapMs === "number" ? input.gapMs / 60000 : 60;
    /* 越快回来越投入：≤2 分钟满分，>6 小时 0 */
    var gapScore = gapMin <= 2 ? 1 : clamp(1 - (gapMin - 2) / (6 * 60), 0, 1);

    return clamp((lenScore + qScore + gapScore) / 3, 0, 1);
  }

  function tierOf(e) {
    if (e > 0.7) return { name: "热", rate: 0.98, pitch: 1.03 };
    if (e > 0.5) return { name: "暖", rate: 0.95, pitch: 1.00 };
    if (e > 0.3) return { name: "平", rate: 0.93, pitch: 0.98 };
    return { name: "淡", rate: 0.90, pitch: 0.96 };
  }

  /* ---------------- 第二层：嘴硬（整体替换） ---------------- */
  function emotionOverride(core) {
    if (!core) return null;
    var v = core.valence, a = core.arousal;
    if (!(v < -0.2 && a >= 0.4)) return null;
    /* rate 0.97~1.02 随 arousal；pitch 0.98~1.02（不能太低，太低像委屈） */
    var t = clamp((a - 0.4) / 0.6, 0, 1);
    return {
      layer: "嘴硬",
      rate: round3(0.97 + t * 0.05),
      pitch: round3(0.98 + t * 0.04),
      volume: 0.95,
      tail: "fall",
      pauseMs: Math.round(80 + t * 40),    /* 80~120ms */
      maxChars: 10,
      noParticles: true
    };
  }

  /* ---------------- 第三层：撒娇（稀有） ---------------- */
  function cuteGate(ctx) {
    ctx = ctx || {};
    var core = ctx.core || {};
    var v = core.valence, bond = core.bond, a = core.arousal;
    if (v < -0.2) return { ok: false, reason: "生气/负效价时禁止" };
    if (!(bond >= 0.75)) return { ok: false, reason: "bond<0.75" };
    if (!(v >= 0.2)) return { ok: false, reason: "valence<+0.2" };
    if (a < 0.25) return { ok: false, reason: "唤醒太低，不像撒娇" };
    if (core.intent === "conceal" || core.intent === "probe") return { ok: false, reason: "隐藏/试探态禁止" };
    if (ctx.lastCuteTurn && ctx.turn - ctx.lastCuteTurn <= 1) return { ok: false, reason: "上一条刚撒过" };
    if ((ctx.cuteCountMonth || 0) >= CUTE_MONTHLY_MAX) return { ok: false, reason: "本月已达 3 次" };
    if (!ctx.event) return { ok: false, reason: "没有具体事件（禁止凭空撒娇）" };
    if (ctx.userAsked) return { ok: false, reason: "用户要求撒娇 → 拒绝" };
    return { ok: true, reason: null };
  }

  /* ---------------- 合成参数 ---------------- */
  function paramsFor(ctx) {
    ctx = ctx || {};
    var core = ctx.core || { valence: 0, arousal: 0.3, bond: 0.3 };
    var v = core.valence || 0, a = core.arousal || 0;

    /* 情绪覆盖优先（整体替换） */
    var ov = emotionOverride(core);
    if (ov) return ov;

    /* 撒娇 */
    var g = cuteGate(ctx);
    if (g.ok) {
      return {
        layer: "撒娇",
        rate: 0.95,          /* 主段 -5% */
        pitch: 1.04,         /* 主段 +3~5% */
        volume: 1.0,
        tail: "rise",
        pauseMs: 160,        /* 120~200ms */
        maxChars: 12,
        cuteTail: { pitch: 1.10, rate: 0.80 }   /* 末段 +8~12% / -15~20% */
      };
    }

    /* 默认：热情度分层 */
    var e = engagement({
      bond: core.bond, valence: v,
      userEngagement: ctx.userEngagement
    });
    var t = tierOf(e);

    /* 基础公式微调（钳制） */
    var pitch = clamp(1.0 + v * 0.06 + a * 0.02, PITCH_MIN, PITCH_MAX);
    var rate = clamp(0.95 - a * 0.10 - Math.max(0, -v) * 0.04, RATE_MIN, RATE_MAX);

    /* 热情档与公式各占一半，避免极端 */
    return {
      layer: "热情度-" + t.name,
      engagement: round3(e),
      rate: round3((t.rate + rate) / 2),
      pitch: round3((t.pitch + pitch) / 2),
      volume: 1.0,
      tail: ctx.tail || "fall",
      pauseMs: null
    };
  }

  /* ---------------- 分段（3~5 段，按标点） ---------------- */
  var PAUSE = { "，": 200, ",": 200, "。": 350, ".": 350, "？": 300, "?": 300, "！": 350, "!": 350, "…": 600, "：": 200 };

  function splitSegments(text) {
    var t = String(text || "").trim();
    if (!t) return [];
    var parts = [];
    var buf = "";
    for (var i = 0; i < t.length; i++) {
      buf += t[i];
      if (PAUSE[t[i]] != null) { parts.push(buf); buf = ""; }
    }
    if (buf.trim()) parts.push(buf);

    /* 合并到 3~5 段：太少就按逗号再切，太多就合并相邻短段 */
    if (parts.length > 6) {
      var merged = [], cur = "";
      parts.forEach(function (p) {
        cur += p;
        if (cur.length >= Math.ceil(t.length / 5)) { merged.push(cur); cur = ""; }
      });
      if (cur) merged.push(cur);
      parts = merged;
    }
    if (parts.length === 1 && t.length > 18) {
      var half = Math.ceil(t.length / 2);
      parts = [t.slice(0, half), t.slice(half)];
    }
    return parts;
  }

  function plan(text, params) {
    params = params || {};
    var segs = splitSegments(text);
    var a = (params.arousal != null) ? params.arousal : 0.3;
    var pauseScale = 1 + (1 - a) * 0.5;
    var tailMode = params.tail || "fall";

    return segs.map(function (s, i) {
      var isLast = i === segs.length - 1;
      var segText = s;
      var rate = params.rate, pitch = params.pitch;

      /* 最后 1~2 字单独处理 */
      if (isLast && segText.length > 2) {
        var bodyLen = segText.length - 2;
        var tailChars = segText.slice(bodyLen);
        var body = segText.slice(0, bodyLen);
        var tailRate = tailMode === "rise" ? rate * 0.97 : rate * 0.95;
        var tailPitch = tailMode === "rise" ? pitch + 0.03 : pitch - 0.02;
        if (params.cuteTail) { tailRate = params.cuteTail.rate; tailPitch = params.cuteTail.pitch; }
        return {
          text: s,
          split: { body: body, tail: tailChars, tailRate: round3(clamp(tailRate, 0.72, RATE_MAX)), tailPitch: round3(clamp(tailPitch, PITCH_MIN, PITCH_MAX)) },
          rate: round3(rate), pitch: round3(pitch),
          pauseAfter: 0, tail: tailMode, fadeMs: 10
        };
      }

      var ch = s[s.length - 1];
      var basePause = PAUSE[ch] || 0;
      return {
        text: segText,
        rate: round3(rate), pitch: round3(pitch),
        pauseAfter: Math.round((params.pauseMs != null ? Math.min(params.pauseMs, basePause || params.pauseMs) : basePause) * (basePause ? pauseScale : 1)),
        tail: tailMode, fadeMs: 10
      };
    });
  }

  /* 受伤/正向残留对基线的修正 */
  function applyResidue(params, residue) {
    if (!residue || !residue.length) return params;
    var hurt = residue.some(function (r) { return r.event === "被敷衍" || r.event === "被当成工具" || r.event === "受伤"; });
    var good = residue.some(function (r) { return r.sign === 1; });
    if (hurt) {
      params.volume = round3((params.volume || 1) * 0.95);
      params.pauseBias = 40;
      params.pitch = round3(clamp((params.pitch || 1) - 0.01, PITCH_MIN, PITCH_MAX));
    }
    if (good) {
      params.pitch = round3(clamp((params.pitch || 1) + 0.01, PITCH_MIN, PITCH_MAX));
      params.pauseBias = (params.pauseBias || 0) - 20;
    }
    return params;
  }

  /* ---------------- 缓存键（含 layer + 参数 + 末段轮廓 + 停顿） ---------------- */
  function hash(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function cacheKey(text, voiceId, params, planArr) {
    var tail = planArr && planArr.length ? (planArr[planArr.length - 1].split ? "t:" + planArr[planArr.length - 1].split.tailPitch + "/" + planArr[planArr.length - 1].split.tailRate : "n") : "n";
    var pauses = (planArr || []).map(function (p) { return p.pauseAfter; }).join("-");
    return hash([
      String(text || ""),
      voiceId || "",
      params && params.layer || "",
      Number(params && params.rate || 0).toFixed(3),
      Number(params && params.pitch || 0).toFixed(3),
      tail,
      pauses
    ].join("|"));
  }

  return {
    PITCH_MIN: PITCH_MIN, PITCH_MAX: PITCH_MAX, RATE_MIN: RATE_MIN, RATE_MAX: RATE_MAX,
    CUTE_MONTHLY_MAX: CUTE_MONTHLY_MAX,
    engagement: engagement,
    userEngagement: userEngagement,
    tierOf: tierOf,
    emotionOverride: emotionOverride,
    cuteGate: cuteGate,
    paramsFor: paramsFor,
    applyResidue: applyResidue,
    splitSegments: splitSegments,
    plan: plan,
    cacheKey: cacheKey
  };
});
