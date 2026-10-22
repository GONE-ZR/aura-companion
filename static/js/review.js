/* ============================================================
   review.js —— L3 回顾页（任务书 §七 L3）

   内容：情绪周曲线 / 纪念日 / 记忆管理（可逐条删）
   硬性：**不得出现在主界面** —— 只能从设置里进（二级页）。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraReview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LOG_KEY = "aura_emotion_log_v1";

  /* ---------------- 每天记一笔（给周曲线用） ---------------- */
  function logToday(state) {
    if (!state) return [];
    var log = loadLog();
    var d = new Date();
    var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    var hit = log.filter(function (x) { return x.date === key; })[0];
    if (hit) { hit.state = state; }
    else log.push({ date: key, state: state });
    if (log.length > 60) log = log.slice(-60);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) { /* ignore */ }
    return log;
  }

  function loadLog() {
    try {
      var raw = JSON.parse(localStorage.getItem(LOG_KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  /* 最近 7 天（缺的那天补 null） */
  function last7() {
    var log = loadLog();
    var map = {};
    log.forEach(function (x) { map[x.date] = x.state; });
    var out = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(Date.now() - i * 86400000);
      var key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
      out.push({ date: key, label: (d.getMonth() + 1) + "/" + d.getDate(), state: map[key] || null });
    }
    return out;
  }

  /* 状态 → 曲线上的高度（不显示任何数值，只画感觉） */
  var LEVEL = { blank: 0.15, serious: 0.3, sulky: 0.55, low: 0.35, tired: 0.4, calm: 0.72, soft: 0.88 };
  function levelOf(state) {
    return typeof LEVEL[state] === "number" ? LEVEL[state] : 0.5;
  }

  /* ---------------- 页面 ---------------- */
  function open() {
    var old = document.getElementById("review-page");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var page = document.createElement("div");
    page.id = "review-page";
    page.style.cssText = [
      "position:fixed", "inset:0", "z-index:9500", "background:var(--paper,#f1efea)",
      "color:var(--ink,#14140f)", "overflow:auto", "padding:22px 20px 60px",
      "font-family:inherit"
    ].join(";");

    /* 顶栏 */
    var bar = document.createElement("div");
    bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:22px";
    var h = document.createElement("div");
    h.style.cssText = "font-family:var(--serif,serif);font-size:20px";
    h.textContent = "回顾";
    var close = document.createElement("button");
    close.className = "btn";
    close.textContent = "关闭";
    close.onclick = function () { page.remove(); };
    bar.appendChild(h);
    bar.appendChild(close);
    page.appendChild(bar);

    /* 情绪周曲线 */
    var sec1 = document.createElement("div");
    sec1.style.cssText = "margin-bottom:26px";
    var t1 = document.createElement("div");
    t1.style.cssText = "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim,#6b665d);margin-bottom:10px";
    t1.textContent = "这一周";
    sec1.appendChild(t1);

    var week = last7();
    var chart = document.createElement("div");
    chart.style.cssText = "display:flex;align-items:flex-end;gap:8px;height:110px;padding:8px 0";
    week.forEach(function (d) {
      var col = document.createElement("div");
      col.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;gap:6px";
      var barEl = document.createElement("div");
      var hl = d.state ? levelOf(d.state) * 88 : 4;
      barEl.style.cssText = [
        "width:100%", "border-radius:4px 4px 2px 2px",
        "height:" + Math.max(4, Math.round(hl)) + "px",
        "background:" + (d.state ? "var(--acc-h-deep, #8CA6A0)" : "rgba(0,0,0,.08)"),
        "opacity:" + (d.state ? "1" : ".5"),
        "transition:height .6s ease"
      ].join(";");
      var lab = document.createElement("div");
      lab.style.cssText = "font-size:11px;color:var(--dim,#6b665d)";
      lab.textContent = d.label;
      col.appendChild(barEl);
      col.appendChild(lab);
      chart.appendChild(col);
    });
    sec1.appendChild(chart);
    var cap = document.createElement("div");
    cap.style.cssText = "font-size:12px;color:var(--dim,#6b665d);line-height:1.8";
    cap.textContent = "高度只是「感觉」，不是数值。她有自己的日子，低的那几天不一定是因为你。";
    sec1.appendChild(cap);
    page.appendChild(sec1);

    /* 记忆管理 */
    var sec2 = document.createElement("div");
    var t2 = document.createElement("div");
    t2.style.cssText = "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim,#6b665d);margin:8px 0 10px";
    t2.textContent = "她记得的事";
    sec2.appendChild(t2);

    var list = (window.AuraMemfacts ? window.AuraMemfacts.forPrompt() : []);
    if (!list.length) {
      var empty = document.createElement("div");
      empty.style.cssText = "font-size:14px;color:var(--dim,#6b665d);line-height:1.9";
      empty.textContent = "还什么都没记。聊几次之后她会记住一些具体的事。";
      sec2.appendChild(empty);
    }
    list.forEach(function (m) {
      var row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid rgba(0,0,0,.07)";
      var txt = document.createElement("div");
      txt.style.cssText = "flex:1;font-size:14px;line-height:1.7";
      var tag = m.confidence === 0.9 ? "" : m.confidence === 0.7 ? "（大概）" : "（不太确定）";
      txt.textContent = m.fact + tag + (m.when ? " · " + m.when : "");
      var del = document.createElement("button");
      del.className = "btn";
      del.textContent = "删掉";
      del.style.cssText = "font-size:12px;padding:5px 10px";
      del.onclick = function () {
        if (window.AuraMemfacts) window.AuraMemfacts.remove(m.id);
        row.style.opacity = "0";
        setTimeout(function () { row.remove(); }, 220);
      };
      row.appendChild(txt);
      row.appendChild(del);
      sec2.appendChild(row);
    });
    page.appendChild(sec2);


    /* ---- 已删除（回收站）：只显示名字与时间，不显示内容 ----
       ★ 唯一真相是 records 的 deletedAt（不是 recycle.js 那张"只有名字"的表）。
         回收站必须能「恢复」和「彻底删除」，否则删了就既找不回也清不掉。 */
    if (window.AuraRecords) {
      var sec4 = document.createElement("div");
      sec4.style.cssText = "margin-top:26px";
      var t4 = document.createElement("div");
      t4.style.cssText = "font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim,#6b665d);margin-bottom:10px";
      t4.textContent = "已删除";
      sec4.appendChild(t4);

      var trash = window.AuraRecords.trash();
      if (!trash.length) {
        var e4 = document.createElement("div");
        e4.style.cssText = "font-size:13px;color:var(--dim,#6b665d);line-height:1.9";
        e4.textContent = "没有已删除的东西。";
        sec4.appendChild(e4);
      }
      trash.forEach(function (it) {
        var row = document.createElement("div");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:9px 0;border-bottom:1px solid rgba(0,0,0,.07)";

        var name = document.createElement("div");
        name.style.cssText = "flex:1;font-size:14px";
        /* 只有名字 + 删除日期，绝不放内容 */
        var dLabel = (window.AuraTime ? window.AuraTime.dayLabel(it.deletedAt) : "") || "";
        name.textContent = it.title + "　" + dLabel + "删除";

        var n = window.AuraRecords.rawMessages(it.id).length;   /* 真删的条数（含软删的） */
        var rbtn = document.createElement("button");
        rbtn.className = "btn";
        rbtn.textContent = "恢复";
        rbtn.style.cssText = "font-size:12px;padding:5px 10px";
        rbtn.onclick = function () {
          window.AuraRecords.restoreSession(it.id);
          row.remove();
          toast("已恢复");
          if (typeof window.__auraRefreshReview === "function") window.__auraRefreshReview();
        };

        var del = document.createElement("button");
        del.className = "btn";
        del.textContent = "彻底删除";
        del.style.cssText = "font-size:12px;padding:5px 10px";
        del.onclick = function () {
          if (!window.confirm("这个会话的 " + n + " 条消息会被永久删除，无法恢复。确定？")) return;
          window.AuraRecords.hardDeleteSession(it.id);
          row.remove();
          toast("已彻底删除");
        };

        row.appendChild(name);
        row.appendChild(rbtn);
        row.appendChild(del);
        sec4.appendChild(row);
      });
      page.appendChild(sec4);
    }

    /* 纪念日 */
    var sec3 = document.createElement("div");
    sec3.style.cssText = "margin-top:26px;font-size:13px;color:var(--dim,#6b665d);line-height:1.9";
    var first = "";
    try { first = localStorage.getItem("aura_first_chat_at") || ""; } catch (e) { }
    if (!first) {
      var now = new Date().toJSON().slice(0, 10);
      try { localStorage.setItem("aura_first_chat_at", now); } catch (e) { }
      first = now;
    }
    sec3.textContent = "第一次说话：" + first;
    page.appendChild(sec3);

    document.body.appendChild(page);
  }

  return {
    LOG_KEY: LOG_KEY,
    logToday: logToday,
    loadLog: loadLog,
    last7: last7,
    levelOf: levelOf,
    open: open
  };
});
