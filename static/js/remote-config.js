/* ============================================================
   remote-config.js —— 远程配置热应用
   手机 App 定期拉取后台保存的配置（放在 GitHub raw，永久地址、电脑关机也能用）：
     · 外观：主题色 / 明暗 / 圆角 / 字号 / 衬线 / 柔光 / 纸墨色
     · 功能：逐个开关（显示/隐藏某块功能）
     · 文案：空状态、占位符、提示语
     · 快捷短语：远程增删
     · 图标：安卓桌面图标（5 套预置）、应用内图标
     · 指令：远程下发危险操作（重置会话 / 清空数据 / 立刻刷新）
   ============================================================ */
(function () {
  "use strict";
  var A = window.Aura;
  if (!A) return;

  var DEFAULT_URL = "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/remote/config.json";
  var state = { config: null, version: -1, lastError: null, appliedAt: 0 };

  /* 配置源优先级：
       ① 用户在设置里填的绝对地址（APK 场景：填隧道 / 服务器地址）
       ② 同源 /remote/config.json（网页 / PWA 由自己的服务提供时，秒级生效）
       ③ GitHub raw（电脑关机也能用的那条）
  */
  function urls() {
    var out = [];
    var custom = A.store.getStr("aura_remote_cfg", "");
    if (custom) out.push(custom);
    if (String(location.protocol).indexOf("http") === 0) out.push("/remote/config.json");
    out.push(DEFAULT_URL);
    return out;
  }

  function url() {
    return urls()[0];
  }

  /* ---------------- 拉取 ---------------- */
  function fetchOne(u) {
    return fetch(u, { cache: "no-store" })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      });
  }

  /* 依次尝试多个源，取第一个有更新的 */
  function fetchConfig() {
    var list = urls();
    var i = 0;
    function next() {
      if (i >= list.length) return Promise.resolve(null);
      var u = list[i++];
      return fetchOne(u).then(function (cfg) {
        if (!cfg || cfg.version === undefined) return next();
        if (state.config && Number(cfg.version) <= Number(state.version)) return next();
        state.source = u;
        return cfg;
      }).catch(function () { return next(); });
    }
    return next().catch(function (e) { state.lastError = String(e && e.message || e); return null; });
  }

  /* ---------------- 应用 ---------------- */
  function applyTheme(t) {
    if (!t) return;
    var r = document.documentElement.style;
    if (t.accent) {
      /* 走 save.accent：既写本地（下次启动还在），也让情绪配色用新主题色，
         不会被 apply.tint() 又覆盖回旧颜色 */
      if (A.save && A.save.accent) A.save.accent(t.accent);
      var hsl = A.util.hexToHsl(t.accent);
      r.setProperty("--acc-h", hsl.h);
      r.setProperty("--acc-s", hsl.s);
      r.setProperty("--acc-l", hsl.l);
    }
    if (t.mode) {
      var mode = t.mode;
      if (mode === "auto") {
        mode = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
      }
      document.body.setAttribute("data-theme", mode);
    }
    if (typeof t.radius === "number") r.setProperty("--r-bubble", t.radius + "px");
    if (typeof t.fontScale === "number") r.setProperty("--font-scale", t.fontScale);
    if (t.serif === false) document.body.classList.add("no-serif");
    else document.body.classList.remove("no-serif");
    if (typeof t.glow === "number") {
      r.setProperty("--glow-a", t.glow);
      r.setProperty("--glow-b", t.glow);
    }
    if (t.paper) r.setProperty("--paper", t.paper);
    if (t.ink) r.setProperty("--ink", t.ink);
    if (typeof t.wallpaperDim === "number") {
      r.setProperty("--wp-dim", t.wallpaperDim);
    }
    /* 主题变了要重算一次壁纸层（明暗不同蒙版不同） */
    if (A.apply && A.apply.wallpaper) A.apply.wallpaper();
  }

  function applyFeatures(f) {
    if (!f) return;
    var nodes = document.querySelectorAll("[data-feature]");
    for (var i = 0; i < nodes.length; i++) {
      var key = nodes[i].getAttribute("data-feature");
      var on = f[key];
      var show = on === undefined ? true : !!on;
      nodes[i].hidden = !show;
      nodes[i].setAttribute("data-feature-off", show ? "0" : "1");
    }
    /* 情绪配色开关 */
    if (f.emotionTint === false) {
      A.apply.tint(null);
    }
  }

  function applyText(t) {
    if (!t) return;
    if (t.empty) {
      A.store.setStr("aura_text_empty", t.empty);
      var empty = document.querySelector(".empty-text");
      if (empty) empty.textContent = t.empty;
    }
    if (t.placeholder) {
      A.store.setStr("aura_text_placeholder", t.placeholder);
      var input = document.getElementById("input");
      if (input) input.placeholder = t.placeholder;
    }
  }

  function applyShortcuts(list) {
    if (!Array.isArray(list)) return;
    A.store.set("aura_shortcuts", list);
    if (A.features && A.features.renderShortcuts) A.features.renderShortcuts();
  }

  function applyIcon(ic) {
    if (!ic) return;
    /* 安卓桌面图标：5 套预置 alias，远程指定默认用哪套 */
    if (ic.default && window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.IconSwitcher) {
      var cur = A.store.getStr("aura_icon_name", "");
      if (cur !== ic.default) {
        try {
          window.Capacitor.Plugins.IconSwitcher.switchIcon({ name: ic.default })
            .then(function () { A.save.iconName(ic.default); });
        } catch (e) { /* ignore */ }
      }
    }
    /* 应用内自定义图标（背景图 / 品牌标记） */
    if (ic.appIconUrl) {
      var root = document.getElementById("app-icon");
      if (root) {
        root.style.backgroundImage = 'url("' + ic.appIconUrl + '")';
        root.hidden = false;
      }
    }
  }

  /* ---------------- 远程指令 ---------------- */
  function runCommands(cmds) {
    if (!Array.isArray(cmds) || !cmds.length) return;
    var seen = A.store.get("aura_cmds_seen", null) || [];
    for (var i = 0; i < cmds.length; i++) {
      var c = cmds[i];
      if (!c || !c.id) continue;
      if (seen.indexOf(c.id) !== -1) continue;
      seen.push(c.id);
      try { execCommand(c); } catch (e) { console.warn("[remote] 命令失败", c, e); }
    }
    A.store.set("aura_cmds_seen", seen.slice(-40));
  }

  function execCommand(c) {
    var type = c.type || "";
    if (type === "reset_session") {
      if (A.messages && A.messages.clear) {
        A.messages.clear();
        if (A.chat && A.chat.reload) A.chat.reload();
      }
      toast("远程指令：已重置会话");
    } else if (type === "clear_all") {
      try {
        var keys = [];
        for (var i = 0; i < localStorage.length; i++) {
          var k = localStorage.key(i);
          if (k && k.indexOf("aura_") === 0) keys.push(k);
        }
        keys.forEach(function (k) { localStorage.removeItem(k); });
      } catch (e) { /* ignore */ }
      toast("远程指令：已清空本机数据");
      setTimeout(function () { location.reload(); }, 900);
    } else if (type === "reload") {
      location.reload();
    } else if (type === "toast") {
      toast(c.text || "来自后台的提醒");
    }
  }

  /* ---------------- 轮询 ---------------- */
  function poll() {
    return fetchConfig().then(function (cfg) {
      if (!cfg) return null;
      if (state.config && cfg.version === state.version) return cfg;   /* 没变就不动 */
      state.config = cfg;
      state.version = cfg.version;
      state.appliedAt = Date.now();
      A.store.set("aura_remote_cfg_cache", cfg);
      applyTheme(cfg.theme);
      applyFeatures(cfg.features);
      applyText(cfg.text);
      applyShortcuts(cfg.shortcuts);
      applyIcon(cfg.icon);
      runCommands(cfg.commands);
      bus && bus.emit("remote:applied", cfg);
      return cfg;
    });
  }

  /* 上次拿到的文案先垫上（免得等第一次轮询） */
  function applyCached() {
    try {
      var p = A.store.getStr("aura_text_placeholder", "");
      if (p) {
        var i = document.getElementById("input");
        if (i) i.placeholder = p;
      }
      var e = A.store.getStr("aura_text_empty", "");
      if (e) {
        var n = document.querySelector(".empty-text");
        if (n) n.textContent = e;
      }
    } catch (err) { /* ignore */ }
  }

  var bus = A.bus;

  /* 后台管理页的实时预览：通过 postMessage 把配置推过来 */
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (d && d.type === "aura:preview" && d.config) {
      A.remote.apply(d.config);
    }
  });

  function init() {
    applyCached();
    poll();
    setInterval(poll, 30 * 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") poll();
    });
  }

  A.remote = {
    init: init,
    poll: poll,
    fetchConfig: fetchConfig,
    state: state,
    url: url,
    urls: urls,
    source: function () { return state.source || ""; },
    urls: urls,
    source: function () { return state.source || ""; },
    apply: function (cfg) {
      state.config = cfg;
      state.version = cfg.version;
      applyTheme(cfg.theme);
      applyFeatures(cfg.features);
      applyText(cfg.text);
      applyShortcuts(cfg.shortcuts);
      applyIcon(cfg.icon);
    }
  };
})();
