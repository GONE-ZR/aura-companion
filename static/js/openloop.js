/* ============================================================
   openloop.js —— 未闭合话题 + 断点衔接（第五篇 §4）

   · OpenLoop 由**小模型异步判定**，不占主对话（本地先做启发式，模型可用时再覆盖）
   · 回来第一句规则：
       <2 小时     不提断点，直接接话
       2 小时~3 天 接话头，不复述
       3~7 天      轻提一句，不追问
       >7 天       不接，重新开始
   · 只接最近一个话题；用户第一句是新话题就立刻放弃衔接
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraOpenLoop = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_openloops_v1";
  var MAX = 20;

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* ignore */ }
  }

  /* 启发式判定：这句话是不是开了一个"还没完"的话题 */
  var OPENERS = [
    /(面试|考试|复试|体检|搬家|签证|答辩|报告|方案|项目|出差)/,
    /(还没|等结果|明天.*(去|要)|下周.*(要|去)|月底)/,
    /(跟他|跟她|跟我妈|跟我爸|跟同事|跟领导).{0,8}(说|聊|吵|谈)/
  ];
  var CLOSERS = [/(好了|解决了|定下来了|过了|没成|结束了|就这样吧)/];

  function looksOpen(text) {
    var t = String(text || "");
    if (t.length < 4) return false;
    if (CLOSERS.some(function (r) { return r.test(t); })) return false;
    return OPENERS.some(function (r) { return r.test(t); });
  }

  /* 开一个话题（异步判定用；本地兜底也在用） */
  function open(topic, now) {
    var t = String(topic || "").slice(0, 40);
    if (!t) return null;
    var list = load();
    /* 同一个话题不重复开 */
    var hit = list.filter(function (x) { return !x.closedAt && x.topic === t; })[0];
    if (hit) return hit;
    var item = { id: "loop" + Date.now().toString(36), topic: t, openedAt: now || Date.now(), closedAt: null };
    list.push(item);
    save(list);
    return item;
  }

  function close(id, now) {
    var list = load();
    list.forEach(function (x) { if (x.id === id) x.closedAt = now || Date.now(); });
    save(list);
    return list;
  }

  /* 最近一个还没闭合的 */
  function latest() {
    var open_ = load().filter(function (x) { return !x.closedAt; });
    if (!open_.length) return null;
    open_.sort(function (a, b) { return b.openedAt - a.openedAt; });
    return open_[0];
  }

  /* 用户回来的第一句该怎么说（§4 规则表） */
  function gapRule(gapMs) {
    var h = gapMs / 3600000;
    if (h < 2) return "none";        /* 不提断点 */
    if (h <= 24 * 3) return "resume";  /* 接话头，不复述 */
    if (h <= 24 * 7) return "light";   /* 轻提一句，不追问 */
    return "fresh";                  /* 重新开始 */
  }

  /* 决定要不要衔接、怎么衔接
     userText: 用户这次的第一句 */
  function plan(userText, now) {
    now = now || Date.now();
    var lp = latest();
    if (!lp) return { mode: "none", topic: "" };
    var gap = now - lp.openedAt;
    var mode = gapRule(gap);
    if (mode === "none" || mode === "fresh") return { mode: mode, topic: lp.topic };
    /* 用户第一句是新话题 → 立刻放弃衔接 */
    if (looksOpen(userText) && String(userText).indexOf(lp.topic.slice(0, 2)) === -1) {
      return { mode: "abandon", topic: lp.topic };
    }
    return { mode: mode, topic: lp.topic };
  }

  /* 给她的一句提示（不含"上次会话""历史记录"字样） */
  function lineFor(mode, topic) {
    if (!topic) return "";
    if (mode === "resume") return topic + "。";
    if (mode === "light") return topic + "，后来怎么样了。";
    return "";
  }

  /* 「上次说到哪了」：用户长按发送键时用（第六篇 §10） */
  function recall() {
    var lp = latest();
    if (!lp) return "没什么，随便聊。";
    return lp.topic + "。";
  }

  return {
    KEY: KEY,
    load: load,
    looksOpen: looksOpen,
    open: open,
    close: close,
    latest: latest,
    gapRule: gapRule,
    plan: plan,
    lineFor: lineFor,
    recall: recall,
    _reset: function () { try { localStorage.removeItem(KEY); } catch (e) { } }
  };
});
