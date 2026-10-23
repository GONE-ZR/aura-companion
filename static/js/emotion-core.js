/* ============================================================
   emotion-core.js —— 情绪核（A 份：只算数据，不改表达）

   定位
     7 状态 + 忍耐值 = 【外显层】（表情/背景），完全保留
     本模块 = 【内核】：valence / arousal / target / residue / bond / intent
     模型只演，数值绝不进界面、绝不进注入文本

   铁律
     · 单轮 valence 变动 ≤ ±0.15
     · 残留按真实时间半衰期衰减（不按轮次）
     · 忍耐值独立运行，valence 不得反向影响它
     · patience ≥ 90 → 外显强制 blank；≥ 60 → serious（忍耐值优先）
     · 危机输入 → intent 强制 express，且不触发任何 sore/soft
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraEmotionCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_STEP = 0.15;          /* 单轮 valence 上限 */
  var HOUR = 3600000;
  var TRIGGER_COOLDOWN = 1 * HOUR;

  /* 半衰期（小时） */
  var HL = {
    sulky: 2,          /* 小脾气 / 被逗 */
    brushed: 24,       /* 被敷衍 / 被打断 */
    heard: 72,         /* 被认真听 / 被记得 */
    hurt: 120,         /* 受伤 / 被忽视 */
    node: null         /* 关系节点：永不过期 */
  };

  function now0(){ return Date.now(); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function round2(v) { return Math.round(v * 100) / 100; }

  /* ---------------- 初始化 / 持久化 ---------------- */
  function ensure(core, now) {
    now = now || now0();
    if (!core || typeof core !== "object") core = {};
    if (typeof core.valence !== "number") core.valence = 0;
    if (typeof core.arousal !== "number") core.arousal = 0.3;
    if (typeof core.bond !== "number") core.bond = 0.3;
    if (!core.target) core.target = "self";
    if (!Array.isArray(core.residue)) core.residue = [];
    if (!core.intent) core.intent = "express";
    if (typeof core.concealRound !== "number") core.concealRound = 0;
    if (!core.lastTriggerAt) core.lastTriggerAt = {};
    if (!core.updatedAt) core.updatedAt = now;
    return core;
  }

  /* ---------------- 残留：按真实时间衰减 ---------------- */
  function strength(r, now) {
    now = now || now0();
    if (!r) return 0;
    if (r.halfLifeHours == null) return clamp(r.intensity || 0, 0, 1);   /* 永不过期 */
    var age = Math.max(0, now - (r.createdAt || now)) / HOUR;
    return clamp((r.intensity || 0) * Math.pow(0.5, age / r.halfLifeHours), 0, 1);
  }

  function activeResidue(core, now) {
    return (core.residue || []).filter(function (r) {
      return r && !r.archived && strength(r, now) >= 0.1;
    });
  }

  /* 强度 <0.1 → 移出活跃列表但**保留记录**（archived 标记，不删） */
  function archiveWeak(core, now) {
    (core.residue || []).forEach(function (r) {
      if (r && !r.archived && strength(r, now) < 0.1) {
        r.archived = true;
        r.archivedAt = now;
      }
    });
    return core;
  }

  /* 残留的加权和 → 作为 valence 的基线 */
  function residueBaseline(core, now) {
    var sum = 0, w = 0;
    activeResidue(core, now).forEach(function (r) {
      var s = strength(r, now);
      sum += (r.target === "you" ? -1 : 1) * (r.sign == null ? -1 : r.sign) * s;
      w += 1;
    });
    return w ? clamp(sum / Math.max(1, w), -1, 1) : 0;
  }

  /* ---------------- 触发点（规则引擎判定，不交给模型） ---------------- */
  var EMOJI_ONLY = /^[\s\p{Emoji_Presentation}\p{Extended_Pictographic}~～。.!！?？]+$/u;

  function detect(opts) {
    var u = String(opts.userText || "").trim();
    var prev = opts.prevAssistantText || "";
    var out = [];
    var hasQ = /[?？]|怎么了|为什么/.test(u);

    /* sore */
    var prevSubstantive = String(prev).replace(/\s/g, "").length >= 12 && !/[?？]$/.test(prev);
    if (prevSubstantive && (u.length <= 2 || EMOJI_ONLY.test(u)) && !hasQ) {
      out.push({ event: "被敷衍", delta: -0.25, hl: HL.brushed, target: "you" });
    }
    if (/^(帮我|给我|替我|写个|写一份|查一下|翻译|总结)/.test(u)) {
      out.push({ event: "被当成工具", delta: -0.30, hl: HL.hurt, target: "you" });
    }
    if (/(别人|人家|我朋友|我同事).{0,6}(都|就|能|会)/.test(u)) {
      out.push({ event: "被比较", delta: -0.20, hl: 48, target: "you" });
    }
    if (opts.interrupted) {
      out.push({ event: "被打断", delta: -0.20, hl: HL.brushed, target: "you" });
    }

    /* soft */
    if (/记得|上次说|你之前说|你提过/.test(u)) {
      out.push({ event: "被记得细节", delta: 0.20, hl: HL.heard, target: "self" });
    }
    if (/对不起|抱歉|是我不好|我错了/.test(u)) {
      out.push({ event: "被道歉", delta: 0.25, hl: HL.heard, target: "self" });
    }
    if (/你真好|你人真好|喜欢你|可爱/.test(u) && u.length <= 14) {
      out.push({ event: "被夸但不过头", delta: 0.10, hl: 24, target: "self" });
    }
    if (!out.length && (hasQ && u.length >= 8)) {
      out.push({ event: "被认真听", delta: 0.15, hl: 48, target: "self" });
    }
    return out;
  }

  function applyTriggers(core, triggers, now, messageId) {
    var delta = 0, applied = 0;
    (triggers || []).forEach(function (t) {
      var last = core.lastTriggerAt[t.event] || 0;
      if (now - last < TRIGGER_COOLDOWN) return;        /* 1 小时内不重复计分 */
      core.lastTriggerAt[t.event] = now;
      core.residue.push({
        id: "rs" + now.toString(36) + Math.random().toString(36).slice(2, 5),
        event: t.event,
        target: t.target || "you",
        intensity: Math.abs(t.delta),
        sign: t.delta >= 0 ? 1 : -1,
        halfLifeHours: t.hl,
        createdAt: now,
        lastTouchedAt: now,
        messageId: messageId || null
      });
      delta += t.delta;
      applied += 1;
    });
    /* 单轮幅度 ≤ ±0.15 */
    delta = clamp(delta, -MAX_STEP, MAX_STEP);
    core.valence = clamp(core.valence + delta, -1, 1);
    return { delta: delta, applied: applied };
  }

  /* ---------------- 每轮观察（发请求前同步调用） ---------------- */
  function observe(opts) {
    var now = opts.now || now0();
    var core = ensure(opts.core, now);
    var u = String(opts.userText || "");

    archiveWeak(core, now);

    /* 危机输入：强制 express，且不触发任何 sore/soft */
    if (opts.crisis) {
      core.intent = "express";
      core.concealRound = 0;
      core.target = "world";
      core.arousal = clamp(core.arousal + 0.05, 0, 1);
      core.updatedAt = now;
      return { core: core, triggers: [], delta: 0, crisis: true };
    }

    var triggers = detect({
      userText: u,
      prevAssistantText: opts.prevAssistantText,
      interrupted: opts.interrupted
    });
    var applied = applyTriggers(core, triggers, now, opts.messageId);
    var delta = applied.delta;

    /* target：负面且由对方引起 → you；否则 self / world */
    if (delta < 0) core.target = "you";
    else if (delta > 0) core.target = "self";

    /* arousal：情绪起伏 + 句式激烈度 */
    var excite = /[!！]/.test(u) ? 0.08 : 0;
    core.arousal = clamp(core.arousal + Math.abs(delta) * 0.5 + excite - 0.02, 0, 1);

    /* valence 向残留基线回归：只有**本轮没触发**时才缓慢回归，
       否则会把刚加上去的 delta 立刻稀释（被敷衍一轮就几乎看不出来） */
    if (!triggers.length) {
      var base = residueBaseline(core, now);
      core.valence = clamp(core.valence * 0.95 + base * 0.05, -1, 1);
    }

    /* bond：只按事件变动 */
    triggers.forEach(function (t) {
      if (t.event === "被认真听") core.bond = clamp(core.bond + 0.02, 0, 1);
      else if (t.event === "被记得细节") core.bond = clamp(core.bond + 0.03, 0, 1);
      else if (t.event === "被道歉") core.bond = clamp(core.bond + 0.05, 0, 1);
      else if (t.event === "被敷衍" || t.event === "被当成工具") core.bond = clamp(core.bond - 0.03, 0, 1);
    });

    core.updatedAt = now;
    return { core: core, triggers: triggers, applied: applied.applied, delta: delta, crisis: false };
  }

  /* ---------------- 外显映射（7 状态，仅表情与背景） ---------------- */
  function mapState(core, patience) {
    var p = typeof patience === "number" ? patience : 20;
    /* 忍耐值优先：它是既有机制的硬兜底 */
    if (p >= 90) return "blank";
    if (p >= 60) return "serious";

    var v = core.valence, a = core.arousal, bond = core.bond, target = core.target;
    if (v < -0.4 && a < 0.2 && bond < 0.4) return "blank";
    if (v < -0.5 && a < 0.5 && target === "you") return "serious";
    if (v < -0.2 && a >= 0.5) return "sulky";
    if (v < -0.2 && a < 0.4) return bond >= 0.6 ? "low" : "tired";
    if (v > 0.3 && a >= 0.4) return "smile";
    if (v > 0.3 && a < 0.4) return "soft";
    return "calm";
  }

  /* ---------------- 意图：express / conceal / probe ---------------- */
  function decideIntent(core, opts) {
    opts = opts || {};
    var v = core.valence, bond = core.bond;

    if (opts.crisis) { core.intent = "express"; core.concealRound = 0; return "express"; }

    var wantConceal = v < -0.3 && core.target === "you" && bond < 0.7;

    /* 情绪回升 → 解除「已强制 express」锁 */
    if (core.concealLocked && v > -0.3) core.concealLocked = false;

    if (wantConceal && !core.concealLocked) {
      if (core.intent !== "conceal") {
        core.intent = "conceal";
        core.concealRound = 1;
      } else {
        core.concealRound = (core.concealRound || 1) + 1;
        if (opts.userAsked) core.concealRound += 1;      /* 追问加速 */
      }
      if (core.concealRound >= 4) {                      /* 最多 3 轮，第 4 轮强制 express */
        core.intent = "express";
        core.concealRound = 0;
        core.concealLocked = true;
      }
      return core.intent;
    }

    var wantProbe = v < -0.1 && bond >= 0.4 && bond <= 0.7 && !opts.firstConflict;
    if (wantProbe) {
      core.intent = "probe";
      core.concealRound = 0;
      return "probe";
    }

    core.intent = "express";
    core.concealRound = 0;
    return "express";
  }

  /* 试探没被接住（回 ≤2 字）→ 转 conceal，且该残留 +0.1 */
  function probeMissed(core, now) {
    now = now || now0();
    if (core.intent !== "probe") return core;
    core.intent = "conceal";
    core.concealRound = 1;
    var rs = core.residue.filter(function (r) { return !r.archived; });
    if (rs.length) {
      var last = rs[rs.length - 1];
      last.intensity = clamp((last.intensity || 0) + 0.1, 0, 1);
      last.lastTouchedAt = now;
    }
    return core;
  }

  /* ---------------- 注入：一句人话（无数字、无字段名） ---------------- */
  var LINES = {
    "soft|express": ["挺好的，想多说两句。", "心情不错，愿意聊。"],
    "soft|conceal": ["还行吧。", "没什么，挺好的。"],
    "smile|express": ["今天挺开心的。", "心情好，话多一点。"],
    "smile|conceal": ["没事，挺好的。"],
    "calm|express": ["没什么情绪，正常聊。", "挺平静的。"],
    "calm|probe": ["有点在意，但不太想说。", "还行。你自己想。"],
    "calm|conceal": ["没什么。", "就那样。"],
    "tired|express": ["有点累，不太想说话。跟你无关。", "今天累，慢一点。"],
    "tired|conceal": ["有点累。", "没什么力气说话。"],
    "low|express": ["心里有点沉，不太想多说。", "有点低落，你陪着就行。"],
    "low|conceal": ["有点闷。", "不太想提。"],
    "sulky|express": ["有点不高兴，但没到生气。", "哼，有点不爽。"],
    "sulky|conceal": ["没什么。", "不用管我。"],
    "serious|express": ["还在意刚才那句，但不想提。", "有点生气，先这样。"],
    "serious|conceal": ["不想说这个。", "算了吧。"],
    "blank|express": ["没什么情绪，客气着。", "就正常说话吧。"],
    "blank|conceal": ["嗯。", "随便。"]
  };

  function pick(arr, seed) {
    if (!arr || !arr.length) return "";
    var i = Math.abs(Math.floor(seed)) % arr.length;
    return arr[i];
  }

  function oneLine(opts) {
    var core = ensure(opts.core, opts.now);
    var state = opts.state || mapState(core, opts.patience);
    var intent = opts.intent || core.intent || "express";
    var bond = core.bond;
    var key = state + "|" + (intent === "probe" ? "probe" : (intent === "conceal" ? "conceal" : "express"));
    var arr = LINES[key] || LINES[state + "|express"] || ["正常聊。"];

    /* bond 高低要有可见差别：低 bond 更收着，高 bond 更放松 */
    var seed = (opts.seed || Date.now()) + (bond < 0.4 ? 1 : 3);
    var line = pick(arr, seed);
    if (bond >= 0.7 && intent === "express" && state !== "serious" && state !== "blank") {
      line = line.replace(/。$/, "，跟你说说也行。");
    }
    if (bond < 0.4 && intent !== "express") {
      line = line.replace(/。$/, "。") ;
    }
    return "【现在】" + line;
  }

  return {
    MAX_STEP: MAX_STEP,
    HL: HL,
    ensure: ensure,
    strength: strength,
    activeResidue: activeResidue,
    archiveWeak: archiveWeak,
    residueBaseline: residueBaseline,
    detect: detect,
    observe: observe,
    mapState: mapState,
    decideIntent: decideIntent,
    probeMissed: probeMissed,
    oneLine: oneLine
  };
});
