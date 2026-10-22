/* ============================================================
   modes.js —— 「跟她聊 / 让她办」（第二篇 §5）

   硬规则：
   · 界面禁用「模式」二字；只有两个词：跟她聊 / 让她办
   · 入口是右上角小图标 + 两行小菜单，不常驻分段控件
   · 切换**不重置**情绪、不忍忆、不让立绘回 calm（切模式不切人）
   · 关闭 App 再开 → 自动回到「跟她聊」
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraModes = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_work_mode";        /* 'chat' | 'work' */

  function current() {
    /* 每次启动都读一次；启动时由 boot() 强制重置为 chat（见 resetOnLaunch） */
    try { return localStorage.getItem(KEY) === "work" ? "work" : "chat"; } catch (e) { return "chat"; }
  }

  function label(mode) {
    return mode === "work" ? "让她办" : "跟她聊";
  }

  function apply(mode) {
    var body = document.body;
    if (!body) return;
    body.setAttribute("data-work", mode);
    /* 输入框占位随场景变（不出现"模式"二字） */
    var input = document.getElementById("input");
    if (input) {
      input.setAttribute("placeholder", mode === "work" ? "要我办什么？" : "说点什么…");
    }
    /* 办事时立绘收到 30% / 淡出 */
    if (mode === "work") body.setAttribute("data-pose", "work");
    else if (body.getAttribute("data-pose") === "work") body.setAttribute("data-pose", "front");
  }

  function set(mode) {
    mode = mode === "work" ? "work" : "chat";
    try { localStorage.setItem(KEY, mode); } catch (e) { /* ignore */ }
    apply(mode);
    /* 切模式**不碰**引擎状态与记忆（第二篇 §5.4 硬约束） */
    return mode;
  }

  function resetOnLaunch() {
    try { localStorage.setItem(KEY, "chat"); } catch (e) { /* ignore */ }
    apply("chat");
    return "chat";
  }

  /* 右上角小菜单（两行，不占满屏） */
  function openMenu(anchor) {
    var old = document.getElementById("mode-menu");
    if (old && old.parentNode) old.parentNode.removeChild(old);

    var menu = document.createElement("div");
    menu.id = "mode-menu";
    menu.style.cssText = [
      "position:fixed", "z-index:9400", "background:var(--paper,#f1efea)",
      "border:1px solid rgba(0,0,0,.14)", "border-radius:10px", "padding:6px",
      "box-shadow:0 12px 30px -18px rgba(0,0,0,.4)", "font-size:14px", "min-width:132px"
    ].join(";");

    var cur = current();
    [["chat", "跟她聊"], ["work", "让她办"]].forEach(function (pair) {
      var b = document.createElement("button");
      b.textContent = (cur === pair[0] ? "✓ " : "　") + pair[1];
      b.style.cssText = "display:block;width:100%;text-align:left;padding:9px 10px;border:0;" +
        "background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:6px";
      b.onmouseenter = function () { b.style.background = "rgba(0,0,0,.05)"; };
      b.onmouseleave = function () { b.style.background = "transparent"; };
      b.onclick = function () {
        set(pair[0]);
        if (menu.parentNode) menu.parentNode.removeChild(menu);
        if (window.Aura.ui && window.Aura.ui.toast) {
          window.Aura.ui.toast(pair[0] === "work" ? "好，你说，我去办" : "回来陪你");
        }
      };
      menu.appendChild(b);
    });

    document.body.appendChild(menu);
    var r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : null;
    if (r) {
      menu.style.top = Math.round(r.bottom + 8) + "px";
      menu.style.right = Math.max(10, Math.round(window.innerWidth - r.right)) + "px";
    } else {
      menu.style.top = "56px";
      menu.style.right = "14px";
    }

    setTimeout(function () {
      var close = function (ev) {
        if (!menu.parentNode) return;
        if (menu.contains(ev.target)) return;
        menu.parentNode.removeChild(menu);
        document.removeEventListener("pointerdown", close, true);
      };
      document.addEventListener("pointerdown", close, true);
    }, 30);
  }

  return {
    KEY: KEY,
    current: current,
    label: label,
    set: set,
    apply: apply,
    resetOnLaunch: resetOnLaunch,
    openMenu: openMenu
  };
});
