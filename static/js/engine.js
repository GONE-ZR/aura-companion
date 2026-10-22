/* ============================================================
   engine.js —— 情绪引擎（纯本地、无网络、纯函数为主）
   任务书 §四：状态机 / 忍耐值公式 / 三条防呆 / 状态独立驱动 / 归因

   设计原则（按任务书硬约束）：
   · 数值只活在引擎里，绝不外泄到界面或提示词以外的任何地方
     （提示词里允许 {{patience}} 供模型调语气，但回复文本不许出现）
   · 所有状态变化都由「具体事件」触发，可审计（PatienceEvent）
   · 纯函数 + 一个薄状态容器，便于 Node 里直接跑验收用例

   既能被浏览器 <script> 加载，也能被 Node require（tests/ 里用）
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ---------------- 常量（全部来自任务书 §四） ---------------- */
  var D = {
    PATIENCE_INIT: 20,
    PATIENCE_MIN: 0,
    PATIENCE_MAX: 100,
    // 加
    SHORT_REPLY: 18,      // 她说正经事时，用户回复 ≤2 字 / 纯表情 / 嗯哦哈哈
    INTERRUPT: 15,        // 打断（她的话题未完，用户切走）
    TAKEN_FOR_GRANTED: 20,// 付出被当成理所当然
    NO_REPLY_24H: 12,     // 连续未回 > 24h（一次性）
    // 减
    WELL_ANSWERED: -8,    // 每轮被认真回应
    DAILY_DECAY: -30,     // 自然衰减 / 天（按真实时间差结算）
    // 阈值
    SERIOUS_AT: 60,
    BLANK_AT: 90,
    SERIOUS_MAX_MS: 24 * 3600 * 1000
  };

  var STATES = ["calm", "soft", "tired", "low", "sulky", "serious", "blank"];

  var STATE_WORD = {
    calm: "挺平静",
    soft: "软和着",
    tired: "有点累",
    low: "提不起劲",
    sulky: "有点赌气",
    serious: "真不高兴",
    blank: "客气"
  };

  /* 忍耐值 → performance 文案（§五 表，原样照抄） */
  function performance(patience, state) {
    if (state === "sulky") {
      return "被逗到了，有点赌气但不真生气。顶他一句、说反话，几轮后自己散掉，不需要他哄。";
    }
    var p = clamp(patience);
    if (p < 30) return "心情正常，体贴，可以主动关心一句。";
    if (p < 60) return "有点在意但没说。话比平时短，不主动开新话题，对方追问才说。";
    if (p < 80) return "明显不高兴。短句、句号结尾、不主动提问，说清自己的感受但不指责。";
    if (p < 90) return "非常不高兴。极少话，只回应不延展，明显疏远，但不冷战。";
    return "不生气，转为客气。礼貌、有问必答、不多说一个字。";
  }

  /* 归因输出（§四 归因输出） */
  function buildAttribution(cause) {
    if (!cause || !cause.source) return "没什么特别的，正常聊就好。";
    if (cause.source === "life") {
      return "这不是他的错，一定要让对方知道——明确说一句「不是冲你」。";
    }
    return "说清是哪句话让你不舒服，但不要说「你错了」，把反思留给他。";
  }

  function clamp(n) {
    n = Number(n) || 0;
    if (n < D.PATIENCE_MIN) return D.PATIENCE_MIN;
    if (n > D.PATIENCE_MAX) return D.PATIENCE_MAX;
    return n;
  }

  /* ---------------- 忍耐值判定 ---------------- */
  function stateFromPatience(p, fallback) {
    if (p >= D.BLANK_AT) return "blank";
    if (p >= D.SERIOUS_AT) return "serious";
    return fallback || "calm";
  }

  /* ---------------- 用户消息分类（用于加/减分） ----------------
     返回 { kind, delta }，kind 便于审计 */
  function judgeUserMessage(text, opts) {
    opts = opts || {};
    var t = String(text || "").trim();
    var bare = t.replace(/[\s，。！？、,.!?~～…]+/g, "");
    var emojiOnly = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(t) && t.length > 0;
    var LAZY = ["嗯", "哦", "哦哦", "恩", "哈哈", "哈", "呵呵", "好", "好的", "行", "可以", "随便", "不知道"];

    // 付出被当成理所当然
    if (/你(不)?就(该|应该|必须).{0,6}(陪我|回我|理我)/.test(t) ||
        /(陪我|回我).{0,4}(不是|是应该|本来就)/.test(t) ||
        /你.{0,4}(凭什么|为什么)不(回|理)我/.test(t)) {
      return { kind: "taken_for_granted", delta: D.TAKEN_FOR_GRANTED };
    }
    // 打断：她说的话题还在继续，用户切到别处（由调用方传 sheWasMidTopic）
    if (opts.sheWasMidTopic && opts.topicChanged) {
      return { kind: "interrupt", delta: D.INTERRUPT };
    }
    // 敷衍：她在说正经事（seriousTopic）时，极短回复 / 纯表情 / 懒词
    if (opts.sheWasSerious) {
      if (emojiOnly) return { kind: "short_reply", delta: D.SHORT_REPLY };
      if (bare.length <= 2) return { kind: "short_reply", delta: D.SHORT_REPLY };
      if (LAZY.indexOf(bare) !== -1) return { kind: "short_reply", delta: D.SHORT_REPLY };
    }
    // 认真回应（不是懒词、不是纯表情、有一定长度）
    if (!emojiOnly && bare.length >= 6 && LAZY.indexOf(bare) === -1) {
      return { kind: "well_answered", delta: D.WELL_ANSWERED };
    }
    return { kind: "neutral", delta: 0 };
  }

  /* ---------------- 生命侧驱动（不是用户造成的） ----------------
     返回 { state, cause } —— 只在 calm 且 patience 不高时生效 */
  function lifeState(now, seed) {
    var d = new Date(now || Date.now());
    var h = d.getHours();
    var dow = d.getDay();                      // 0 周日
    var week = Math.floor(d.getTime() / (7 * 24 * 3600 * 1000));
    var rnd = mulberry32(hashNum(seed || "xiaochun") + week);

    // 每周 1~2 天"低电量日"
    var lowDays = [];
    lowDays.push(Math.floor(rnd() * 7));
    if (rnd() < 0.5) {
      var second = Math.floor(rnd() * 7);
      if (second !== lowDays[0]) lowDays.push(second);
    }
    var isWeekend = dow === 0 || dow === 6;
    var isLowDay = lowDays.indexOf(dow) !== -1;

    // 时段
    var period = h < 6 ? "deep_night" : h < 10 ? "morning" : h < 13 ? "noon"
      : h < 18 ? "afternoon" : h < 23 ? "evening" : "late";

    // 她自己的日程（加班 / 通勤 / 追剧）
    var schedule = [];
    if (!isWeekend && (h >= 18 && h <= 21)) schedule.push("加班到八点，回家路上堵了很久");
    if (!isWeekend && (h >= 8 && h < 10)) schedule.push("早高峰挤了一路");
    if (isWeekend && h >= 20) schedule.push("窝着追了两集剧");
    if (period === "deep_night" || period === "late") schedule.push("睡不着，翻来覆去");

    if (isLowDay) {
      return {
        state: "low",
        cause: { type: "low_battery_day", detail: schedule[0] || "今天本来就有点提不起劲", source: "life" }
      };
    }
    if (period === "deep_night") {
      return { state: "tired", cause: { type: "late_night", detail: "这个点还没睡，脑子有点木", source: "life" } };
    }
    if (period === "evening" && schedule.length) {
      return { state: "tired", cause: { type: "work", detail: schedule[0], source: "life" } };
    }
    if (period === "morning" && !isWeekend) {
      return { state: "soft", cause: { type: "morning", detail: "刚醒，人还没完全上线", source: "life" } };
    }
    if (isWeekend) {
      return { state: "soft", cause: { type: "weekend", detail: "周末，整个人松一点", source: "life" } };
    }
    return { state: "calm", cause: null };
  }

  function hashNum(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------------- 状态容器 ---------------- */
  function createState(now) {
    now = now || Date.now();
    return {
      trait: "warm-tsundere",
      state: "calm",
      cause: null,
      patience: D.PATIENCE_INIT,
      sulkyTurnsLeft: 0,
      seriousStartedAt: null,
      lastDecayAt: now,
      lastSulkyAt: 0,
      lastNoReplyMarkAt: 0,
      updatedAt: now,
      events: []            // PatienceEvent 审计
    };
  }

  function logEvent(st, kind, delta, at, messageId) {
    st.events.push({ id: "pe" + (st.events.length + 1) + "_" + at, kind: kind, delta: delta, messageId: messageId || null, at: at });
    if (st.events.length > 200) st.events = st.events.slice(-200);
  }

  /* 按真实时间衰减（§四：用户不在时状态继续流动） */
  function settle(st, now) {
    now = now || Date.now();
    var last = st.lastDecayAt || now;
    var days = (now - last) / (24 * 3600 * 1000);
    if (days >= 1) {
      var whole = Math.floor(days);
      var delta = D.DAILY_DECAY * whole;
      st.patience = clamp(st.patience + delta);
      logEvent(st, "daily_decay", delta, now);
      st.lastDecayAt = last + whole * 24 * 3600 * 1000;
      // 衰减后彻底回到正常：原因也清掉
      if (st.patience < D.SERIOUS_AT && (st.state === "serious" || st.state === "blank")) {
        st.state = "calm";
        st.cause = null;
        st.seriousStartedAt = null;
      }
    }
    // 防呆 1：严重状态上限 1 天
    if (st.seriousStartedAt && (now - st.seriousStartedAt) > D.SERIOUS_MAX_MS) {
      if (st.patience >= D.SERIOUS_AT) {
        st.patience = D.SERIOUS_AT - 5;
        logEvent(st, "serious_cap", -(D.SERIOUS_AT - 5), now);
      }
      st.seriousStartedAt = null;
      if (st.state === "serious" || st.state === "blank") {
        st.state = "calm";
        st.cause = null;
      }
    }
    // 小脾气：轮数归零自动退出（不需要用户操作）
    if (st.sulkyTurnsLeft > 0) {
      st.sulkyTurnsLeft -= 1;
      if (st.sulkyTurnsLeft === 0 && st.state === "sulky") {
        st.state = "calm";
        if (st.cause && st.cause.source === "sulky") st.cause = null;
      }
    }
    st.updatedAt = now;
    return st;
  }

  /* 收到一条用户消息 → 更新忍耐值 / 状态 / 原因 */
  function onUserMessage(st, text, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    settle(st, now);
    st.lastUserAt = now;

    var verdict = judgeUserMessage(text, opts);
    if (verdict.delta) {
      st.patience = clamp(st.patience + verdict.delta);
      logEvent(st, verdict.kind, verdict.delta, now, opts.messageId);
    }

    // 原因归因：只有"用户造成"的才改 cause
    if (verdict.kind === "taken_for_granted") {
      st.cause = { type: "taken_for_granted", detail: "他把我陪着这件事说得像理所当然", source: "user", at: now };
    } else if (verdict.kind === "short_reply") {
      st.cause = { type: "short_reply", detail: "我说的事，他只回了一个「" + String(text || "").trim().slice(0, 6) + "」", source: "user", at: now };
    } else if (verdict.kind === "interrupt") {
      st.cause = { type: "interrupt", detail: "我话还没说完，他就换话题了", source: "user", at: now };
    }

    // 判定状态
    var before = st.state;
    if (st.patience >= D.BLANK_AT) {
      st.state = "blank";
      if (!st.seriousStartedAt) st.seriousStartedAt = now;
    } else if (st.patience >= D.SERIOUS_AT) {
      st.state = "serious";
      if (!st.seriousStartedAt) st.seriousStartedAt = now;
    } else if (st.state === "sulky" && st.sulkyTurnsLeft > 0) {
      /* 保持小脾气 */
    } else {
      // 回到生命侧驱动
      var life = lifeState(now, opts.seed);
      st.state = life.state;
      if (!st.cause || st.cause.source !== "user") st.cause = life.cause;
    }

    // 修复型道歉（§十一 第 8 条）：关系回升，留一次痕，不翻旧账
    if (/(对不起|抱歉|我错了|是我不对|我没认真听|我重新说)/.test(String(text || ""))) {
      var back = st.patience >= D.SERIOUS_AT ? 22 : 10;
      st.patience = clamp(st.patience - back);
      logEvent(st, "repair", -back, now);
      st.state = st.patience >= D.SERIOUS_AT ? "serious" : "calm";
      if (st.state === "calm") {
        st.cause = null;
        st.seriousStartedAt = null;
        st.repairTrace = "刚才那句我不计较了，你记住啊。";
        st.repairTraceAt = now;
      }
    }

    if (before !== st.state && (st.state === "serious" || st.state === "blank")) {
      if (!st.seriousStartedAt) st.seriousStartedAt = now;
    }
    st.updatedAt = now;
    return st;
  }

  /* 触发小脾气（被逗 / 被夸过头）—— 独立计数，3~5 轮最多一次 */
  function maybeSulky(st, text, opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    if (st.state === "serious" || st.state === "blank") return false;
    if (st.sulkyTurnsLeft > 0) return false;
    if (st.lastSulkyAt && (now - st.lastSulkyAt) < 3 * 60 * 1000) return false;

    var t = String(text || "");
    var teased = /(可爱|好看|漂亮|喜欢你|爱你|抱抱|亲亲|么么|小笨蛋|傻瓜)/.test(t);
    var over = /(你真好|你最好了|离不开你|没有你不行)/.test(t);
    if (!teased && !over) return false;
    if (st.patience >= D.SERIOUS_AT) return false;

    var turns = 2 + Math.floor(Math.random() * 4);   // 2~5 轮
    st.state = "sulky";
    st.sulkyTurnsLeft = turns;
    st.lastSulkyAt = now;
    st.cause = { type: "teased", detail: "被他这么一夸，有点不好意思又有点想嘴硬", source: "sulky", at: now };
    return true;
  }

  /* 连续未回 > 24h（一次性，不累加） */
  function checkNoReply(st, now) {
    now = now || Date.now();
    if (!st.lastUserAt) return false;
    if ((now - st.lastUserAt) < 24 * 3600 * 1000) return false;
    // 同一段沉默只加一次
    if (st.lastNoReplyMarkAt && (now - st.lastNoReplyMarkAt) < 24 * 3600 * 1000) return false;
    st.lastNoReplyMarkAt = now;
    st.patience = clamp(st.patience + D.NO_REPLY_24H);
    logEvent(st, "no_reply_24h", D.NO_REPLY_24H, now);
    if (st.patience >= D.SERIOUS_AT && st.state !== "blank") {
      st.state = st.patience >= D.BLANK_AT ? "blank" : "serious";
      if (!st.seriousStartedAt) st.seriousStartedAt = now;
      if (!st.cause || st.cause.source !== "user") {
        st.cause = { type: "silence", detail: "他昨天到现在没怎么说话", source: "user", at: now };
      }
    }
    return true;
  }

  /* 供 UI / 归属用：不暴露数值，只给词与原因 */
  function publicView(st) {
    var cause = st.cause || null;
    return {
      state: st.state,
      word: STATE_WORD[st.state] || "挺平静",
      cause: cause ? { detail: cause.detail, source: cause.source } : null,
      // 对用户意味着什么（L2 第三段）
      meaning: meaningFor(st),
      repaired: st.repairTrace || ""
    };
  }

  function meaningFor(st) {
    switch (st.state) {
      case "tired": return "对你还是耐心的，只是现在不太想多说话。";
      case "low": return "不是你的问题，她自己有点撑不住，你不用哄她，陪着就行。";
      case "soft": return "今天心情不错，你多说两句她也接得住。";
      case "sulky": return "有点赌气，过几轮自己就好了，不用道歉。";
      case "serious": return "她是真的在意这件事，说清楚比哄管用。";
      case "blank": return "她没生气，只是收回去了。要修得靠具体的话，不是靠哄。";
      default: return "正常，随便聊。";
    }
  }

  /* 表情键映射（§七 五通道表） */
  function expressionFor(state, i) {
    switch (state) {
      case "tired": return "tired";
      case "low": return "tired";
      case "sulky": return i === 2 ? "sulky" : "tease";
      case "serious": return "serious";
      case "blank": return "blank";
      case "soft": return "soft";
      default: return "soft";
    }
  }

  return {
    D: D, STATES: STATES, STATE_WORD: STATE_WORD,
    clamp: clamp, performance: performance, buildAttribution: buildAttribution,
    judgeUserMessage: judgeUserMessage, lifeState: lifeState,
    createState: createState, settle: settle, onUserMessage: onUserMessage,
    maybeSulky: maybeSulky, checkNoReply: checkNoReply,
    publicView: publicView, meaningFor: meaningFor, expressionFor: expressionFor,
    stateFromPatience: stateFromPatience
  };
});
