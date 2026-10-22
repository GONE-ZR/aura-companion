/* ============================================================
   offline.js —— 离线短句库（第六篇 §2）

   断网时不崩、不弹"网络异常"、不解释原因：只用本地预置短句回一句。

   规则：
   · 优先用「当前状态 × 当前时段」的桶，不足回退 calm
   · 同一桶内 5 轮不重复；用完再循环
   · 第 3 条起连续离线 → 明显变短（"嗯。""……"）
   · e/b 用短句预设值，不随机
   · 用户问"是不是断网了" → "嗯，有点卡。"（承认但不技术化）
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraOffline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function all() {
    if (typeof window !== "undefined" && window.AuraOfflineLines) return window.AuraOfflineLines;
    if (typeof module === "object" && module.exports) {
      try { return require("./offline-lines.js"); } catch (e) { return []; }
    }
    return [];
  }

  var recent = [];          /* 最近用过的 id（state|period|text） */
  var MAX_RECENT = 5;
  var offlineStreak = 0;

  function periodOf(now) {
    var h = (now ? new Date(now) : new Date()).getHours();
    if (h < 6) return "night";
    if (h < 11) return "morning";
    if (h < 18) return "day";
    if (h < 23) return "evening";
    return "night";
  }

  function key(r) { return r.state + "|" + r.period + "|" + r.text; }

  /* 抽一条：优先当前状态桶，不足回退 calm */
  function pick(state, period, opts) {
    opts = opts || {};
    var list = all();
    if (!list.length) return { text: "嗯。", e: "calm", b: "warm" };

    var p = period || periodOf();
    var want = state || "calm";

    function bucket(st, pe) {
      return list.filter(function (r) { return r.state === st && r.period === pe; });
    }

    var pool = bucket(want, p);
    if (pool.length < 6) pool = pool.concat(bucket("calm", p));
    if (!pool.length) pool = list.slice();

    /* 同桶 5 轮不重复 */
    var fresh = pool.filter(function (r) { return recent.indexOf(key(r)) === -1; });
    if (!fresh.length) { recent = []; fresh = pool; }

    /* 连续离线 ≥3 条 → 只从短句里挑（明显变短） */
    var streak = typeof opts.streak === "number" ? opts.streak : offlineStreak;
    if (streak >= 3) {
      var shortOnes = fresh.filter(function (r) { return r.text.length <= 4; });
      if (shortOnes.length) fresh = shortOnes;
    }

    var r = fresh[Math.floor(Math.random() * fresh.length)];
    recent.push(key(r));
    if (recent.length > MAX_RECENT) recent = recent.slice(-MAX_RECENT);
    return { text: r.text, e: r.e, b: r.b };
  }

  /* 连续离线计数（发一次成功就清零） */
  function noteOffline() { offlineStreak += 1; return offlineStreak; }
  function noteOnline() { offlineStreak = 0; return offlineStreak; }
  function streak() { return offlineStreak; }

  /* 判"是不是断网了" */
  function isOfflineQuestion(text) {
    return /(是不是|怎么).{0,4}(断网|没网|掉线|连不上)|你(断网|掉线)了/.test(String(text || ""));
  }

  /* 断网判定：navigator.onLine === false，或请求抛 TypeError / Failed to fetch */
  function looksOffline(err) {
    if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
    var m = String((err && (err.message || err)) || "");
    return /Failed to fetch|NetworkError|Load failed|ERR_INTERNET|ERR_NETWORK|offline/i.test(m);
  }

  /* 回复一条（含"是不是断网了"的特殊回答） */
  function reply(state, userText, opts) {
    var n = noteOffline();
    if (isOfflineQuestion(userText)) {
      return { text: "嗯，有点卡。", e: "calm", b: "warm", streak: n, special: "offline_ack" };
    }
    var r = pick(state, null, Object.assign({ streak: n }, opts || {}));
    r.streak = n;
    r.special = "";
    return r;
  }

  return {
    all: all,
    pick: pick,
    reply: reply,
    periodOf: periodOf,
    noteOffline: noteOffline,
    noteOnline: noteOnline,
    streak: streak,
    isOfflineQuestion: isOfflineQuestion,
    looksOffline: looksOffline,
    _reset: function () { recent = []; offlineStreak = 0; }
  };
});
