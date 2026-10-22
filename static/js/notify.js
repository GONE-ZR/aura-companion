/* ============================================================
   notify.js —— 桌面通知的**唯一守卫**（App 与网页端共用同一套）

   规格（本轮 §2.4）
     · 静默时段 23:00–08:00
     · 全类合计每日 2 条（主动问候 ≤1）
     · 四类开关独立：问候 / 提醒 / 天气 / 回归
     · 最近 5 分钟内在本设备有活动 → 本设备不推（人刚看过）
     · 内容禁止出现「等你 / 想你 / 好久没来」
     · 点击通知 → 打开对应会话，**不自动发送**

   ★ 诚实的限制：多设备之间的"共用一个当日计数"需要跨设备同步，
     本轮没有上报通道，所以计数是**每台设备各自本地**的。
     跨设备真正共用计数要等「局域网上报」或导出合并（第三部分）。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraNotify = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DAILY_MAX = 2;
  var PROACTIVE_MAX = 1;
  var QUIET_START = 23 * 60;         /* 23:00 */
  var QUIET_END = 8 * 60;            /* 08:00 */
  var ACTIVE_WINDOW = 5 * 60 * 1000; /* 5 分钟 */

  var FORBIDDEN = ["等你", "想你", "好久没来", "好久不见", "怎么还不来"];

  var lastActive = 0;
  var lastShown = 0;      /* 去抖：同一条 30 秒内不重复 */

  function S() {
    return (typeof window !== "undefined" && window.Aura && window.Aura.store) ? window.Aura.store : null;
  }
  function dayKey(now) {
    var d = new Date(now);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function countKey(now) { return "aura_notify_count_" + dayKey(now); }
  function proactiveKey(now) { return "aura_notify_proactive_" + dayKey(now); }

  function count(now) {
    var s = S();
    var v = s ? Number(s.getStr(countKey(now || Date.now()), "0")) : 0;
    return isFinite(v) ? v : 0;
  }
  function bump(now) {
    var s = S();
    if (!s) return 0;
    var k = countKey(now || Date.now());
    var v = count(now) + 1;
    s.setStr(k, String(v));
    return v;
  }
  function proactiveCount(now) {
    var s = S();
    var v = s ? Number(s.getStr(proactiveKey(now || Date.now()), "0")) : 0;
    return isFinite(v) ? v : 0;
  }
  function bumpProactive(now) {
    var s = S();
    if (!s) return 0;
    var v = proactiveCount(now) + 1;
    s.setStr(proactiveKey(now || Date.now()), String(v));
    return v;
  }

  function minuteOfDay(now) {
    var d = new Date(now);
    return d.getHours() * 60 + d.getMinutes();
  }
  function inQuiet(now) {
    var m = minuteOfDay(now);
    if (QUIET_START <= QUIET_END) return m >= QUIET_START && m < QUIET_END;
    return m >= QUIET_START || m < QUIET_END;   /* 跨午夜 */
  }

  /* 四类开关（默认全开，可单独关） */
  var KINDS = ["greeting", "reminder", "weather", "return"];
  function kindOn(kind) {
    var s = S();
    if (!s) return true;
    var raw = s.getStr("aura_notify_kind_" + kind, "");
    return raw !== "0";
  }

  function hasForbidden(text) {
    var t = String(text || "");
    for (var i = 0; i < FORBIDDEN.length; i++) {
      if (t.indexOf(FORBIDDEN[i]) !== -1) return FORBIDDEN[i];
    }
    return null;
  }

  function markActive(now) {
    lastActive = now || Date.now();
    var s = S();
    if (s) s.setStr("aura_notify_active_at", String(lastActive));
  }
  function activeRecently(now) {
    var t = now || Date.now();
    var s = S();
    var stored = s ? Number(s.getStr("aura_notify_active_at", "0")) : 0;
    var last = Math.max(lastActive || 0, isFinite(stored) ? stored : 0);
    return last > 0 && (t - last) < ACTIVE_WINDOW;
  }

  /* ---------------- 守卫（纯函数式，可单测） ---------------- */
  function can(kind, now, text) {
    var t = now || Date.now();
    if (kind && KINDS.indexOf(kind) !== -1 && !kindOn(kind)) {
      return { ok: false, reason: "kind-off" };
    }
    if (hasForbidden(text)) return { ok: false, reason: "forbidden-text" };
    if (inQuiet(t)) return { ok: false, reason: "quiet-hours" };
    if (activeRecently(t)) {
      /* 5 分钟内在本设备有活动 = 人刚看过 → 本设备不推 */
      return { ok: false, reason: "recently-active" };
    }
    if (count(t) >= DAILY_MAX) return { ok: false, reason: "daily-cap" };
    if (kind === "greeting" && proactiveCount(t) >= PROACTIVE_MAX) {
      return { ok: false, reason: "proactive-cap" };
    }
    return { ok: true, reason: null, used: count(t), limit: DAILY_MAX };
  }

  function supported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  function permission() {
    if (!supported()) return "unsupported";
    return window.Notification.permission;
  }

  function requestPermission() {
    if (!supported()) return Promise.resolve("unsupported");
    if (window.Notification.permission !== "default") {
      return Promise.resolve(window.Notification.permission);
    }
    return window.Notification.requestPermission().catch(function () { return "denied"; });
  }

  /* 真正弹一条（守卫不通过就静默返回） */
  function show(opts) {
    opts = opts || {};
    var now = opts.now || Date.now();
    var text = String(opts.body || "");
    var gate = can(opts.kind, now, text);
    if (!gate.ok) return { shown: false, reason: gate.reason };
    if (!supported() || window.Notification.permission !== "granted") {
      return { shown: false, reason: "no-permission" };
    }
    if (now - lastShown < 30000) return { shown: false, reason: "debounce" };

    var n;
    try {
      n = new window.Notification(String(opts.title || "小纯"), {
        body: text,
        tag: opts.tag || "aura-" + (opts.kind || "misc"),
        silent: !!opts.silent
      });
    } catch (e) {
      return { shown: false, reason: "error" };
    }
    lastShown = now;
    bump(now);
    if (opts.kind === "greeting") bumpProactive(now);

    n.onclick = function () {
      try { window.focus(); } catch (e) { }
      if (opts.sessionId && window.Aura && window.Aura.chat) {
        window.Aura.chat.loadSession(opts.sessionId);   /* 只切会话，不自动发送 */
      }
      try { n.close(); } catch (e) { }
    };
    return { shown: true, reason: null, used: count(now) };
  }

  function stats(now) {
    var t = now || Date.now();
    return {
      supported: supported(),
      permission: permission(),
      quiet: inQuiet(t),
      used: count(t),
      limit: DAILY_MAX,
      proactiveUsed: proactiveCount(t),
      proactiveLimit: PROACTIVE_MAX,
      recentlyActive: activeRecently(t),
      kinds: KINDS.reduce(function (a, k) { a[k] = kindOn(k); return a; }, {})
    };
  }

  function init() {
    markActive(Date.now() - ACTIVE_WINDOW - 1);   /* 启动不算"刚活动" */
    ["pointerdown", "keydown", "touchstart"].forEach(function (ev) {
      document.addEventListener(ev, function () { markActive(Date.now()); }, { passive: true });
    });
  }

  return {
    DAILY_MAX: DAILY_MAX,
    PROACTIVE_MAX: PROACTIVE_MAX,
    QUIET: [QUIET_START, QUIET_END],
    KINDS: KINDS,
    init: init,
    can: can,
    show: show,
    stats: stats,
    markActive: markActive,
    activeRecently: activeRecently,
    inQuiet: inQuiet,
    supported: supported,
    permission: permission,
    requestPermission: requestPermission,
    hasForbidden: hasForbidden,
    /* 测试用：消耗一次配额（等价于真的弹了一条） */
    _use: function (kind, now) {
      var t = now || Date.now();
      bump(t);
      if (kind === "greeting") bumpProactive(t);
      return count(t);
    },
    /* 测试用：重置当天计数 */
    _reset: function () {
      var s = S();
      if (!s) return;
      var t = Date.now();
      s.setStr(countKey(t), "0");
      s.setStr(proactiveKey(t), "0");
    }
  };
});
