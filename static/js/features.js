/* ============================================================
   features.js —— 功能增强（多会话 / 搜索 / 长按菜单 / 导出 / 快捷短语 / 统计）
   独立文件，不改动 settings.js / chat.js 的既有逻辑。
   所有 UI 都在运行时创建，不依赖 index.html 的结构。
   ============================================================ */
(function () {
  "use strict";

  var A = window.Aura;
  if (!A) return;
  var S = A.store, cfg = A.cfg, bus = A.bus;
  var $ = function (id) { return document.getElementById(id); };

  var K_SESSIONS = "aura_sessions";
  var K_SHORTCUTS = "aura_shortcuts";
  var K_STATS = "aura_stats";

  /* ============================================================
     一、多会话
     ============================================================ */
  function rawSessions() {
    var list = S.get(K_SESSIONS, null);
    if (!Array.isArray(list) || !list.length) {
      list = [{ id: cfg.sessionId, title: "第一次说话", created: Date.now(), updated: Date.now(), deletedAt: null }];
      S.set(K_SESSIONS, list);
    }
    return list;
  }
  /* §1.2 统一出口：界面拿到的永远是"没被删的"，已删除的只在回收站里 */
  function sessions() {
    if (window.AuraRecords) return window.AuraRecords.sessions({});
    return rawSessions().filter(function (s) { return s && !s.deletedAt; });
  }
  function saveSessions(list) {
    /* 保存时保留墓碑（否则一次保存就把已删除的会话彻底抹掉） */
    if (window.AuraRecords) {
      var seen = {};
      (list || []).forEach(function (s) { if (s && s.id) seen[s.id] = true; });
      var tombstones = rawSessions().filter(function (s) { return s && s.deletedAt && !seen[s.id]; });
      S.set(K_SESSIONS, (list || []).concat(tombstones));
      return;
    }
    S.set(K_SESSIONS, list);
  }

  /* 把 localStorage 里存在、但没登记过的历史会话补进列表（不丢老对话） */
  function registerOrphanSessions() {
    var list = sessions();
    var known = {};
    list.forEach(function (s) { known[s.id] = true; });
    var orphans = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf("aura_msgs_") !== 0) continue;
        var sid = k.slice("aura_msgs_".length);
        if (!sid || known[sid]) continue;
        /* B-4：软删除的消息不该把会话重新登记回来 */
        if (window.AuraRecords && window.AuraRecords.messages(sid).length === 0) continue;
        known[sid] = true;
        var msgs = S.get(k, []) || [];
        var title = "旧的对话";
        for (var j = 0; j < msgs.length; j++) {
          if (msgs[j].role === "me" && msgs[j].content) {
            title = msgs[j].content.replace(/\[发了一张图片\]/g, "").trim().slice(0, 14) || title;
            break;
          }
        }
        orphans.push({ id: sid, title: title, created: Date.now(), updated: Date.now(), orphan: true });
      }
    } catch (e) { /* ignore */ }
    if (orphans.length) {
      list = list.concat(orphans);
      saveSessions(list);
    }
  }

  function currentSession() {
    var list = sessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === cfg.sessionId) return list[i];
    }
    /* 会话被删光 / 刚删完当前会话时 list 可能是空的 ——
       这里必须给一个安全的兜底，否则 syncTitle() 会抛 TypeError 把界面打断 */
    return list[0] || { id: cfg.sessionId, title: "新的对话", created: Date.now(), updated: Date.now() };
  }

  function touchSession() {
    var list = sessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === cfg.sessionId) {
        list[i].updated = Date.now();
        /* 没标题就用第一句当标题 */
        if (!list[i].title || list[i].title === "新的对话") {
          var msgs = A.messages.load();
          for (var j = 0; j < msgs.length; j++) {
            if (msgs[j].role === "me" && msgs[j].content) {
              var t = msgs[j].content.replace(/\[发了一张图片\]/g, "").trim();
              if (t) { list[i].title = t.slice(0, 14); break; }
            }
          }
        }
      }
    }
    saveSessions(list);
  }

  function newSession() {
    var list = sessions();
    var id = "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    list.unshift({ id: id, title: "新的对话", created: Date.now(), updated: Date.now() });
    saveSessions(list);
    A.chat.loadSession(id);
    renderSessions();
    return id;
  }

  function deleteSession(id) {
    /* §1 数据层：软删除（会话 + 其下消息一起打删除标记），30 天内可恢复。
       这里不再物理删数据 —— 物理删除只在 30 天到期清理时发生。 */
    if (window.AuraRecords) {
      var info = window.AuraRecords.softDeleteSession(id);
      var rest = window.AuraRecords.sessions({});
      if (cfg.sessionId === id) {
        if (rest.length) A.chat.loadSession(rest[0].id);
        else newSession();                  /* 空状态：她在，先说一句 */
      }
      renderSessions();
      /* 5 秒撤销条（recycle.js 已实现，这里接上） */
      if (window.AuraRecycle && info) {
        window.AuraRecycle.removeWithUndo({
          kind: "session",
          label: (info.session && info.session.title) || "未命名",
          restore: function () {
            window.AuraRecords.restoreSession(id);
            renderSessions();
            A.chat.loadSession(id);
          }
        }, { count: info.messages });
      }
      return;
    }

    var list = sessions().filter(function (s) { return s.id !== id; });
    if (!list.length) {
      list = [{ id: "s" + Date.now().toString(36), title: "新的对话", created: Date.now(), updated: Date.now() }];
    }
    saveSessions(list);
    S.del("aura_msgs_" + id);
    if (cfg.sessionId === id) A.chat.loadSession(list[0].id);
    renderSessions();
  }

  function renameSession(id, title) {
    var list = sessions();
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) list[i].title = (title || "新的对话").slice(0, 24);
    }
    saveSessions(list);
    renderSessions();
  }

  /* ============================================================
     二、搜索（跨会话）
     ============================================================ */
  function searchAll(q) {
    q = String(q || "").trim().toLowerCase();
    if (!q) return [];
    var out = [];
    sessions().forEach(function (s) {
      var msgs = window.AuraRecords ? window.AuraRecords.messages(s.id) : (S.get("aura_msgs_" + s.id, []) || []);
      msgs.forEach(function (m, idx) {
        if (m.content && m.content.toLowerCase().indexOf(q) !== -1) {
          out.push({ session: s, index: idx, text: m.content, role: m.role });
        }
      });
    });
    return out;
  }

  /* ============================================================
     三、导出
     ============================================================ */
  function exportMarkdown() {
    var msgs = A.messages.load();
    var lines = ["# 对话记录", "", "- 会话：" + (currentSession().title || ""),
                 "- 导出时间：" + (window.AuraTime ? window.AuraTime.full(Date.now()) : ""), "", "---", ""];
    msgs.forEach(function (m) {
      lines.push((m.role === "me" ? "我：" : "陪伴：") + " " + (m.content || ""));
      lines.push("");
    });
    download("quiet-companion-" + today() + ".md", lines.join("\n"), "text/markdown;charset=utf-8");
  }

  function exportJson() {
    /* §1.1：导出时间一律 ISO 8601（含毫秒与时区），不导毫秒数也不导本地化字符串 */
    var iso = function (v) { return window.AuraTime ? window.AuraTime.iso(v) : new Date(v).toISOString(); };
    var msgs = A.messages.load().map(function (m) {
      return {
        id: m.id, role: m.role, content: m.content,
        createdAt: iso(m.ts), bubbleCount: m.bubbleCount || 1
      };
    });
    var data = {
      app: "quiet-companion",
      schemaVersion: 1,
      exported_at: iso(Date.now()),
      session: currentSession(),
      messages: msgs
    };
    download("quiet-companion-" + today() + ".json", JSON.stringify(data, null, 2), "application/json");
  }

  function today() {
    var d = new Date();
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function download(name, content, mime) {
    try {
      var blob = new Blob([content], { type: mime || "text/plain;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () {
        URL.revokeObjectURL(a.href);
        if (a.parentNode) a.parentNode.removeChild(a);
      }, 1500);
      toast("已导出 " + name);
    } catch (e) {
      toast("导出失败");
    }
  }

  /* ============================================================
     四、统计
     ============================================================ */
  function stats() {
    var msgs = A.messages.load();
    var mine = 0, theirs = 0, chars = 0;
    msgs.forEach(function (m) {
      if (m.role === "me") mine++; else theirs++;
      chars += (m.content || "").length;
    });
    var days = 0;
    try {
      var h = S.get(K_STATS, null) || {};
      var seen = h.days || [];
      var k = today();
      if (seen.indexOf(k) === -1) {
        seen.push(k);
        if (seen.length > 400) seen = seen.slice(-400);
        S.set(K_STATS, { days: seen });
      }
      days = seen.length;
    } catch (e) { days = 0; }
    return { total: msgs.length, mine: mine, theirs: theirs, chars: chars, days: days };
  }

  /* ============================================================
     五、快捷短语
     ============================================================ */
  var DEFAULT_SHORTCUTS = ["我有点累", "睡不着", "今天还行", "想安静待会儿"];
  function shortcuts() {
    var list = S.get(K_SHORTCUTS, null);
    if (!Array.isArray(list)) {
      list = DEFAULT_SHORTCUTS.slice();
      S.set(K_SHORTCUTS, list);
    }
    return list;
  }

  /* ============================================================
     六、DOM 构建（全部运行时创建）
     ============================================================ */
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  function makeSwitch(label, on, onChange) {
    var wrap = el("div", "ft-row");
    var lb = el("span", "ft-label", label);
    var btn = el("button", "switch");
    btn.setAttribute("role", "switch");
    btn.appendChild(el("i"));
    function set(v) {
      btn.classList.toggle("on", !!v);
      btn.setAttribute("aria-checked", v ? "true" : "false");
    }
    set(on);
    btn.addEventListener("click", function () {
      var v = btn.getAttribute("aria-checked") !== "true";
      set(v);
      onChange(v);
    });
    wrap.appendChild(lb);
    wrap.appendChild(btn);
    return wrap;
  }

  /* ---------- 抽屉里的「会话」板块 ---------- */
  var sessionListEl = null;
  var searchInput = null;
  var searchResultEl = null;

  function buildSessionSection() {
    var body = document.querySelector("#drawer .drawer-body");
    if (!body || document.getElementById("ft-sessions")) return;

    var sec = el("h3", "sec", "会话");
    sec.setAttribute("data-feature", "multiSession");
    sec.id = "ft-sessions";
    var wrap = el("div", "ft-section");
    wrap.id = "ft-sessions-wrap";

    var search = el("div", "ft-search");
    searchInput = el("input", "txt");
    searchInput.setAttribute("data-feature", "search");
    searchInput.type = "search";
    searchInput.placeholder = "搜索所有对话…";
    searchInput.addEventListener("input", function () { renderSearch(); });
    search.appendChild(searchInput);
    wrap.appendChild(search);

    searchResultEl = el("div", "ft-results");
    wrap.appendChild(searchResultEl);

    sessionListEl = el("div", "ft-sessions");
    wrap.appendChild(sessionListEl);

    var row = el("div", "btn-row");
    var nb = el("button", "btn primary", "新建对话");
    nb.addEventListener("click", function () {
      newSession();
      var i = $("input");
      if (i) i.focus();
    });
    row.appendChild(nb);
    var eb = el("button", "btn", "导出 Markdown");
    eb.setAttribute("data-feature", "export");
    eb.addEventListener("click", exportMarkdown);
    row.appendChild(eb);
    var ej = el("button", "btn", "导出 JSON");
    ej.setAttribute("data-feature", "export");
    ej.addEventListener("click", exportJson);
    row.appendChild(ej);
    wrap.appendChild(row);

    var st = el("p", "ft-stats", "");
    st.id = "ft-stats";
    wrap.appendChild(st);

    body.insertBefore(wrap, body.firstChild);
    body.insertBefore(sec, wrap);
    renderSessions();
  }

  function renderSessions() {
    if (!sessionListEl) return;
    sessionListEl.textContent = "";
    sessions().forEach(function (s) {
      var row = el("div", "ft-session" + (s.id === cfg.sessionId ? " on" : ""));
      var t = el("button", "ft-session-title", s.title || "新的对话");
      t.addEventListener("click", function () {
        A.chat.loadSession(s.id);
        renderSessions();
      });
      row.appendChild(t);
      var n = el("span", "ft-session-n", String((window.AuraRecords ? window.AuraRecords.messages(s.id) : (S.get("aura_msgs_" + s.id, []) || [])).length));
      row.appendChild(n);
      var del = el("button", "ft-session-del", "×");
      del.title = "删除这个会话";
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (sessions().length <= 1) { toast("至少留一个会话"); return; }
        if (confirm("删掉这个会话？里面的对话会一起没了。")) deleteSession(s.id);
      });
      row.appendChild(del);
      sessionListEl.appendChild(row);
    });
    var st = $("ft-stats");
    if (st) {
      var s2 = stats();
      st.textContent = "聊过 " + s2.days + " 天 · 共 " + s2.total + " 句（我 " + s2.mine + " / 陪伴 " + s2.theirs + "）· " + s2.chars + " 字";
    }
  }

  function renderSearch() {
    if (!searchResultEl) return;
    searchResultEl.textContent = "";
    var q = searchInput.value;
    if (!q.trim()) return;
    var res = searchAll(q).slice(0, 30);
    if (!res.length) {
      searchResultEl.appendChild(el("p", "ft-empty", "没有找到"));
      return;
    }
    res.forEach(function (r) {
      var b = el("button", "ft-result");
      b.textContent = (r.role === "me" ? "我：" : "陪伴：") + r.text.slice(0, 60);
      b.addEventListener("click", function () {
        A.chat.loadSession(r.session.id);
        renderSessions();
        searchInput.value = "";
        searchResultEl.textContent = "";
      });
      searchResultEl.appendChild(b);
    });
  }

  /* ---------- 消息长按菜单 ---------- */
  function buildMessageMenu() {
    var menu = el("div", "ft-menu");
    menu.id = "ft-menu";
    menu.hidden = true;
    var scrim = el("div", "ft-menu-scrim");
    scrim.hidden = true;
    scrim.addEventListener("click", function () { hideMenu(); });
    document.body.appendChild(scrim);
    document.body.appendChild(menu);

    function show(x, y, msg, node) {
      menu.textContent = "";
      var items = [
        ["复制", function () { copyText(msg.content); }],
        ["重发这一句", function () {
          /* 把这条之前的内容删掉，重新发 */
          var msgs = A.messages.load();
          var idx = msgs.indexOf(msg);
          if (idx > 0) {
            msgs = msgs.slice(0, idx);
            A.messages.save(msgs);
            A.chat.reload();
            var i = $("input");
            if (i) { i.value = msg.content; i.dispatchEvent(new Event("input")); }
            A.chat.send();
          }
        }],
        ["从这里重新开始", function () {
          var msgs = A.messages.load();
          var idx = msgs.indexOf(msg);
          if (idx >= 0) {
            msgs = msgs.slice(0, idx);
            A.messages.save(msgs);
            A.chat.reload();
            toast("删掉了后面的");
          }
        }],
        ["删掉这一句", function () {
          /* §1 数据层：软删除 + 5 秒撤销（位置与顺序靠 deletedAt 恢复，不靠重排） */
          var sid = A.cfg.sessionId;
          if (window.AuraRecords) {
            var hit = window.AuraRecords.softDeleteMessage(sid, msg.id);
            if (hit && window.AuraRecycle) {
              window.AuraRecycle.removeWithUndo({
                kind: "message",
                label: "1 条消息",
                restore: function () {
                  window.AuraRecords.restoreMessage(sid, msg.id);
                  A.chat.reload();
                }
              }, { count: 1 });
            }
            A.chat.reload();
            return;
          }
          var msgs = A.messages.load();
          var idx = msgs.indexOf(msg);
          if (idx >= 0) {
            msgs.splice(idx, 1);
            A.messages.save(msgs);
            A.chat.reload();
          }
        }]
      ];
      items.forEach(function (it) {
        var b = el("button", "ft-menu-item", it[0]);
        b.addEventListener("click", function () { hideMenu(); it[1](); });
        menu.appendChild(b);
      });
      menu.hidden = false;
      scrim.hidden = false;
      var w = menu.offsetWidth || 160;
      var h = menu.offsetHeight || 160;
      menu.style.left = Math.max(8, Math.min(window.innerWidth - w - 8, x - w / 2)) + "px";
      menu.style.top = Math.max(8, Math.min(window.innerHeight - h - 8, y - h - 12)) + "px";
    }
    function hideMenu() { menu.hidden = true; scrim.hidden = true; }

    /* 事件委托：点气泡 → 菜单 */
    document.addEventListener("click", function (e) {
      var log = $("log");
      if (!log) return;
      var bubble = e.target.closest ? e.target.closest(".msg .bubble") : null;
      if (!bubble) { if (!e.target.closest || !e.target.closest(".ft-menu")) hideMenu(); return; }
      var node = bubble.closest(".msg");
      var msgs = A.messages.load();
      /* 气泡按顺序对应消息数组 */
      var idx = Array.prototype.indexOf.call(node.parentNode.children, node);
      var msg = msgs[idx];
      if (!msg) return;
      var r = bubble.getBoundingClientRect();
      show(r.left + r.width / 2, r.top, msg, node);
    });

    window.Aura.features = window.Aura.features || {};
    window.Aura.features.hideMenu = hideMenu;
  }

  function copyText(t) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t);
      } else {
        var ta = document.createElement("textarea");
        ta.value = t;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      toast("复制了");
    } catch (e) {
      toast("复制失败，长按选中吧");
    }
  }

  /* ---------- 快捷短语条 ---------- */
  function renderShortcutChips(wrap, list) {
    wrap.textContent = "";
    (list || []).forEach(function (item, i) {
      var b = el("button", "ft-chip", item);
      b.addEventListener("click", function () {
        var inp = $("input");
        if (!inp) return;
        inp.value = item;
        inp.dispatchEvent(new Event("input"));
        inp.focus();
      });
      b.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        var cur = shortcuts();
        cur.splice(i, 1);
        S.set(K_SHORTCUTS, cur);
        renderShortcutChips(wrap, cur);
      });
      wrap.appendChild(b);
    });
  }

  function buildShortcuts() {
    var bar = document.getElementById("attach-row");
    var inputBar = document.getElementById("input-bar");
    if (!inputBar || document.getElementById("ft-shortcuts")) return;
    var wrap = el("div", "ft-shortcuts");
    wrap.setAttribute("data-feature", "shortcuts");
    wrap.id = "ft-shortcuts";
    renderShortcutChips(wrap, shortcuts());
    /* 放在输入区上方 */
    inputBar.parentNode.insertBefore(wrap, inputBar);
  }

  /* ---------- 顶栏：情绪表情（会生气/高兴/兴奋…） ---------- */
  function buildFace() {
    var who = document.querySelector("#top .who");
    if (!who || document.getElementById("ft-face")) return;
    var b = el("button", "ft-face");
    b.setAttribute("data-feature", "moodFace");
    b.id = "ft-face";
    b.title = "它现在的情绪";
    b.setAttribute("aria-label", "情绪状态");
    b.addEventListener("click", function () {
      if (window.Aura.ui && window.Aura.ui.openSheet) window.Aura.ui.openSheet();
      else if (window.Aura.ui && window.Aura.ui.openDrawer) window.Aura.ui.openDrawer();
    });
    who.appendChild(b);
    paintFace();
    bus.on("face:change", function (f) { paintFace(f); });
  }

  function paintFace(f) {
    var b = document.getElementById("ft-face");
    if (!b) return;
    if (!f && window.Aura.mood) f = window.Aura.mood.currentEmotion();
    var type = (f && f.type) || "calm";
    var inten = (f && f.intensity) || 0;
    var face = (window.Aura.expr && window.Aura.expr.faceFor)
      ? window.Aura.expr.faceFor(type, inten) : "calm";
    b.innerHTML = (window.Aura.expr ? window.Aura.expr.svg(type, inten) : "");
    b.setAttribute("data-face", face);
    b.setAttribute("data-i", String(inten));
    b.title = "它现在：" + (window.Aura.expr ? window.Aura.expr.label(face) : "平静");
  }

  /* ---------- 情感面板：今天它的心情 ---------- */
  function buildFaceNote() {
    var note = document.getElementById("sheet-note");
    if (!note || document.getElementById("ft-face-note")) return;
    var box = el("div", "ft-face-note");
    box.setAttribute("data-feature", "moodFace");
    box.id = "ft-face-note";
    note.parentNode.insertBefore(box, note.nextSibling);
    paintFaceNote();
    bus.on("face:change", function () { paintFaceNote(); });
  }

  function paintFaceNote() {
    var box = document.getElementById("ft-face-note");
    if (!box || !window.Aura.expr) return;
    var evs = window.Aura.expr.eventsToday();
    box.textContent = "";
    if (!evs.length) return;
    var seen = {};
    var uniq = [];
    evs.forEach(function (e) { if (!seen[e.t]) { seen[e.t] = 1; uniq.push(e.t); } });
    box.appendChild(el("span", "ft-face-note-label", "今天它"));
    uniq.slice(-6).forEach(function (t) {
      var s = el("span", "ft-face-chip", window.Aura.expr.label(t));
      s.setAttribute("data-face", t);
      s.innerHTML = window.Aura.expr.svg(t, 2) + "<i>" + window.Aura.expr.label(t) + "</i>";
      box.appendChild(s);
    });
  }

  /* ---------- 顶栏：会话名 + 快速切换 ---------- */
  function buildTitleTweak() {
    var top = document.getElementById("top");
    if (!top) return;
    var who = top.querySelector(".who");
    if (!who || document.getElementById("ft-session-title")) return;
    var t = el("button", "ft-session-title", "");
    t.id = "ft-session-title";
    t.title = "点一下切换会话";
    t.addEventListener("click", function () {
      if (A.ui && A.ui.openDrawer) A.ui.openDrawer();
    });
    who.appendChild(t);
    syncTitle();
  }
  function syncTitle() {
    var t = document.getElementById("ft-session-title");
    if (!t) return;
    var s = currentSession();
    t.textContent = (s && s.title) || "新的对话";
  }

  /* ============================================================
     初始化
     ============================================================ */
  function loadCss() {
    if (document.getElementById("aura-features-css")) return;
    var l = document.createElement("link");
    l.id = "aura-features-css";
    l.rel = "stylesheet";
    l.href = "/static/css/features.css";
    document.head.appendChild(l);
  }

  function init() {
    loadCss();
    registerOrphanSessions();
    buildSessionSection();
    buildMessageMenu();
    buildShortcuts();
    buildTitleTweak();
    buildFace();
    buildFaceNote();
    renderSessions();

    /* 聊天有新消息 → 更新会话标题与统计 */
    var lastLen = A.messages.load().length;
    setInterval(function () {
      var len = A.messages.load().length;
      if (len !== lastLen) {
        lastLen = len;
        touchSession();
        renderSessions();
        syncTitle();
      }
    }, 1200);

    /* 抽屉打开时刷新会话列表 */
    var drawer = document.getElementById("drawer");
    if (drawer) {
      var mo = new MutationObserver(function () {
        if (!drawer.classList.contains("open")) return;
        renderSessions();
        var st = document.getElementById("ft-stats");
        if (st) {
          var s2 = stats();
          st.textContent = "聊过 " + s2.days + " 天 · 共 " + s2.total + " 句（我 " + s2.mine + " / 陪伴 " + s2.theirs + "）· " + s2.chars + " 字";
        }
      });
      mo.observe(drawer, { attributes: true, attributeFilter: ["class"] });
    }
  }

  window.Aura.features = window.Aura.features || {};
  window.Aura.features.init = init;
  window.Aura.features.sessions = sessions;
  window.Aura.features.newSession = newSession;
  window.Aura.features.stats = stats;
  window.Aura.features.exportMarkdown = exportMarkdown;
  window.Aura.features.exportJson = exportJson;
  window.Aura.features.onSessionSwitch = function () { syncTitle(); renderSessions(); };
  window.Aura.features.copyText = copyText;
  window.Aura.features.renderShortcuts = function () {
    var wrap = document.getElementById('ft-shortcuts');
    if (!wrap) return;
    renderShortcutChips(wrap, shortcuts());
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
