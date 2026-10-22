/* ============================================================
   timefmt.js —— 全项目**唯一**的时间格式化出口

   铁律（本轮 §1.1/§1.5）
     · 存储：UTC 毫秒数（number），绝不存格式化字符串
     · 显示：设备本地时区
     · 缺值：一律返回 "—"，**绝不**用当前时间顶替
     · 只有这里能拼时间字符串；别处禁止自拼
     · 等宽数字（tabular-nums）由 CSS 负责，这里只保证格式定长

   谁在用：
     App 消息时间戳 / 日期分割条 / 长按完整时间
     记录库、控制台表格、CSV·JSON 导出
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraTime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MISSING = "—";
  var MINUTE_GAP = 60 * 60 * 1000;     /* §1.2：同一天内间隔 > 1 小时才显示时间戳 */

  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function pad3(n) { return (n < 10 ? "00" : n < 100 ? "0" : "") + n; }

  /* 取值：接受 number / 数字字符串 / Date；其它一律当作"没有" */
  function ms(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
    if (v instanceof Date && !isNaN(v.getTime())) return v.getTime();
    return null;
  }
  function has(v) { return ms(v) !== null; }

  function D(v) { return new Date(ms(v)); }

  /* ---------------- 基础三件套 ---------------- */

  /* HH:mm:ss（24 小时制，定长 8 字符） */
  function hms(v) {
    var t = ms(v);
    if (t === null) return MISSING;
    var d = new Date(t);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  /* YYYY-MM-DD HH:mm:ss（定长 19 字符） */
  function full(v) {
    var t = ms(v);
    if (t === null) return MISSING;
    var d = new Date(t);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  /* YYYY-MM-DD HH:mm:ss.SSS */
  function fullMs(v) {
    var t = ms(v);
    if (t === null) return MISSING;
    var d = new Date(t);
    return full(t) + "." + pad3(d.getMilliseconds());
  }

  /* YYYY-MM-DD（定长 10 字符） */
  function ymd(v) {
    var t = ms(v);
    if (t === null) return MISSING;
    var d = new Date(t);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* ---------------- ISO 8601（带本地时区偏移） ----------------
     例：2026-10-22T14:30:27.482+08:00 */
  function iso(v) {
    var t = ms(v);
    if (t === null) return MISSING;
    var d = new Date(t);
    var off = -d.getTimezoneOffset();          /* 东八区 = 480 */
    var sign = off >= 0 ? "+" : "-";
    var oh = pad2(Math.floor(Math.abs(off) / 60));
    var om = pad2(Math.abs(off) % 60);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds()) +
      "." + pad3(d.getMilliseconds()) + sign + oh + ":" + om;
  }

  function tzLabel() {
    var off = -new Date().getTimezoneOffset();
    var sign = off >= 0 ? "+" : "-";
    var h = Math.floor(Math.abs(off) / 60);
    var m = Math.abs(off) % 60;
    return "GMT" + sign + h + (m ? ":" + pad2(m) : "");
  }

  /* ---------------- 日期分割条 ----------------
     今天 / 昨天 / 10月20日 / 2025年10月20日（跨年带年份） */
  function dayLabel(v, now) {
    var t = ms(v);
    if (t === null) return MISSING;
    var n = ms(now) === null ? Date.now() : ms(now);

    var a = new Date(t), b = new Date(n);
    var d0 = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
    var d1 = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
    var diffDays = Math.round((d1 - d0) / 86400000);

    if (diffDays === 0) return "今天";
    if (diffDays === 1) return "昨天";
    if (a.getFullYear() === b.getFullYear()) {
      return (a.getMonth() + 1) + "月" + a.getDate() + "日";
    }
    return a.getFullYear() + "年" + (a.getMonth() + 1) + "月" + a.getDate() + "日";
  }

  /* 是否该显示时间戳：同一天内，与上一条间隔 > 1 小时；跨天也算"该显示" */
  function shouldShow(v, prevV) {
    var t = ms(v);
    if (t === null) return false;
    var p = ms(prevV);
    if (p === null) return true;                       /* 第一条：显示 */
    var a = new Date(t), b = new Date(p);
    var sameDay = a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
    if (!sameDay) return true;
    return (t - p) > MINUTE_GAP;
  }

  function sameDay(a, b) {
    var x = ms(a), y = ms(b);
    if (x === null || y === null) return false;
    var p = new Date(x), q = new Date(y);
    return p.getFullYear() === q.getFullYear() && p.getMonth() === q.getMonth() && p.getDate() === q.getDate();
  }

  /* 两条之间的间隔，格式 HH:mm:ss（超过 24 小时就带天数） */
  function gapText(v, prevV) {
    var t = ms(v), p = ms(prevV);
    if (t === null || p === null) return MISSING;
    var d = t - p;
    if (d < 0) d = 0;
    var sec = Math.floor(d / 1000);
    var days = Math.floor(sec / 86400);
    var h = Math.floor((sec % 86400) / 3600);
    var m = Math.floor((sec % 3600) / 60);
    var s = sec % 60;
    var core = pad2(h) + ":" + pad2(m) + ":" + pad2(s);
    return days > 0 ? (days + "天 " + core) : core;
  }

  return {
    MISSING: MISSING,
    MINUTE_GAP: MINUTE_GAP,
    ms: ms,
    has: has,
    hms: hms,
    full: full,
    fullMs: fullMs,
    ymd: ymd,
    iso: iso,
    tzLabel: tzLabel,
    dayLabel: dayLabel,
    shouldShow: shouldShow,
    sameDay: sameDay,
    gapText: gapText
  };
});
