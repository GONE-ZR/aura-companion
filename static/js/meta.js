/* ============================================================
   meta.js —— 输出协议（任务书 §六）

   流式首行是 {"e":"表情键","b":"背景键","i":0|1|2}
   · 收到 meta 立刻切表情与背景（先于正文）
   · 表情切换 600–1200ms 缓动
   · 正文按 \n 或 >28 字拆成多条气泡
   · 兜底：3 秒内没拿到合法 meta，或首行不是 { 开头 → 默认 calm/warm/0，不报错不阻塞
   · 表情键非法 → 降级 calm
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraMeta = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var validE = ["calm", "smile", "soft", "tease", "sulky", "serious", "blank", "tired"];
  var validB = ["warm", "dusk", "cool", "gray"];
  var DEFAULT = { e: "calm", b: "warm", i: 0 };

  function fallbackMeta() {
    return { e: DEFAULT.e, b: DEFAULT.b, i: DEFAULT.i, fallback: true };
  }

  function sanitize(obj) {
    if (!obj || typeof obj !== "object") return null;
    var e = String(obj.e || "").toLowerCase();
    var b = String(obj.b || "").toLowerCase();
    var i = Number(obj.i);
    if (!isFinite(i)) i = 0;
    i = i < 0 ? 0 : i > 2 ? 2 : Math.round(i);
    var badE = validE.indexOf(e) === -1;
    var badB = validB.indexOf(b) === -1;
    if (badE && badB) return null;                 /* 两个都不认识 → 当没给 */
    return {
      e: badE ? DEFAULT.e : e,
      b: badB ? DEFAULT.b : b,
      i: i,
      degraded: badE || badB
    };
  }

  /* 解析一行（可能带前后空白 / 代码块围栏） */
  function parseLine(line) {
    var s = String(line || "").trim();
    s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    if (!s || s.charAt(0) !== "{") return null;
    /* 只取第一个完整的 {...} */
    var depth = 0, end = -1;
    for (var i = 0; i < s.length; i++) {
      if (s.charAt(i) === "{") depth++;
      else if (s.charAt(i) === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) return null;
    var obj;
    try { obj = JSON.parse(s.slice(0, end)); } catch (e) { return null; }
    return sanitize(obj);
  }

  /* ---------------- 流式状态机 ----------------
     用法：
       const m = createMetaStream({ onMeta, onDelta, onDone });
       m.push(chunk)  // 分片喂进来
       m.end()
     行为：
       · 第一行是合法标签 → 立刻 onMeta，剩余部分作为正文
       · 第一行不像标签 → 直接当正文（onMeta 用兜底）
       · 3 秒还没定 → 兜底 meta，之后照常出字
  */
  function createMetaStream(opts) {
    opts = opts || {};
    var buf = "";
    var decided = false;
    var timer = null;
    var done = false;

    function decide(meta) {
      if (decided) return;
      decided = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (opts.onMeta) opts.onMeta(meta || fallbackMeta());
    }

    function flushBody(text) {
      if (!text) return;
      if (opts.onDelta) opts.onDelta(text);
    }

    if (typeof setTimeout === "function") {
      timer = setTimeout(function () {
        if (!decided) {
          /* 3 秒兜底：把已收到的当正文 */
          decide(fallbackMeta());
          var t = buf;
          buf = "";
          flushBody(t);
        }
      }, opts.timeoutMs || 3000);
    }

    function push(chunk) {
      if (done) return;
      var s = String(chunk || "");
      if (!s) return;
      buf += s;

      if (!decided) {
        var nl = buf.indexOf("\n");
        if (nl === -1) {
          /* 还没到换行：先看它像不像 JSON 开头；超过 64 字符肯定不是标签 */
          var head = buf.trim();
          if (head.charAt(0) !== "{" || head.length > 64) {
            decide(fallbackMeta());
            var all = buf; buf = "";
            flushBody(all);
          }
          return;
        }
        /* 有换行了：拿第一行判 */
        var first = buf.slice(0, nl);
        var rest = buf.slice(nl + 1);
        var meta = parseLine(first);
        buf = "";
        decide(meta || fallbackMeta());
        flushBody(rest);
        return;
      }
      var out = buf; buf = "";
      flushBody(out);
    }

    function end() {
      if (done) return;
      done = true;
      if (timer) { clearTimeout(timer); timer = null; }
      if (!decided) {
        var meta = parseLine(buf);
        if (meta) {
          decide(meta);
        } else {
          decide(fallbackMeta());
          flushBody(buf);
          buf = "";
          return;
        }
      }
      if (buf) { flushBody(buf); buf = ""; }
      if (opts.onDone) opts.onDone();
    }

    return { push: push, end: end, isDecided: function () { return decided; } };
  }

  /* ---------------- 拆气泡（§六 第 3 条） ---------------- */
  function splitBubbles(text, opts) {
    opts = opts || {};
    var max = opts.max || 28;
    var raw = String(text || "").trim();
    if (!raw) return [];
    var out = [];
    raw.split(/\n+/).forEach(function (para) {
      var p = para.trim();
      if (!p) return;
      if (p.length <= max) { out.push(p); return; }
      /* 优先在标点处断 */
      var rest = p;
      while (rest.length > max) {
        var cut = -1;
        var window = rest.slice(0, max + 6);
        var m = window.match(/[。！？…；，、]/g);
        if (m) {
          var idx = window.lastIndexOf(m[m.length - 1]);
          if (idx >= max * 0.5) cut = idx + 1;
        }
        if (cut === -1) cut = max;
        out.push(rest.slice(0, cut).trim());
        rest = rest.slice(cut).trim();
      }
      if (rest) out.push(rest);
    });
    return out.slice(0, 5);
  }

  return {
    validE: validE, validB: validB, DEFAULT: DEFAULT,
    fallbackMeta: fallbackMeta, sanitize: sanitize, parseLine: parseLine,
    createMetaStream: createMetaStream, splitBubbles: splitBubbles
  };
});
