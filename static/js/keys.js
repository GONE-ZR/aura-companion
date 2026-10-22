/* ============================================================
   keys.js —— 键盘快捷键（App 端 + 电脑网页端共用）

   规格（本轮 §2.2）
     Enter            发送（Shift+Enter 换行）
     Esc              停止生成（保留已输出内容）
     Cmd/Ctrl+K       搜索并切换会话
     Cmd/Ctrl+N       新建话题
     ↑（输入框为空）  编辑上一条（**只编辑，不自动重发**）
     Cmd/Ctrl+F       交给浏览器原生查找（这里什么都不做）

   ★ 输入法组字中（isComposing / keyCode 229）**不得触发任何快捷键**，
     包括 Enter 发送 —— 中文输入法里按 Enter 是选词，不是发送。
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraKeys = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* 组字判定：三个来源都看（不同输入法/浏览器填的不一样） */
  function composing(e) {
    if (!e) return false;
    if (e.isComposing) return true;
    if (e.keyCode === 229) return true;
    var el = e.target;
    if (el && typeof el.composing === "boolean" && el.composing) return true;
    return false;
  }

  function isMac() {
    return /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || "");
  }

  function mod(e) {
    return isMac() ? e.metaKey : e.ctrlKey;
  }

  var composingDepth = 0;     /* compositionstart/end 计数（兜底 229 不触发的情况） */

  function isEditable(el) {
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "input") return true;
    return !!el.isContentEditable;
  }

  function lastMyMessage() {
    try {
      var R = window.AuraRecords;
      var sid = window.Aura.cfg && window.Aura.cfg.sessionId;
      if (!R || !sid) return null;
      var arr = R.messages(sid);
      for (var i = arr.length - 1; i >= 0; i--) {
        if (arr[i].role === "me" && arr[i].content) return arr[i];
      }
    } catch (e) { }
    return null;
  }

  function sendNow() {
    if (window.Aura && window.Aura.chat && window.Aura.chat.send) {
      window.Aura.chat.send();
      return true;
    }
    var b = document.getElementById("btn-send");
    if (b) { b.click(); return true; }
    return false;
  }

  function stopNow() {
    var btn = document.getElementById("btn-stop");
    if (btn && !btn.hidden) { btn.click(); return true; }
    if (window.Aura && window.Aura.chat && window.Aura.chat.stopStreaming) {
      window.Aura.chat.stopStreaming();
      return true;
    }
    return false;
  }

  function openSearch() {
    var d = document.getElementById("drawer");
    if (d && (d.getAttribute("aria-hidden") === "true" || !d.classList.contains("open"))) {
      if (window.Aura.ui && window.Aura.ui.openDrawer) window.Aura.ui.openDrawer();
      else {
        var b = document.getElementById("btn-drawer") || document.getElementById("btn-menu");
        if (b) b.click();
      }
    }
    setTimeout(function () {
      var inp = document.querySelector("#ft-sessions-wrap input.txt, .ft-search input, #drawer input[type=search], #drawer input");
      if (inp) { inp.focus(); inp.select && inp.select(); }
    }, 120);
    return true;
  }

  function newTopic() {
    if (window.Aura.features && window.Aura.features.newSession) {
      window.Aura.features.newSession();
      if (window.AuraWide) window.AuraWide.render();
      return true;
    }
    return false;
  }

  /* ---------------- 主处理 ---------------- */
  function onKeyDown(e) {
    var el = e.target;
    var editable = isEditable(el);
    var guard = composing(e) || composingDepth > 0;

    /* ① Enter：发送 / 换行 —— 组字中一律不拦（交给输入法选词） */
    if (e.key === "Enter" && editable) {
      if (guard) return;                                  /* 输入法选词，别抢 */
      if (e.shiftKey) return;                             /* Shift+Enter = 换行，走默认 */
      if (e.altKey || e.ctrlKey || e.metaKey) return;      /* 组合键交给下面 */
      e.preventDefault();
      sendNow();
      return;
    }

    /* ② Esc：停止生成 */
    if (e.key === "Escape") {
      if (guard) return;
      if (stopNow()) e.preventDefault();
      return;
    }

    if (!mod(e)) return;

    var k = (e.key || "").toLowerCase();

    /* ③ Cmd/Ctrl+K：搜索并切换会话 */
    if (k === "k") {
      if (guard) return;
      e.preventDefault();
      openSearch();
      return;
    }

    /* ④ Cmd/Ctrl+N：新建话题 */
    if (k === "n") {
      if (guard) return;
      e.preventDefault();
      newTopic();
      return;
    }

    /* ⑤ Cmd/Ctrl+F：**不做任何事**，交给浏览器原生查找 */
    if (k === "f") return;
  }

  /* ↑ 编辑上一条：只在输入框为空、且不在组字中时生效 */
  function onKeyUp(e) {
    if (e.key !== "ArrowUp") return;
    if (composing(e) || composingDepth > 0) return;
    var el = e.target;
    if (!el || (el.tagName || "").toLowerCase() !== "textarea") return;
    if (el.value && el.value.trim()) return;              /* 有内容就不动 */
    var m = lastMyMessage();
    if (!m) return;
    el.value = m.content;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { }
    e.preventDefault();
  }

  function init() {
    document.addEventListener("compositionstart", function () { composingDepth += 1; }, true);
    document.addEventListener("compositionend", function () {
      composingDepth = Math.max(0, composingDepth - 1);
    }, true);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);
  }

  function list() {
    var m = isMac() ? "Cmd" : "Ctrl";
    return [
      ["Enter", "发送"],
      ["Shift + Enter", "换行"],
      ["Esc", "停止生成（已输出的内容保留）"],
      [m + " + K", "搜索并切换会话"],
      [m + " + N", "新建话题"],
      ["↑（输入框为空时）", "编辑上一条（只编辑，不会自动重发）"],
      [m + " + F", "浏览器原生查找"],
      ["输入法组字中", "以上快捷键全部不触发"]
    ];
  }

  return {
    init: init,
    list: list,
    composing: composing,
    /* 供测试用 */
    _onKeyDown: onKeyDown,
    _onKeyUp: onKeyUp
  };
});
