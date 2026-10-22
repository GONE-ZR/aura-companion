/* ============================================================
   usage.js —— 成本与额度监控（第六篇 §6）

   只记数量，不记内容（不记对话原文、不记 prompt 片段）。
   必须能回答：今天多少 token / 缓存命中率 / fallback 率 / 还能撑几天。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraUsage = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_usage_v1";
  var KEEP_DAYS = 30;

  function today() {
    var d = new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "{}");
      return raw && typeof raw === "object" ? raw : {};
    } catch (e) { return {}; }
  }
  function save(obj) {
    var keys = Object.keys(obj).sort();
    while (keys.length > KEEP_DAYS) { delete obj[keys.shift()]; }
    try { localStorage.setItem(KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
  }

  function blank(date) {
    return {
      date: date, requestCount: 0, promptTokens: 0, cachedTokens: 0,
      completionTokens: 0, fallbackCount: 0, errorCount: 0, byModel: {}
    };
  }

  function ensure(obj, date) {
    if (!obj[date]) obj[date] = blank(date);
    return obj[date];
  }

  /* 一条成功请求（usage 来自 stream_options.include_usage 的最后一帧） */
  function recordUsage(usage, meta) {
    var o = load();
    var d = ensure(o, today());
    meta = meta || {};
    d.requestCount += 1;
    if (usage) {
      d.promptTokens += Number(usage.prompt_tokens || 0);
      d.cachedTokens += Number(usage.prompt_cache_hit_tokens || 0);
      d.completionTokens += Number(usage.completion_tokens || 0);
    }
    if (meta.fallback) d.fallbackCount += 1;
    var mid = meta.model || "unknown";
    var bm = d.byModel[mid] || { tokens: 0, requests: 0 };
    bm.requests += 1;
    bm.tokens += Number((usage && (usage.total_tokens || (usage.prompt_tokens || 0) + (usage.completion_tokens || 0))) || 0);
    d.byModel[mid] = bm;
    save(o);
    return d;
  }

  function recordError() {
    var o = load();
    ensure(o, today()).errorCount += 1;
    save(o);
  }

  /* ---- 四个必答问题 ---- */
  function summary(date) {
    var o = load();
    var d = o[date || today()] || blank(date || today());
    var promptTotal = d.promptTokens || 0;
    var hitRate = promptTotal > 0 ? d.cachedTokens / promptTotal : 0;
    var fallbackRate = d.requestCount > 0 ? d.fallbackCount / d.requestCount : 0;
    return {
      date: d.date,
      requests: d.requestCount,
      tokens: d.promptTokens + d.completionTokens,
      promptTokens: d.promptTokens,
      cachedTokens: d.cachedTokens,
      completionTokens: d.completionTokens,
      hitRate: hitRate,
      fallbackRate: fallbackRate,
      errors: d.errorCount,
      byModel: d.byModel
    };
  }

  /* 按最近 7 天日均，估算还能撑几天（budget = 剩余免费额度 token，用户自填） */
  function daysLeft(budgetTokens) {
    var o = load();
    var days = Object.keys(o).sort().slice(-7);
    if (!days.length) return null;
    var total = days.reduce(function (a, k) {
      var d = o[k];
      return a + (d.promptTokens || 0) + (d.completionTokens || 0);
    }, 0);
    var avg = total / days.length;
    if (!avg) return null;
    return Math.floor(Number(budgetTokens || 0) / avg);
  }

  /* 报警（§6.4）：命中率 <50% / fallback >5% */
  function alarms() {
    var s = summary();
    var out = [];
    if (s.requests > 0 && s.hitRate < 0.5) {
      out.push("缓存命中率 " + Math.round(s.hitRate * 100) + "% < 50%：检查 system 里是否有每轮变化的内容");
    }
    if (s.requests > 0 && s.fallbackRate > 0.05) {
      out.push("fallback 率 " + Math.round(s.fallbackRate * 100) + "% > 5%：检查额度与 429");
    }
    return out;
  }

  return {
    KEY: KEY,
    today: today,
    load: load,
    recordUsage: recordUsage,
    recordError: recordError,
    summary: summary,
    daysLeft: daysLeft,
    alarms: alarms
  };
});
