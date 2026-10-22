/* ============================================================
   wide.js —— 电脑网页端宽屏双栏（≥768px）

   规格（本轮 §2.1）
     · 左栏 280~320px（可拖到 420），宽度记住
     · 左栏：置顶 ≤3 / 最近活跃 / 已归档入口
     · 每项：标题 + 她最后一句前 12 字 + 时间
     · 切换会话只切数据，**不碰**情绪、忍耐值、记忆、立绘

   时间显示说明（冲突已标注）：
     本轮第一部分规定「禁止相对时间」，而 §2.1 原文写的是「相对时间」。
     这里按第一部分的硬约束执行：**绝对时间**（今天 HH:mm:ss / 更早 MM-DD），
     走同一个 AuraTime，不另写格式化。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraWide = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LEFT_KEY = "aura_wide_left";
  var MIN = 280;
  var MAX = 420;
  var DEFAULT = 300;

  var panel = null;
  var listEl = null;
  var resizer = null;
  var mq = null;

  function store() {
    return (typeof window !== "undefined" && window.Aura && window.Aura.store) ? window.Aura.store : null;
  }
  function cfg() { return (window.Aura && window.Aura.cfg) || {}; }
  function records() { return window.AuraRecords || null; }
  function timefmt() { return window.AuraTime || null; }

  function clamp(w) { return Math.max(MIN, Math.min(MAX, Math.round(w))); }

  function applyWidth(w) {
    var v = clamp(w);
    document.documentElement.style.setProperty("--wl", v + "px");
    var s = store();
    if (s) s.setStr(LEFT_KEY, String(v));
    return v;
  }

  function savedWidth() {
    var s = store();
    var raw = s ? Number(s.getStr(LEFT_KEY, "")) : NaN;
    return isFinite(raw) && raw > 0 ? clamp(raw) : DEFAULT;
  }

  /* 时间：今天 → HH:mm:ss；更早 → MM-DD（绝对时间，不用相对时间） */
  function shortTime(ts) {
    var T = timefmt();
    if (!T) return "";
    if (!T.has(ts)) return T.MISSING;
    if (T.sameDay(ts, Date.now())) return T.hms(ts);
    var d = T.ymd(ts);                 /* YYYY-MM-DD */
    return d.slice(5);                 /* MM-DD */
  }

  function lastText(sid) {
    var R = records();
    if (!R) return "";
    var m = R.lastMessage(sid);
    if (!m || !m.content) return "";
    return String(m.content).replace(/\s+/g, " ").slice(0, 12);
  }

  /* ---------------- 渲染左栏 ---------------- */
  function render() {
    if (!listEl) return;
    var R = records();
    if (!R) return;

    var all = R.sessions({});
    var pinned = all.filter(function (s) { return !!s.pinned; }).slice(0, 3);
    var normal = all.filter(function (s) { return !s.pinned; });
    var archived = R.sessions({ archived: true });

    listEl.textContent = "";

    function item(s) {
      var row = document.createElement("div");
      row.className = "wl-item" + (s.id === cfg().sessionId ? " on" : "");
      row.setAttribute("data-sid", s.id);

      var title = document.createElement("div");
      title.className = "wl-title";
      if (s.pinned) {
        var pin = document.createElement("span");
        pin.className = "wl-pin";
        pin.textContent = "置顶";
        title.appendChild(pin);
      }
      var name = document.createElement("span");
      name.style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      name.textContent = s.title || "新的对话";
      title.appendChild(name);

      var sub = document.createElement("div");
      sub.className = "wl-sub";
      var last = document.createElement("span");
      last.className = "wl-last";
      last.textContent = lastText(s.id) || "—";
      var t = document.createElement("span");
      t.className = "wl-time";
      t.textContent = shortTime(s.updated);
      sub.appendChild(last);
      sub.appendChild(t);

      row.appendChild(title);
      row.appendChild(sub);

      row.addEventListener("click", function () {
        if (window.Aura && window.Aura.chat) window.Aura.chat.loadSession(s.id);
        render();
      });

      /* 右键 = 重命名 / 置顶 / 归档 / 删除（与长按同一套入口） */
      row.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        openMenu(e.clientX, e.clientY, s);
      });

      return row;
    }

    if (!all.length) {
      var empty = document.createElement("div");
      empty.className = "wl-empty";
      empty.textContent = "还没有会话。点上面的「新建」开始。";
      listEl.appendChild(empty);
    } else {
      pinned.forEach(function (s) { listEl.appendChild(item(s)); });
      normal.forEach(function (s) { listEl.appendChild(item(s)); });
    }

    var arch = document.getElementById("wide-arch");
    if (arch) {
      arch.textContent = "";
      var left = document.createElement("span");
      left.textContent = "已归档";
      var right = document.createElement("span");
      right.textContent = String(archived.length);
      arch.appendChild(left);
      arch.appendChild(right);
      arch.style.display = archived.length ? "flex" : "none";
      arch.onclick = function () {
        if (window.Aura.features && window.Aura.features.showArchived) {
          window.Aura.features.showArchived();
        }
      };
    }
  }

  /* ---------------- 会话菜单 ---------------- */
  var menu = null;
  function closeMenu() {
    if (menu && menu.parentNode) menu.parentNode.removeChild(menu);
    menu = null;
  }
  function openMenu(x, y, s) {
    closeMenu();
    var R = records();
    if (!R) return;
    menu = document.createElement("div");
    menu.id = "wide-menu";
    menu.style.cssText = "position:fixed;z-index:80;min-width:132px;padding:5px;border-radius:8px;" +
      "background:#20201e;color:#f5f3ee;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.22)";

    function add(label, fn) {
      var b = document.createElement("button");
      b.textContent = label;
      b.style.cssText = "display:block;width:100%;text-align:left;border:0;background:transparent;" +
        "color:inherit;font:inherit;padding:7px 10px;border-radius:6px;cursor:pointer";
      b.onmouseenter = function () { b.style.background = "rgba(255,255,255,.09)"; };
      b.onmouseleave = function () { b.style.background = "transparent"; };
      b.onclick = function () { closeMenu(); fn(); };
      menu.appendChild(b);
    }

    add("重命名", function () {
      var v = window.prompt("新标题", s.title || "");
      if (v === null) return;
      R.renameSession(s.id, String(v).trim() || "新的对话");
      render();
      if (window.Aura.features && window.Aura.features.sessions) window.Aura.features.onSessionSwitch && window.Aura.features.onSessionSwitch();
    });
    add(s.pinned ? "取消置顶" : "置顶", function () {
      var pinnedCount = R.sessions({}).filter(function (x) { return x.pinned; }).length;
      if (!s.pinned && pinnedCount >= 3) { window.alert("最多置顶 3 个"); return; }
      R.setFlag(s.id, "pinned", !s.pinned);
      render();
    });
    add(s.archived ? "取消归档" : "归档", function () {
      R.setFlag(s.id, "archived", !s.archived);
      render();
    });
    add("删除", function () {
      var n = R.rawMessages(s.id).length;
      if (!window.confirm("这个会话的 " + n + " 条消息会被删除，30 天内可恢复。")) return;
      if (window.Aura.features && window.Aura.features.deleteSession) {
        window.Aura.features.deleteSession(s.id);
      } else {
        R.softDeleteSession(s.id);
      }
      render();
    });

    document.body.appendChild(menu);
    var w = 140, h = 190;
    menu.style.left = Math.min(x, window.innerWidth - w - 8) + "px";
    menu.style.top = Math.min(y, window.innerHeight - h - 8) + "px";
    setTimeout(function () {
      document.addEventListener("pointerdown", closeMenu, { once: true });
    }, 20);
  }

  /* ---------------- 拖动调宽 ---------------- */
  function bindResizer() {
    if (!resizer) return;
    var dragging = false;
    resizer.addEventListener("pointerdown", function (e) {
      dragging = true;
      resizer.classList.add("drag");
      try { resizer.setPointerCapture(e.pointerId); } catch (err) { }
      e.preventDefault();
    });
    resizer.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      applyWidth(e.clientX);
    });
    function stop() {
      if (!dragging) return;
      dragging = false;
      resizer.classList.remove("drag");
    }
    resizer.addEventListener("pointerup", stop);
    resizer.addEventListener("pointercancel", stop);
  }

  /* ---------------- 开关 ---------------- */
  function build() {
    if (document.getElementById("wide-left")) return;
    panel = document.createElement("aside");
    panel.id = "wide-left";
    panel.setAttribute("aria-label", "会话列表");

    var head = document.createElement("div");
    head.className = "wl-head";
    var label = document.createElement("span");
    label.textContent = "会话";
    var nb = document.createElement("button");
    nb.className = "wl-new";
    nb.type = "button";
    nb.textContent = "新建";
    nb.addEventListener("click", function () {
      if (window.Aura.features && window.Aura.features.newSession) window.Aura.features.newSession();
      render();
    });
    head.appendChild(label);
    head.appendChild(nb);

    listEl = document.createElement("div");
    listEl.className = "wl-list";

    var arch = document.createElement("div");
    arch.className = "wl-arch";
    arch.id = "wide-arch";
    arch.style.display = "none";

    panel.appendChild(head);
    panel.appendChild(listEl);
    panel.appendChild(arch);
    document.body.appendChild(panel);

    resizer = document.createElement("div");
    resizer.id = "wide-resize";
    resizer.setAttribute("role", "separator");
    resizer.setAttribute("aria-orientation", "vertical");
    resizer.title = "拖动调整宽度";
    document.body.appendChild(resizer);
    bindResizer();

    render();
  }

  function apply() {
    var wide = window.matchMedia && window.matchMedia("(min-width: 768px)").matches;
    document.body.classList.toggle("wide", !!wide);
    if (wide) {
      if (!panel) build();
      applyWidth(savedWidth());
      render();
    }
  }

  function init() {
    applyWidth(savedWidth());
    apply();
    mq = window.matchMedia("(min-width: 768px)");
    var onChange = function () { apply(); };
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else if (mq.addListener) mq.addListener(onChange);

    /* 会话变化时刷新（新建/删除/切换/发消息） */
    document.addEventListener("aura:sessions", render);
    document.addEventListener("aura:session", render);
    setInterval(function () {
      if (document.body.classList.contains("wide")) render();
    }, 4000);
  }

  return {
    init: init,
    render: render,
    apply: apply,
    applyWidth: applyWidth,
    savedWidth: savedWidth,
    MIN: MIN,
    MAX: MAX,
    shortTime: shortTime
  };
});
