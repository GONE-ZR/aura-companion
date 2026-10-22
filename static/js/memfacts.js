/* ============================================================
   memfacts.js —— 事实记忆（任务书 §三 Memory + §九 记忆抽取 + 第 9 条）

   模型：{ id, fact, type:'event'|'preference'|'person', when,
           confidence: 0.5|0.7|0.9, status:'active'|'deleted', createdAt }

   规则：
   · 置信度只允许三档，越界一律落到最近的一档（稳妥起见往低取）
   · 用户可逐条删除；删除后 status=deleted，且**永不进入上下文**
   · 抽取只抽事实与偏好，不抽情绪
   · 0.5 置信度只当猜测，提示词里必须标「不太确定」，不许当事实复述
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraMemfacts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_memfacts_v1";
  var MAX_STORE = 60;
  var TYPES = ["event", "preference", "person"];
  var LEVELS = [0.5, 0.7, 0.9];

  function nowId() {
    return "mem" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  /* 置信度归一到三档：越界往低取（宁可当猜测） */
  function normConfidence(v) {
    var n = Number(v);
    if (!isFinite(n)) return 0.5;
    if (n >= 0.85) return 0.9;
    if (n >= 0.6) return 0.7;
    return 0.5;
  }

  function normType(t) {
    t = String(t || "").toLowerCase();
    return TYPES.indexOf(t) !== -1 ? t : "event";
  }

  /* ---------------- 存储 ---------------- */
  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  function save(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify((list || []).slice(-MAX_STORE)));
      return true;
    } catch (e) { return false; }
  }

  /* ---------------- 增 ---------------- */
  function normalizeFact(item) {
    if (!item || !item.fact) return null;
    return {
      id: item.id || nowId(),
      fact: String(item.fact).trim().slice(0, 60),
      type: normType(item.type),
      when: String(item.when || "").slice(0, 20),
      confidence: normConfidence(item.confidence),
      status: item.status === "deleted" ? "deleted" : "active",
      createdAt: item.createdAt || Date.now(),
      /* 第五篇 §6：用户纠正过就留痕；被纠正两次直接删 */
      correctedAt: item.correctedAt || null,
      corrections: item.corrections || 0,
      mutedTurns: item.mutedTurns || 0
    };
  }

  /* 去重：同一件事（字面高度相似）不重复存 */
  function similar(a, b) {
    a = String(a).replace(/[\s，。！？、,.!?]/g, "");
    b = String(b).replace(/[\s，。！？、,.!?]/g, "");
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length >= 4 && b.length >= 4 && (a.indexOf(b) !== -1 || b.indexOf(a) !== -1)) return true;
    return false;
  }

  function add(items, opts) {
    opts = opts || {};
    var list = opts.list || load();
    var added = [];
    (items || []).forEach(function (raw) {
      var it = normalizeFact(raw);
      if (!it) return;
      var dup = list.filter(function (m) {
        return m.status !== "deleted" && similar(m.fact, it.fact);
      })[0];
      if (dup) {
        /* 已有的更确定就保留，否则升级置信度 */
        if (it.confidence > dup.confidence) dup.confidence = it.confidence;
        return;
      }
      list.push(it);
      added.push(it);
    });
    save(list);
    return { list: list, added: added };
  }

  /* ---------------- 删（用户可逐条删） ---------------- */
  function remove(id, opts) {
    opts = opts || {};
    var list = opts.list || load();
    var hit = null;
    list.forEach(function (m) {
      if (m.id === id) { m.status = "deleted"; m.deletedAt = Date.now(); hit = m; }
    });
    save(list);
    return { list: list, removed: hit };
  }

  function restore(id, opts) {
    opts = opts || {};
    var list = opts.list || load();
    list.forEach(function (m) { if (m.id === id) { m.status = "active"; delete m.deletedAt; } });
    save(list);
    return list;
  }


  /* ---------------- 用户纠正（第五篇 §6） ----------------
     mode: 'deny'（否认：这事没发生过） | 'fix'（更正：改成对的）
     · 否认 → 直接标记 deleted，永不复活
     · 更正 → 更新 fact / when，留下 correctedAt
     · 同一条被纠正两次 → 直接删除
     · 纠正后 10 轮内不再进入上下文
  */
  function correct(id, patch, opts) {
    opts = opts || {};
    var list = opts.list || load();
    var hit = null;
    list.forEach(function (x) { if (x.id === id) hit = x; });
    if (!hit) return { list: list, item: null, action: "not_found" };

    patch = patch || {};
    hit.correctedAt = Date.now();
    hit.corrections = (hit.corrections || 0) + 1;

    if (patch.mode === "deny" || hit.corrections >= 2) {
      hit.status = "deleted";
      hit.deletedAt = Date.now();
      save(list);
      return { list: list, item: hit, action: "deleted" };
    }

    if (patch.fact) hit.fact = String(patch.fact).trim().slice(0, 60);
    if (patch.when !== undefined) hit.when = String(patch.when || "").slice(0, 20);
    if (patch.type) hit.type = normType(patch.type);
    /* 置信度：用户亲口更正的，记 0.9 */
    hit.confidence = 0.9;
    hit.mutedTurns = 10;
    save(list);
    return { list: list, item: hit, action: "fixed" };
  }

  /* 检索时递减静默轮数（纠正后 10 轮不出现） */
  function tickMuted(opts) {
    opts = opts || {};
    var list = opts.list || load();
    var changed = false;
    list.forEach(function (m) { if (m.mutedTurns > 0) { m.mutedTurns -= 1; changed = true; } });
    if (changed) save(list);
    return list;
  }

  /* ---------------- 检索（top-8，相关度 + 时间） ---------------- */
  function tokens(s) {
    var t = String(s || "");
    var out = [];
    /* 中文按二元组切，英文/数字按词切 */
    var cn = t.match(/[\u4e00-\u9fa5]+/g) || [];
    cn.forEach(function (seg) {
      for (var i = 0; i < seg.length - 1; i++) out.push(seg.slice(i, i + 2));
      if (seg.length === 1) out.push(seg);
    });
    var en = t.match(/[a-zA-Z0-9]+/g) || [];
    return out.concat(en);
  }

  function retrieve(query, opts) {
    opts = opts || {};
    var limit = opts.limit || 8;
    var now = opts.now || Date.now();
    var list = (opts.list || load()).filter(function (m) { return m.status !== "deleted" && !(m.mutedTurns > 0); });
    var qs = tokens(query);
    var scored = list.map(function (m) {
      var hay = m.fact + " " + (m.when || "");
      var hit = 0;
      qs.forEach(function (tk) { if (hay.indexOf(tk) !== -1) hit += 1; });
      var relevance = qs.length ? hit / Math.sqrt(qs.length) : 0;
      var ageDays = Math.max(0, (now - (m.createdAt || now)) / 86400000);
      var recency = 1 / (1 + ageDays / 14);          /* 两周半衰 */
      var conf = m.confidence;                        /* 0.5 / 0.7 / 0.9 */
      return { m: m, score: relevance * 2 + recency + conf };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, limit).map(function (s) { return s.m; });
  }

  /* ---------------- 抽取 ---------------- */
  function shouldExtract(turnCount, every) {
    var n = every || 7;
    return turnCount > 0 && turnCount % n === 0;
  }

  /* 解析模型输出：必须是 JSON 数组；非法条目丢弃 */
  function parseExtraction(raw) {
    var txt = String(raw || "").trim();
    if (!txt) return [];
    /* 去掉 ```json 围栏 */
    txt = txt.replace(/```json/gi, "```").replace(/```/g, "");
    /* §2.5：json_object 模式返回的是 {"items":[...]}，也兼容直接给数组 */
    var arr = null;
    var objMatch = txt.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        var obj = JSON.parse(objMatch[0]);
        if (obj && Array.isArray(obj.items)) arr = obj.items;
      } catch (e) { /* 继续试数组 */ }
    }
    if (!arr) {
      var m = txt.match(/\[[\s\S]*\]/);
      if (!m) return [];
      try { arr = JSON.parse(m[0]); } catch (e) { return []; }
    }
    if (!Array.isArray(arr)) return [];
    return arr.map(function (it) {
      if (!it || !it.fact) return null;
      var type = String(it.type || "").toLowerCase();
      if (TYPES.indexOf(type) === -1) return null;
      return {
        fact: String(it.fact).slice(0, 60),
        type: type,
        when: String(it.when || "").slice(0, 20),
        confidence: normConfidence(it.confidence)
      };
    }).filter(Boolean);
  }

  /* 给提示词用的视图：已删除的绝不出现 */
  function forPrompt(activeOnly) {
    var list = load().filter(function (m) { return m.status !== "deleted"; });
    if (activeOnly) return list;
    return list;
  }

  /* 统计（L3 回顾页用） */
  function stats() {
    var list = load();
    var active = list.filter(function (m) { return m.status !== "deleted"; });
    return {
      total: list.length,
      active: active.length,
      deleted: list.length - active.length,
      byType: {
        event: active.filter(function (m) { return m.type === "event"; }).length,
        preference: active.filter(function (m) { return m.type === "preference"; }).length,
        person: active.filter(function (m) { return m.type === "person"; }).length
      },
      unsure: active.filter(function (m) { return m.confidence === 0.5; }).length
    };
  }

  return {
    KEY: KEY, LEVELS: LEVELS, TYPES: TYPES,
    normConfidence: normConfidence, normType: normType,
    load: load, save: save, add: add, remove: remove, restore: restore,
    retrieve: retrieve, shouldExtract: shouldExtract,
    parseExtraction: parseExtraction, forPrompt: forPrompt,
    correct: correct,
    tickMuted: tickMuted,
    similar: similar, stats: stats
  };
});
