/* ============================================================
   expressions.js —— 情绪的"脸"
   让情绪看得见：8 种情绪各一个极简线条表情（SVG，无 emoji、无位图）
   强度 0-3 决定表情的幅度（平静 → 明显）
   ============================================================ */
(function () {
  "use strict";
  var A = window.Aura;
  if (!A) return;

  /* 每个表情都是 24×24 的描边图形，stroke 用 currentColor */
  var FACES = {
    /* 平静：一条平缓的弧 */
    calm: '<path d="M5 14c2.2-2.6 11.8-2.6 14 0" />',
    /* 高兴：弯眼 + 上扬嘴角 */
    happy: '<path d="M6.5 12.5c1.2-1.6 3-1.6 4.2 0" /><path d="M13.3 12.5c1.2-1.6 3-1.6 4.2 0" /><path d="M8 16.4c1.9 1.7 6.1 1.7 8 0" />',
    /* 兴奋：张嘴 + 放射短线 */
    excited: '<path d="M6.6 12.2c1.2-1.7 3-1.7 4.2 0" /><path d="M13.2 12.2c1.2-1.7 3-1.7 4.2 0" /><path d="M8.2 15.8c1.8 3.2 5.8 3.2 7.6 0z" /><path d="M12 4.4V2.6M5.2 6.2 4 4.6M18.8 6.2 20 4.6" />',
    /* 心疼：半闭眼 + 很轻的嘴角 */
    tender: '<path d="M6.4 13.2c1.3-1.1 3-1.1 4.3 0" /><path d="M13.3 13.2c1.3-1.1 3-1.1 4.3 0" /><path d="M9 17.2c1.8.8 4.2.8 6 0" />',
    /* 生气：斜眉 + 竖着的嘴 */
    angry: '<path d="M5.8 10.6 10.2 12.2" /><path d="M18.2 10.6 13.8 12.2" /><path d="M12 15.2v3.4" />',
    /* 低落：垂下的眼 + 平嘴 */
    low: '<path d="M6.6 12.6c1.3 1.2 3 1.2 4.3 0" /><path d="M13.3 12.6c1.3 1.2 3 1.2 4.3 0" /><path d="M9 17.6h6" />',
    /* 闷：皱眉 + 波浪嘴 */
    stifled: '<path d="M6.6 11.6c1.2 1.1 3 1.1 4.2 0" /><path d="M13.2 11.6c1.2 1.1 3 1.1 4.2 0" /><path d="M8.4 16.6c1.2-1.3 2.4 1.3 3.6 0s2.4 1.3 3.6 0" />',
    /* 有点在意：一只眼 + 小撇 */
    jealous: '<path d="M6.6 13c1.2-1.2 3-1.2 4.2 0" /><path d="M13.6 12.4c1.1-1 2.7-1 3.8 0" /><path d="M9.4 17.4c1.6-.9 3.6-.9 5.2 0" />',
    /* 好奇：一点 + 小问号 */
    curious: '<circle cx="12" cy="12.5" r="1.5" /><path d="M15.6 15.8c1.9 1.5 3.6.4 3.4-1.6-.2-1.9-2.4-2.2-2.4-.6" />'
  };

  var LABELS = {
    calm: "平静", happy: "高兴", excited: "兴奋", tender: "心疼",
    angry: "生气", low: "低落", stifled: "闷", jealous: "有点在意", curious: "好奇"
  };

  /* 强度 → 表情与幅度 */
  function faceFor(type, intensity) {
    var t = type || "calm";
    if (t === "happy" && (intensity || 0) >= 3) t = "excited";   /* 高兴到顶 = 兴奋 */
    if (t === "curious" && (intensity || 0) >= 3) t = "excited";
    if (!FACES[t]) t = "calm";
    return t;
  }

  function svg(type, intensity) {
    var t = faceFor(type, intensity);
    var s = FACES[t];
    return '<svg class="aura-face" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" ' +
      'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
      s + "</svg>";
  }

  /* 情绪事件记录（今天它高兴过 / 生气过） */
  function record(type, intensity) {
    var t = faceFor(type, intensity);
    var key = "aura_mood_events";
    var list = A.store.get(key, null);
    if (!Array.isArray(list)) list = [];
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var day = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    list.push({ d: day, t: t, i: intensity || 0, at: d.getTime() });
    if (list.length > 120) list = list.slice(-120);
    A.store.set(key, list);
    return list;
  }

  function eventsToday() {
    var list = A.store.get("aura_mood_events", null);
    if (!Array.isArray(list)) return [];
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    var day = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
    return list.filter(function (e) { return e.d === day; });
  }

  window.Aura.expr = {
    svg: svg,
    faceFor: faceFor,
    label: function (t) { return LABELS[t] || "平静"; },
    labels: LABELS,
    record: record,
    eventsToday: eventsToday,
    faces: FACES
  };
})();
