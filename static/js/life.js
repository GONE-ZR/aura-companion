/* ============================================================
   life.js —— 生活线落盘（第五篇 §2）

   规则（硬）：
   · 每天 2~3 条 LifeEvent，**当天生成后不可改写**
   · 禁止由主对话模型临场编造日程
   · 情绪状态的 cause 改为读取 LifeEvent，不再临场生成
   · 节奏校验：7 天内 work ≤50%、不允许连续两天同 kind、
     sleepless+mishap 每周 ≤2、每周 ≥3 天含 hobby/rest
   · 生成失败沿用前一天一条，**不随机补假的**
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraLife = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_life_events_v1";
  var KINDS = ["work", "traffic", "hobby", "rest", "sleepless", "mishap", "social"];

  var TEXT = {
    work: ["加班到八点，回家路上堵了很久", "上午连着两个会，脑子是卡的", "改了三版方案，还被说不够主动"],
    traffic: ["早高峰挤了一路，鞋被踩了", "地铁晚点二十分钟，站着到的", "回来那趟堵在高架上"],
    hobby: ["追了两集剧，没看够", "把那个积木拼完了", "在听一张老专辑"],
    rest: ["下午睡了半小时，人缓过来", "什么都没干，躺了一天", "把房间收拾了一遍"],
    sleepless: ["凌晨三点还醒着", "翻来覆去到天亮", "做了个乱梦，起来有点懵"],
    mishap: ["手机摔了一下，屏幕有道痕", "泡面洒在键盘上，收拾半天", "出门忘带伞，淋了一段"],
    social: ["同事叫去吃饭，没去", "跟老同学聊了会儿", "楼下阿姨拉着说了两句"]
  };

  /* 生活事件 → 她的状态 */
  var STATE_OF = {
    work: "tired", traffic: "tired", sleepless: "tired",
    mishap: "low",
    hobby: "soft", rest: "soft", social: "soft"
  };

  function dayKey(d) {
    d = d ? new Date(d) : new Date();
    var p = function (n) { return (n < 10 ? "0" : "") + n; };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-200))); } catch (e) { /* ignore */ }
  }

  function hash(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function rng(seed) {
    var a = seed;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* 最近 n 天（不含今天）的事件 */
  function recent(days, now) {
    var list = load();
    var from = Date.now() - (days || 7) * 86400000;
    return list.filter(function (e) {
      var t = new Date(e.date + "T12:00:00").getTime();
      return t >= from && e.date !== dayKey(now);
    });
  }

  function countKinds(list) {
    var c = {};
    list.forEach(function (e) { c[e.kind] = (c[e.kind] || 0) + 1; });
    return c;
  }

  /* 节奏校验（§2 硬规则） */
  function audit7(list) {
    var total = list.length || 1;
    var c = countKinds(list);
    var workPct = (c.work || 0) / total;
    /* 连续两天同 kind：按日期分组后检查相邻天是否有交集 */
    var byDate = {};
    list.forEach(function (e) { (byDate[e.date] = byDate[e.date] || []).push(e.kind); });
    var dates = Object.keys(byDate).sort();
    /* 「主事件」= 当天第一条非 social/rest（就是她会给的那个原因） */
    var mainOf = function (d) {
      var ks = byDate[d];
      return ks.filter(function (k) { return k !== "social" && k !== "rest"; })[0] || ks[0];
    };
    var consecutiveSame = 0;
    for (var i = 1; i < dates.length; i++) {
      var d1 = new Date(dates[i - 1] + "T12:00:00").getTime();
      var d2 = new Date(dates[i] + "T12:00:00").getTime();
      if (Math.round((d2 - d1) / 86400000) !== 1) continue;
      if (mainOf(dates[i - 1]) === mainOf(dates[i])) consecutiveSame += 1;
    }
    var bad2 = (c.sleepless || 0) + (c.mishap || 0);
    var hobbyRestDays = dates.filter(function (d) {
      return byDate[d].some(function (k) { return k === "hobby" || k === "rest"; });
    }).length;
    return {
      workPct: workPct,
      consecutiveSame: consecutiveSame,
      sleeplessMishap: bad2,
      hobbyRestDays: hobbyRestDays,
      ok: workPct <= 0.5 && consecutiveSame === 0 && bad2 <= 2 && hobbyRestDays >= 3
    };
  }

  /* 生成某天的事件（确定性；当天只生成一次） */
  function generateFor(dateStr, prevList) {
    var r = rng(hash(dateStr + "|xiaochun"));
    var prev = prevList || recent(7, new Date(dateStr + "T12:00:00"));
    var c = countKinds(prev);
    var dates = {};
    prev.forEach(function (e) { (dates[e.date] = dates[e.date] || []).push(e.kind); });
    var yesterday = dayKey(new Date(new Date(dateStr + "T12:00:00").getTime() - 86400000));
    var yKinds = dates[yesterday] || [];

    /* 候选池：剔除昨天用过的 kind（不许连续两天同 kind） */
    var pool = KINDS.filter(function (k) { return yKinds.indexOf(k) === -1; });
    if (!pool.length) pool = KINDS.slice();

    /* 每周配额 */
    if ((c.sleepless || 0) + (c.mishap || 0) >= 2) {
      pool = pool.filter(function (k) { return k !== "sleepless" && k !== "mishap"; });
      if (!pool.length) pool = ["rest", "hobby", "social"];
    }
    var hobbyDays = Object.keys(dates).filter(function (d) {
      return dates[d].some(function (k) { return k === "hobby" || k === "rest"; });
    }).length;
    if (hobbyDays < 3) {
      /* 补 hobby/rest：优先 */
      var need = pool.filter(function (k) { return k === "hobby" || k === "rest"; });
      if (need.length && r() < 0.75) pool = need.concat(pool.filter(function (k) { return need.indexOf(k) === -1; }));
    }
    /* work 占比上限 50% */
    if ((c.work || 0) / Math.max(1, prev.length) >= 0.5) {
      pool = pool.filter(function (k) { return k !== "work"; });
      if (!pool.length) pool = ["rest", "hobby"];
    }

    var n = 2 + (r() < 0.4 ? 1 : 0);            /* 2~3 条 */
    var picked = [];
    var badThisWeek = (c.sleepless || 0) + (c.mishap || 0);
    for (var i = 0; i < n && pool.length; i++) {
      var idx = Math.floor(r() * pool.length);
      var k = pool[idx];
      if (picked.indexOf(k) !== -1) { continue; }
      /* 同一天不重复；sleepless/mishap 每天最多 1 条，且整周不超过 2 */
      if (k === "sleepless" || k === "mishap") {
        if (badThisWeek >= 2 || picked.some(function (x) { return x === "sleepless" || x === "mishap"; })) continue;
        badThisWeek += 1;
      }
      picked.push(k);
    }
    if (!picked.length) picked = ["rest"];

    return picked.map(function (k, i) {
      var arr = TEXT[k] || ["今天没什么特别的"];
      var tx = arr[Math.floor(r() * arr.length)];
      return {
        id: "life_" + dateStr + "_" + i,
        date: dateStr,
        kind: k,
        text: tx,
        state: STATE_OF[k] || "calm",
        createdAt: Date.now()
      };
    });
  }

  /* 确保今天有事件（当天只生成一次，之后不可改写） */
  function ensureToday(now) {
    var dk = dayKey(now);
    var list = load();
    var today = list.filter(function (e) { return e.date === dk; });
    if (today.length) return today;                  /* 已有 → 永不改写 */

    var fresh = generateFor(dk);
    /* 生成失败：沿用前一天一条，不随机补假的 */
    if (!fresh.length) {
      var y = list.filter(function (e) { return e.date === dayKey(Date.now() - 86400000); });
      if (y.length) {
        fresh = [Object.assign({}, y[0], { id: "life_" + dk + "_0", date: dk, carried: true })];
      }
    }
    var next = list.concat(fresh);
    save(next);
    return fresh;
  }

  function today(now) { return ensureToday(now); }

  /* 给引擎的 cause：取今天最主要的那条 */
  function causeFor(now) {
    var ev = ensureToday(now);
    if (!ev.length) return null;
    /* 优先取非 social / 非 rest 的（更有故事） */
    var main = ev.filter(function (e) { return e.kind !== "social" && e.kind !== "rest"; })[0] || ev[0];
    return {
      type: main.kind,
      detail: main.text,
      source: "life",
      at: main.createdAt,
      lifeEventId: main.id
    };
  }

  /* 她的状态：由事件种类推 */
  function stateFor(now) {
    var ev = ensureToday(now);
    var kinds = ev.map(function (e) { return e.kind; });
    if (kinds.indexOf("sleepless") !== -1) return "tired";
    if (kinds.indexOf("work") !== -1 || kinds.indexOf("traffic") !== -1) return "tired";
    if (kinds.indexOf("mishap") !== -1) return "low";
    if (kinds.indexOf("hobby") !== -1 || kinds.indexOf("rest") !== -1) return "soft";
    return "calm";
  }

  return {
    KEY: KEY, KINDS: KINDS, TEXT: TEXT,
    dayKey: dayKey,
    load: load,
    recent: recent,
    audit7: audit7,
    generateFor: generateFor,
    ensureToday: ensureToday,
    today: today,
    causeFor: causeFor,
    stateFor: stateFor,
    _reset: function () { try { localStorage.removeItem(KEY); } catch (e) { } }
  };
});
