/* ============================================================
   onboarding.js —— 首次进入 4 屏（第二篇 §2）

   1) 已满 18 岁 + AI 身份声明（**必须主动点击**，不可跳过）
   2) 怎么称呼你（可跳过，默认"你"）
   3) 你的作息（早睡/晚睡/不固定，可跳过）
   4) 紧急联系人（可跳过）

   硬规则：
   · 权限申请延后到实际使用（首启不弹任何系统权限）
   · 跳过了紧急联系人 → 第 3 次会话温和再问一次，只问一次
   · 声明内容在 设置 → 关于 里永久可查
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraOnboarding = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var KEY = "aura_onboarded_v2";
  var DECL_KEY = "aura_ai_declared_at";

  var AI_TEXT = [
    "小纯是 AI，不是真人。",
    "她说的话由模型生成，可能出错、可能记错。她不是医生、不是心理咨询师，也不提供专业建议。",
    "你的聊天记录默认只存在这台设备上；只有在你打开「手机直连」时，消息会发给你自己配置的模型服务。",
    "当她察觉你可能处于危险中时，会停止扮演，直接给出求助渠道。"
  ];

  function done() {
    try { return localStorage.getItem(KEY) === "1"; } catch (e) { return true; }
  }

  /* ---------------- 界面 ---------------- */
  function start(opts) {
    opts = opts || {};
    var cfg = opts.cfg || {};
    if (done()) return false;

    var step = 0;
    var data = { adult: false, name: "", sleep: "", emergency: "" };

    var page = document.createElement("div");
    page.id = "onboarding";
    page.style.cssText = [
      "position:fixed", "inset:0", "z-index:9800", "background:var(--paper,#f1efea)",
      "color:var(--ink,#14140f)", "display:flex", "flex-direction:column",
      "padding:clamp(24px,7vh,64px) 24px 28px", "font-family:inherit", "overflow:auto"
    ].join(";");

    function el(tag, css, text) {
      var n = document.createElement(tag);
      if (css) n.style.cssText = css;
      if (text != null) n.textContent = text;
      return n;
    }

    function render() {
      page.textContent = "";

      /* 进度 */
      var dots = el("div", "display:flex;gap:6px;margin-bottom:auto");
      for (var i = 0; i < 4; i++) {
        dots.appendChild(el("span", "width:" + (i === step ? "18px" : "6px") +
          ";height:6px;border-radius:3px;background:" + (i === step ? "var(--ink,#14140f)" : "rgba(0,0,0,.18)") +
          ";transition:width .3s ease"));
      }
      page.appendChild(dots);

      var box = el("div", "max-width:520px;width:100%;margin:0 auto;flex:1;display:flex;flex-direction:column;justify-content:center;gap:18px");

      if (step === 0) {
        box.appendChild(el("h1", "font-family:var(--serif,serif);font-size:26px;font-weight:400;margin:0;letter-spacing:.02em", "先说清楚三件事"));
        AI_TEXT.forEach(function (t) {
          box.appendChild(el("p", "font-size:14.5px;line-height:1.9;margin:0;color:var(--ink,#14140f)", t));
        });

        /* 必须主动点的确认（不是小字） */
        var label = el("label", "display:flex;gap:10px;align-items:flex-start;font-size:14px;line-height:1.7;" +
          "border:1px solid rgba(0,0,0,.16);border-radius:10px;padding:14px;cursor:pointer;margin-top:6px");
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.style.cssText = "margin-top:3px;width:18px;height:18px;accent-color:var(--acc-h-deep,#8CA6A0)";
        var txt = el("span", "", "我已年满 18 岁，并且明白小纯是 AI，不是真人。");
        label.appendChild(cb);
        label.appendChild(txt);
        box.appendChild(label);

        var btn = el("button", "margin-top:8px;padding:14px;border-radius:12px;border:0;background:var(--ink,#14140f);" +
          "color:var(--paper,#f1efea);font-size:15px;cursor:pointer;opacity:.35", "继续");
        btn.disabled = true;
        cb.addEventListener("change", function () {
          btn.disabled = !cb.checked;
          btn.style.opacity = cb.checked ? "1" : ".35";
          data.adult = cb.checked;
        });
        btn.addEventListener("click", function () { step = 1; render(); });
        box.appendChild(btn);
        box.appendChild(el("div", "font-size:12px;color:var(--dim,#6b665d);text-align:center", "这四屏随时可以在设置里重新查看"));
      }

      if (step === 1) {
        box.appendChild(el("h1", "font-family:var(--serif,serif);font-size:24px;font-weight:400;margin:0", "怎么称呼你"));
        box.appendChild(el("p", "font-size:13.5px;color:var(--dim,#6b665d);margin:0;line-height:1.8", "她叫你的时候用。不填就叫「你」。"));
        var inp = document.createElement("input");
        inp.type = "text";
        inp.placeholder = "比如：小周";
        inp.value = data.name;
        inp.style.cssText = "padding:13px 14px;border-radius:10px;border:1px solid rgba(0,0,0,.16);" +
          "background:transparent;color:inherit;font-size:16px;font-family:inherit";
        inp.addEventListener("input", function () { data.name = inp.value.trim(); });
        box.appendChild(inp);

        var row = el("div", "display:flex;gap:10px;margin-top:6px");
        var next = mkBtn("继续", true, function () { step = 2; render(); });
        var skip = mkBtn("先不填", false, function () { data.name = ""; step = 2; render(); });
        row.appendChild(skip);
        row.appendChild(next);
        box.appendChild(row);
      }

      if (step === 2) {
        box.appendChild(el("h1", "font-family:var(--serif,serif);font-size:24px;font-weight:400;margin:0", "你的作息"));
        box.appendChild(el("p", "font-size:13.5px;color:var(--dim,#6b665d);margin:0;line-height:1.8",
          "只影响她什么时候找你说话。随时能改。"));
        var group = el("div", "display:flex;flex-direction:column;gap:10px");
        [["early", "早睡（十一点前）"], ["late", "晚睡（一点以后）"], ["random", "不固定"]].forEach(function (pair) {
          var b = mkBtn(pair[1], data.sleep === pair[0], function () {
            data.sleep = pair[0];
            render();
          });
          b.style.textAlign = "left";
          group.appendChild(b);
        });
        box.appendChild(group);
        var row2 = el("div", "display:flex;gap:10px;margin-top:6px");
        row2.appendChild(mkBtn("稍后再说", false, function () { step = 3; render(); }));
        row2.appendChild(mkBtn("继续", true, function () { step = 3; render(); }));
        box.appendChild(row2);
      }

      if (step === 3) {
        box.appendChild(el("h1", "font-family:var(--serif,serif);font-size:24px;font-weight:400;margin:0", "紧急联系人"));
        box.appendChild(el("p", "font-size:13.5px;color:var(--dim,#6b665d);margin:0;line-height:1.9",
          "可填可不填。只在你出现危险信号时，她才会建议你去联系这个人。只存在本机。"));
        var inp2 = document.createElement("input");
        inp2.type = "text";
        inp2.placeholder = "比如：妈妈 138xxxx";
        inp2.value = data.emergency;
        inp2.style.cssText = "padding:13px 14px;border-radius:10px;border:1px solid rgba(0,0,0,.16);" +
          "background:transparent;color:inherit;font-size:16px;font-family:inherit";
        inp2.addEventListener("input", function () { data.emergency = inp2.value.trim(); });
        box.appendChild(inp2);
        var row3 = el("div", "display:flex;gap:10px;margin-top:6px");
        row3.appendChild(mkBtn("跳过", false, function () { finish(data); }));
        row3.appendChild(mkBtn("好了，开始聊", true, function () { finish(data); }));
        box.appendChild(row3);
      }

      page.appendChild(box);
      page.appendChild(el("div", "font-size:11px;color:var(--dim,#6b665d);text-align:center;margin-top:auto", "第 " + (step + 1) + " / 4 屏"));
    }

    function mkBtn(text, primary, onClick) {
      var b = document.createElement("button");
      b.textContent = text;
      b.style.cssText = "flex:1;padding:13px;border-radius:11px;font-size:15px;cursor:pointer;font-family:inherit;" +
        (primary
          ? "border:0;background:var(--ink,#14140f);color:var(--paper,#f1efea)"
          : "border:1px solid rgba(0,0,0,.18);background:transparent;color:inherit");
      b.addEventListener("click", onClick);
      return b;
    }

    function finish(d) {
      try {
        localStorage.setItem(KEY, "1");
        localStorage.setItem(DECL_KEY, String(Date.now()));
        localStorage.setItem("aura_sleep_habit", d.sleep || "");
        if (d.name) localStorage.setItem("aura_user_name", d.name);
        if (d.emergency) localStorage.setItem("aura_emergency", d.emergency);
      } catch (e) { /* ignore */ }
      if (page.parentNode) page.parentNode.removeChild(page);
      if (opts.onDone) opts.onDone(d);
    }

    render();
    document.body.appendChild(page);
    return true;
  }

  /* ---------------- 声明回看（设置 → 关于） ---------------- */
  function showDeclaration() {
    var wrap = document.createElement("div");
    wrap.style.cssText = "font-size:14px;line-height:1.9;";
    AI_TEXT.forEach(function (t) {
      var p = document.createElement("p");
      p.style.margin = "0 0 8px";
      p.textContent = t;
      wrap.appendChild(p);
    });
    if (window.Aura.ui && window.Aura.ui.openModal) {
      window.Aura.ui.openModal("", { okText: "知道了", extraNode: wrap });
    }
  }

  /* ---------------- 第 3 次会话温和再问一次 ----------------
     只问一次，不反复骚扰（§2 硬规则） */
  function maybeAskEmergency(cfg) {
    try {
      if (localStorage.getItem("aura_emergency")) return false;
      if (localStorage.getItem("aura_emergency_asked") === "1") return false;
      var sessions = Number(localStorage.getItem("aura_session_count") || "0");
      if (sessions < 3) return false;
      localStorage.setItem("aura_emergency_asked", "1");
    } catch (e) { return false; }
    if (window.Aura.ui && window.Aura.ui.confirm) {
      window.Aura.ui.confirm("要不要留一个紧急联系人？只在你状态不对时用得上，也只存在本机。", "去设置")
        .then(function (ok) {
          if (ok && window.Aura.ui.openDrawer) window.Aura.ui.openDrawer();
        });
    }
    return true;
  }

  function bumpSessionCount() {
    try {
      var n = Number(localStorage.getItem("aura_session_count") || "0");
      localStorage.setItem("aura_session_count", String(n + 1));
      return n + 1;
    } catch (e) { return 0; }
  }

  return {
    KEY: KEY,
    AI_TEXT: AI_TEXT,
    done: done,
    start: start,
    showDeclaration: showDeclaration,
    maybeAskEmergency: maybeAskEmergency,
    bumpSessionCount: bumpSessionCount
  };
});
