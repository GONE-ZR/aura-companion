/* ============================================================
   recycle.js —— 撤销删除 + 回收站（第六篇 §3）

   两层：
   ① 删完立刻出 5 秒撤销条，点了完整恢复
   ② 5 秒后进回收站，保留 30 天，到期自动清除

   刻意的限制：回收站**只存名字与删除时间，不存内容**。
   能预览内容的话，用户会反复回去看删掉的对话，破坏"往前过"的节奏。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraRecycle = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_trash_v1";
  var UNDO_MS = 5000;
  var KEEP_DAYS = 30;
  var pending = null;      /* 当前待确认的删除（撤销窗口内） */

  function load() {
    try {
      var raw = JSON.parse(localStorage.getItem(KEY) || "[]");
      return Array.isArray(raw) ? raw : [];
    } catch (e) { return []; }
  }
  function save(list) {
    try { localStorage.setItem(KEY, JSON.stringify(list.slice(-200))); } catch (e) { /* ignore */ }
  }
  function now() { return Date.now(); }

  /* 30 天到期自动清除（每次读取时顺手清） */
  function purgeExpired(list) {
    var t = now();
    var kept = (list || load()).filter(function (x) { return (x.expiresAt || 0) > t; });
    if (kept.length !== (list || []).length) save(kept);
    return kept;
  }

  /* ---------------- ① 删除 → 5 秒撤销窗口 ----------------
     item: { kind, label, restore: fn }
     label 只放名字（如"面试的事"），绝不放内容预览
  */
  function removeWithUndo(item, opts) {
    opts = opts || {};
    var rec = {
      id: "trash" + now().toString(36) + Math.random().toString(36).slice(2, 5),
      kind: item.kind,
      label: String(item.label || "").slice(0, 30),
      deletedAt: now(),
      expiresAt: now() + KEEP_DAYS * 86400000
    };
    pending = { rec: rec, restore: item.restore };
    showUndoBar(rec, opts);
    return rec;
  }

  function showUndoBar(rec, opts) {
    if (typeof document === "undefined") return;
    var old = document.getElementById("undo-bar");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var bar = document.createElement("div");
    bar.id = "undo-bar";
    bar.style.cssText = [
      "position:fixed", "left:50%", "transform:translateX(-50%)", "bottom:88px", "z-index:9300",
      "display:flex", "align-items:center", "gap:14px", "padding:10px 16px",
      "background:rgba(20,20,20,.92)", "color:#f5f3ee", "border-radius:10px",
      "font-size:13.5px", "font-family:inherit", "transition:opacity .3s ease"
    ].join(";");
    var txt = document.createElement("span");
    txt.textContent = "已删除";
    var btn = document.createElement("button");
    btn.textContent = "撤销";
    btn.style.cssText = "border:0;background:transparent;color:#9fd0c4;font:inherit;font-size:13.5px;cursor:pointer;text-decoration:underline";
    btn.onclick = function () {
      undo(rec.id);
      if (bar.parentNode) bar.parentNode.removeChild(bar);
    };
    bar.appendChild(txt);
    bar.appendChild(btn);
    document.body.appendChild(bar);

    setTimeout(function () {
      if (!bar.parentNode) return;
      bar.style.opacity = "0";
      setTimeout(function () {
        if (bar.parentNode) bar.parentNode.removeChild(bar);
        /* 撤销窗口过了 → 真正进回收站 */
        if (pending && pending.rec.id === rec.id) commit(pending.rec);
      }, 320);
    }, opts.ms || UNDO_MS);
  }

  /* 撤销窗口结束 → 写入回收站 */
  function commit(rec) {
    var list = load();
    list.push(rec);
    save(list);
    pending = null;
    return rec;
  }

  /* 用户点撤销 → 完整恢复（调用方提供的 restore） */
  function undo(id) {
    if (!pending || pending.rec.id !== id) return false;
    try {
      if (typeof pending.restore === "function") pending.restore();
    } catch (e) { /* ignore */ }
    pending = null;
    return true;
  }

  /* ---------------- ② 回收站 ---------------- */
  function list() { return purgeExpired(load()); }

  /* 彻底删除（不进回收站，需二次确认由调用方做） */
  function purge(id) {
    var all = load().filter(function (x) { return x.id !== id; });
    save(all);
    return all;
  }

  function purgeAll() { save([]); return []; }

  function stats() {
    var l = list();
    return {
      count: l.length,
      byKind: l.reduce(function (a, x) { a[x.kind] = (a[x.kind] || 0) + 1; return a; }, {})
    };
  }

  return {
    KEY: KEY, UNDO_MS: UNDO_MS, KEEP_DAYS: KEEP_DAYS,
    removeWithUndo: removeWithUndo,
    commit: commit,
    undo: undo,
    list: list,
    purge: purge,
    purgeAll: purgeAll,
    purgeExpired: purgeExpired,
    stats: stats,
    pending: function () { return pending; }
  };
});
