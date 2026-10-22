/* ============================================================
   app.js —— 主控：启动 / 抽屉 / 设置接线 / 情感面板 / 更新机制
   ============================================================ */
(function () {
  "use strict";

  var S = window.Aura.store;
  var cfg = window.Aura.cfg;
  var bus = window.Aura.bus;

  var REG = null;
  var updateBar = null;
  var sheetOpen = false;

  /* ---------------- 通用 UI 助手 ---------------- */
  function $(id) { return document.getElementById(id); }

  var toastTimer = null;
  function toast(msg) {
    var t = $("toast");
    if (!t) { console.log("[aura toast]", msg); return; }
    t.textContent = msg;
    t.hidden = false;
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("show");
      t.hidden = true;
    }, 2600);
  }

  var modalResolve = null;
  function openModal(text, opts) {
    opts = opts || {};
    var m = $("modal"), scrim = $("modal-scrim");
    var t = $("modal-text"), extra = $("modal-extra");
    var ok = $("modal-ok"), cancel = $("modal-cancel");
    if (!m) return Promise.resolve(false);
    t.textContent = text || "";
    extra.textContent = "";
    if (opts.extraNode) extra.appendChild(opts.extraNode);
    ok.textContent = opts.okText || "知道了";
    cancel.hidden = !opts.cancelText;
    cancel.textContent = opts.cancelText || "取消";
    m.hidden = false;
    scrim.hidden = false;
    return new Promise(function (res) {
      modalResolve = function (ok2) {
        m.hidden = true;
        scrim.hidden = true;
        modalResolve = null;
        res(ok2);
      };
    });
  }
  function closeModal(v) { if (modalResolve) modalResolve(v); }

  function viewImage(src) {
    var img = document.createElement("img");
    img.src = src;
    img.alt = "图片";
    img.style.cssText = "max-width:100%;max-height:70vh;border-radius:12px;display:block";
    openModal("", { extraNode: img, okText: "关闭" });
  }

  function focusInput() {
    var i = $("input");
    if (i) i.focus();
  }

  window.Aura.ui = {
    toast: toast,
    alert: function (t) { return openModal(t, {}); },
    confirm: function (t, okText) { return openModal(t, { okText: okText || "确定", cancelText: "取消" }); },
    openModal: openModal,
    viewImage: viewImage,
    focusInput: focusInput,
    openDrawer: openDrawer,
    closeDrawer: closeDrawer,
    openSheet: openSheet,
    closeSheet: closeSheet
  };

  /* ---------------- 开关组件 ---------------- */
  function setSwitch(el, on) {
    if (!el) return;
    el.classList.toggle("on", !!on);
    el.setAttribute("aria-checked", on ? "true" : "false");
  }
  function bindSwitch(el, onChange) {
    if (!el) return;
    el.addEventListener("click", function () {
      var on = el.getAttribute("aria-checked") !== "true";
      setSwitch(el, on);
      onChange(on);
    });
  }

  /* ---------------- 抽屉 ---------------- */
  function openDrawer() {
    $("drawer").classList.add("open");
    $("drawer").setAttribute("aria-hidden", "false");
    $("scrim").hidden = false;
    document.body.classList.add("drawer-open");
  }
  function closeDrawer() {
    $("drawer").classList.remove("open");
    $("drawer").setAttribute("aria-hidden", "true");
    $("scrim").hidden = true;
    document.body.classList.remove("drawer-open");
  }

  /* ---------------- 情感面板 ---------------- */
  function openSheet() {
    sheetOpen = true;
    renderSheet();
    $("sheet").classList.add("open");
    $("sheet").setAttribute("aria-hidden", "false");
    $("sheet-scrim").hidden = false;
  }
  function closeSheet() {
    sheetOpen = false;
    $("sheet").classList.remove("open");
    $("sheet").setAttribute("aria-hidden", "true");
    $("sheet-scrim").hidden = true;
  }

  function renderSheet() {
    if (!window.Aura.mood) return;
    $("sheet-stage").textContent = window.Aura.mood.stageWord();
    $("sheet-temp").textContent = window.Aura.mood.tempWord();
    $("sheet-note").textContent = window.Aura.mood.note();

    var pts = window.Aura.mood.chartData();
    var line = $("chart-line"), area = $("chart-area"), dot = $("chart-dot");
    var W = 300, H = 88, pad = 6;
    if (!pts.length) {
      line.setAttribute("d", "");
      area.setAttribute("d", "");
      dot.setAttribute("r", "0");
      return;
    }
    if (pts.length === 1) {
      /* 只有一天数据 → 一条水平短线，不报错、不空图 */
      var y = H / 2;
      line.setAttribute("d", "M " + pad + " " + y + " L " + (W - pad) + " " + y);
      area.setAttribute("d", "");
      dot.setAttribute("cx", String(W - pad));
      dot.setAttribute("cy", String(y));
      dot.setAttribute("r", "2");
      return;
    }
    var min = Math.min.apply(null, pts), max = Math.max.apply(null, pts);
    if (max - min < 1) { min = min - 1; max = max + 1; }
    var stepX = (W - pad * 2) / (pts.length - 1);
    var d = "";
    for (var i = 0; i < pts.length; i++) {
      var x = pad + i * stepX;
      var y = H - pad - ((pts[i] - min) / (max - min)) * (H - pad * 2);
      d += (i === 0 ? "M " : "L ") + x.toFixed(1) + " " + y.toFixed(1);
    }
    line.setAttribute("d", d);
    area.setAttribute("d", d + " L " + (W - pad) + " " + (H - pad) + " L " + pad + " " + (H - pad) + " Z");
    dot.setAttribute("cx", String(W - pad));
    dot.setAttribute("cy", String((H - pad - ((pts[pts.length - 1] - min) / (max - min)) * (H - pad * 2)).toFixed(1)));
    dot.setAttribute("r", "2");
  }

  /* ---------------- 版本 / 更新 ---------------- */
  function setUpdateBar(show, version) {
    if (!updateBar) return;
    updateBar.hidden = !show;
    if (show && version) {
      var t = updateBar.querySelector(".ub-text");
      if (t) t.textContent = "有新版本了";
    }
  }

  var updatePending = false;   /* 已发现新版本，等合适的时机再显示 */

  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol === "file:") return;
    /* APK（Capacitor）里没有 Service Worker，也不该用网页那套更新提示 ——
       不然会出现"有新版本了"点了没反应。APK 的更新走 updater.js。 */
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      return;
    }
    if (location.protocol === "https:" && location.hostname === "localhost") {
      /* Capacitor 的 origin 就是 https://localhost —— 一并挡掉 */
      return;
    }

    var hadController = !!navigator.serviceWorker.controller;

    function watchWorker(nw) {
      if (!nw) return;
      nw.addEventListener("statechange", function () {
        /* ⚠️ SW 用了 skipWaiting()，新 worker 会立刻激活，
           所以 reg.waiting 永远是 null —— 必须靠 statechange 判断。 */
        if (nw.state === "installed" && navigator.serviceWorker.controller) {
          updatePending = true;
          maybeShowUpdate();
        }
      });
    }

    navigator.serviceWorker.register("/service-worker.js").then(function (reg) {
      REG = reg;
      /* 已有等待中的新版本（比如上次没点更新就关了） */
      if (reg.waiting && navigator.serviceWorker.controller) {
        updatePending = true;
        maybeShowUpdate();
      }
      /* ⚠️ 页面加载时浏览器已经自动做过一次更新检查，
         新 worker 可能在我们挂监听器之前就开始装了 —— 必须补挂一次。 */
      watchWorker(reg.installing);
      reg.addEventListener("updatefound", function () {
        watchWorker(reg.installing);
      });
    }).catch(function () { /* 注册失败不打扰用户 */ });

    /* 新 SW 接管页面时也会触发（skipWaiting 的必然结果） */
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadController) { hadController = true; return; }   /* 首次安装，不算更新 */
      updatePending = true;
      maybeShowUpdate();
    });

    /* 每 30 分钟检查一次 + 回到前台检查一次 */
    setInterval(function () { if (REG) REG.update(); }, 30 * 60 * 1000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible" && REG) REG.update();
    });
  }

  /* 正在流式输出时收到更新提示 → 延后显示，等回复结束再出现（规格 23.3 f） */
  function maybeShowUpdate() {
    if (!updatePending) return;
    if (window.Aura.chat && window.Aura.chat.isBusy && window.Aura.chat.isBusy()) {
      return;   /* 回复结束后 chat 会再调一次 */
    }
    var skipped = S.get(S.KEYS.updateSkipped, null);
    if (skipped && skipped.v === updateVersion()) return;
    setUpdateBar(true);
  }

  function updateVersion() {
    if (REG && REG.waiting) return "waiting";
    return "pending";
  }

  function checkUpdate(reg) {
    reg = reg || REG;
    if (!reg) return;
    reg.update().then(function () {
      if (reg.waiting) {
        updatePending = true;
        maybeShowUpdate();
      }
    }).catch(function () { /* ignore */ });
  }

  function doUpdate() {
    /* ① 存草稿 ② 停朗读 ③ 刷新 */
    var i = $("input");
    if (i) S.setStr(S.KEYS.draft, i.value);
    if (window.Aura.voice) window.Aura.voice.stop();
    location.reload();
  }

  /* ---------------- 设置接线 ---------------- */
  function buildPersonaSelect() {
    var sel = $("in-persona");
    if (!sel) return;
    sel.textContent = "";
    var list = cfg.templates || [];
    list.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.id;
      o.textContent = p.name;
      sel.appendChild(o);
    });
    var cur = (cfg.persona && cfg.persona.id) || "default";
    sel.value = cur;
    var ta = $("in-persona-text");
    if (ta) ta.value = (cfg.persona && cfg.persona.text) || "";
  }

  function buildVoiceSelect() {
    var sel = $("in-voice-base");
    if (!sel) return;
    sel.textContent = "";
    window.Aura.VOICES.forEach(function (v) {
      var o = document.createElement("option");
      o.value = v.id;
      o.textContent = v.name;
      sel.appendChild(o);
    });
    sel.value = cfg.voice.base;
  }

  function buildAccentSwatches() {
    var box = $("accent-swatches");
    if (!box) return;
    box.textContent = "";
    ["#8CA6A0", "#90A4B0", "#B0A79E", "#C0A0A0", "#9A9AB0"].forEach(function (hex) {
      var b = document.createElement("button");
      b.className = "swatch";
      b.type = "button";
      b.style.background = hex;
      b.setAttribute("aria-label", hex);
      b.addEventListener("click", function () {
        window.Aura.save.accent(hex);
        var inp = $("in-accent");
        if (inp) inp.value = hex;
      });
      box.appendChild(b);
    });
  }

  function buildThemeSeg() {
    var seg = $("in-theme");
    if (!seg) return;
    Array.prototype.forEach.call(seg.querySelectorAll("button"), function (b) {
      b.classList.toggle("on", b.getAttribute("data-v") === cfg.theme);
      b.addEventListener("click", function () {
        Array.prototype.forEach.call(seg.querySelectorAll("button"), function (x) { x.classList.remove("on"); });
        b.classList.add("on");
        window.Aura.save.theme(b.getAttribute("data-v"));
      });
    });
  }

  function syncDrawer() {
    var n = $("in-ai-name"); if (n) n.value = cfg.aiName;
    var u = $("in-user-name"); if (u) u.value = cfg.userName;
    var pa = $("in-persona-text"); if (pa) pa.value = (cfg.persona && cfg.persona.text) || "";
    var ps = $("in-persona"); if (ps && cfg.persona) ps.value = cfg.persona.id;

    setSwitch($("in-couple"), cfg.coupleOn);
    setSwitch($("in-mood-on"), cfg.moodOn);
    setSwitch($("in-tint"), cfg.emotionTint);

    var fl = $("in-face-level"); if (fl) fl.value = cfg.faceLevel;

    var vb = $("in-voice-base"); if (vb) vb.value = cfg.voice.base;
    var vr = $("in-voice-rate"); if (vr) vr.value = cfg.voice.rate;
    var vrl = $("val-rate"); if (vrl) vrl.textContent = Number(cfg.voice.rate).toFixed(2);
    var vv = $("in-voice-vol"); if (vv) vv.value = cfg.voice.vol;
    var vvl = $("val-vol"); if (vvl) vvl.textContent = Math.round(cfg.voice.vol * 100);
    setSwitch($("in-voice-auto"), cfg.voice.auto);

    var mk = $("in-mask"); if (mk) mk.value = cfg.mask;
    var mv = $("val-mask"); if (mv) mv.textContent = String(cfg.mask);

    var ax = $("in-accent"); if (ax) ax.value = cfg.accentHex;

    var md2 = $("in-mode"); if (md2) md2.value = cfg.mode;
    var ki = $("in-key"); if (ki) ki.value = cfg.apiKey ? "••••••••" : "";
    var th = $("in-think"); if (th) th.value = cfg.thinkDelay || "short";

    if (window.Aura.voice && window.Aura.voice.renderVoiceMap) {
      window.Aura.voice.renderVoiceMap($("voice-map-wrap"));
    }
    var cow = $("btn-couple-off");
    if (cow) cow.hidden = !cfg.coupleOn;
  }

  /* ---------------- 键盘弹起滚到最新 ---------------- */
  function bindViewport() {
    if (!window.visualViewport) return;
    var vv = window.visualViewport;
    function onResize() {
      var h = window.innerHeight;
      document.documentElement.style.setProperty("--vh", h + "px");
      if (window.Aura.chat && !window.Aura.chat.isUserScrolledUp) {
        var log = $("log");
        if (log) { try { log.scrollIntoView({ behavior: "auto", block: "end" }); } catch (e) { } }
      }
    }
    vv.addEventListener("resize", onResize);
    onResize();
  }

  /* ---------------- 密钥 ---------------- */
  function openKeyDialog() {
    var wrap = document.createElement("div");
    var label = document.createElement("p");
    label.textContent = "填 DeepSeek API 密钥（只存在这台设备上，不上传）。";
    label.style.cssText = "font-size:13px;color:var(--text-dim);margin:6px 0 10px";
    var inp = document.createElement("input");
    inp.type = "password";
    inp.className = "txt";
    inp.placeholder = "sk-...";
    inp.value = cfg.apiKey || "";
    inp.style.cssText = "width:100%";
    wrap.appendChild(label);
    wrap.appendChild(inp);
    openModal("API 密钥", { extraNode: wrap, okText: "保存" }).then(function (ok) {
      if (ok) {
        window.Aura.save.apiKey(inp.value.trim());
        toast(inp.value.trim() ? "密钥已保存在本机" : "密钥已清空");
      }
    });
  }

  /* ---------------- 启动 ---------------- */
  function boot() {
    /* 1. 存储契约 + 迁移 */
    window.Aura.loadAll();
    var mig = window.Aura.data.migrate();
    if (!mig.ok) toast("历史数据版本较旧，正在兼容");

    /* 2. 主题 / 配色 / 壁纸 */
    window.Aura.apply.theme();
    window.Aura.apply.accent();
    window.Aura.apply.wallpaper();

    /* 3. 服务端地址（APK 用）→ 改写相对请求 */
    if (cfg.server) {
      var orig = window.fetch;
      window.fetch = function (input, init) {
        if (typeof input === "string" && input.charAt(0) === "/" && cfg.server) {
          input = cfg.server.replace(/\/+$/, "") + input;
        }
        return orig(input, init);
      };
    }

    /* 4. 顶栏名字 */
    var nm = $("ai-name");
    if (nm) nm.textContent = cfg.aiName || "我";

    /* 4'. 人设模板 / 音色 / 色板 / 主题 —— 都要先拿到预设再渲染 */
    loadPersonas();
    buildVoiceSelect();
    buildAccentSwatches();
    buildThemeSeg();

    /* 5. 各模块 */
    if (window.Aura.mood) window.Aura.mood.init();
    if (window.Aura.chat) window.Aura.chat.init();
    if (window.Aura.voice) window.Aura.voice.init();
    if (window.Aura.wallpaper) window.Aura.wallpaper.init();
    if (window.Aura.weather) window.Aura.weather.init();

    /* 6. 抽屉 */
    var ds = $("btn-settings");
    if (ds) ds.addEventListener("click", function () { openDrawer(); syncDrawer(); });
    var dc = $("drawer-close");
    if (dc) dc.addEventListener("click", closeDrawer);
    var scrim = $("scrim");
    if (scrim) scrim.addEventListener("click", closeDrawer);

    /* 7. 重置会话 */
    var br = $("btn-reset");
    if (br) br.addEventListener("click", function () {
      window.Aura.ui.confirm("会清掉这次聊过的内容，但不会忘记你。", "清掉").then(function (ok) {
        if (ok) { window.Aura.chat.reset(); toast("已经清掉了"); }
      });
    });

    /* 8. 壁纸快捷入口 */
    var bw = $("btn-wall");
    if (bw) bw.addEventListener("click", function () {
      if (window.Aura.wallpaper) window.Aura.wallpaper.pick("gallery");
    });

    /* 9. 情感面板 */
    var md = $("mood-dot");
    if (md) md.addEventListener("click", openSheet);
    var sc = $("sheet-scrim");
    if (sc) sc.addEventListener("click", closeSheet);
    var sclose = $("btn-sheet-close");
    if (sclose) sclose.addEventListener("click", closeSheet);
    var coupleOff = $("btn-couple-off");
    if (coupleOff) coupleOff.addEventListener("click", function () {
      window.Aura.save.coupleOn(false);
      setSwitch($("in-couple"), false);
      closeSheet();
      toast("切回默认陪伴了");
    });
    bindSheetDrag();

    /* 10. 设置项 */
    var n = $("in-ai-name");
    if (n) n.addEventListener("change", function () {
      window.Aura.save.aiName(n.value.trim());
      if ($("ai-name")) $("ai-name").textContent = cfg.aiName;
    });
    var u = $("in-user-name");
    if (u) u.addEventListener("change", function () { window.Aura.save.userName(u.value.trim()); });

    var ps = $("in-persona");
    if (ps) ps.addEventListener("change", function () {
      var id = ps.value;
      var list = cfg.templates || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          var ta = $("in-persona-text");
          if (ta) ta.value = list[i].text;
          break;
        }
      }
    });
    var pa = $("btn-persona-apply");
    if (pa) pa.addEventListener("click", function () {
      var ta = $("in-persona-text");
      var id = ps ? ps.value : "default";
      window.Aura.save.persona({ id: id, text: ta ? ta.value : "" });
      toast("换好了");
    });
    var pr = $("btn-persona-reset");
    if (pr) pr.addEventListener("click", function () {
      var id = ps ? ps.value : "default";
      var list = cfg.templates || [];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) {
          var ta = $("in-persona-text");
          if (ta) ta.value = list[i].text;
          toast("恢复成原文了");
          break;
        }
      }
    });

    bindSwitch($("in-couple"), function (on) {
      if (on) {
        window.Aura.save.coupleOn(true);
        var notice = (cfg.templates && cfg.templates.coupleNotice) || "";
        window.Aura.ui.alert("这是陪伴关系的一种形式。它会一直在，但不会替掉现实里的人，\n也不会因为你不在而难过。它不能替代治疗。");
      } else {
        window.Aura.save.coupleOn(false);
      }
    });
    bindSwitch($("in-mood-on"), function (on) { window.Aura.save.moodOn(on); });
    bindSwitch($("in-tint"), function (on) { window.Aura.save.emotionTint(on); });

    var fl = $("in-face-level");
    if (fl) fl.addEventListener("change", function () {
      window.Aura.save.faceLevel(fl.value);
      window.Aura.apply.tint(null);
    });
    var fp = $("btn-face-preview");
    if (fp) fp.addEventListener("click", function () {
      if (window.Aura.mood) window.Aura.mood.previewSequence();
    });

    var vb = $("in-voice-base");
    if (vb) vb.addEventListener("change", function () {
      window.Aura.save.voice({ base: vb.value });
      if (window.Aura.voice && window.Aura.voice.clearCache) window.Aura.voice.clearCache();
    });
    var vr = $("in-voice-rate");
    if (vr) vr.addEventListener("input", function () {
      window.Aura.save.voice({ rate: parseFloat(vr.value), rateTouched: true });
      var l = $("val-rate"); if (l) l.textContent = Number(vr.value).toFixed(2);
    });
    var vv = $("in-voice-vol");
    if (vv) vv.addEventListener("input", function () {
      window.Aura.save.voice({ vol: parseFloat(vv.value) });
      var l = $("val-vol"); if (l) l.textContent = Math.round(parseFloat(vv.value) * 100);
    });
    bindSwitch($("in-voice-auto"), function (on) {
      window.Aura.save.voice({ auto: on });
      var wrap = $("voice-map-wrap");
      if (wrap) wrap.style.display = on ? "" : "none";
      if (window.Aura.voice && window.Aura.voice.clearCache) window.Aura.voice.clearCache();
    });

    var mk = $("in-mask");
    if (mk) mk.addEventListener("input", function () {
      window.Aura.save.mask(parseInt(mk.value, 10));
      var l = $("val-mask"); if (l) l.textContent = mk.value;
    });

    var ax = $("in-accent");
    if (ax) ax.addEventListener("change", function () {
      var v = (ax.value || "").trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) { window.Aura.save.accent(v.toUpperCase()); }
      else { ax.value = cfg.accentHex; }
    });

    /* 11. 连接方式 / 密钥 / 停顿 */
    var md2 = $("in-mode");
    if (md2) {
      md2.value = cfg.mode;
      md2.addEventListener("change", function () {
        window.Aura.save.mode(md2.value);
        toast(md2.value === "direct" ? "改成手机直连了" : "改成走服务器了");
      });
    }
    var keyInput = $("in-key");
    if (keyInput) {
      keyInput.value = cfg.apiKey || "";
      var ks = $("btn-key-save");
      if (ks) ks.addEventListener("click", function () {
        var v = (keyInput.value || "").trim();
        window.Aura.save.apiKey(v);
        keyInput.value = v ? "••••••••" : "";
        toast(v ? "密钥已保存在这台设备上" : "密钥已清除");
      });
      var kc = $("btn-key-clear");
      if (kc) kc.addEventListener("click", function () {
        window.Aura.save.apiKey("");
        keyInput.value = "";
        toast("密钥已清除");
      });
    }
    var th = $("in-think");
    if (th) {
      th.value = cfg.thinkDelay || "short";
      th.addEventListener("change", function () { window.Aura.save.thinkDelay(th.value); });
    }

    /* 手机音色（只有 APK 的原生 TTS 插件存在时才显示） */
    initRemoteCfgField();
    initVoicePicker();

    /* 11b. 更多 */
    var bk = $("btn-key");
    if (bk) bk.addEventListener("click", openKeyDialog);

    var be = $("btn-export");
    if (be) be.addEventListener("click", function () {
      var data = window.Aura.data.exportAll();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "aura-data-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    });
    var bi = $("btn-import");
    var fi = $("file-import");
    if (bi && fi) bi.addEventListener("click", function () { fi.click(); });
    if (fi) fi.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var obj = JSON.parse(rd.result);
          if (window.Aura.data.importAll(obj)) { toast("导入好了，正在重新载入"); setTimeout(function () { location.reload(); }, 600); }
          else toast("这个文件读不了");
        } catch (err) { toast("这个文件读不了"); }
      };
      rd.readAsText(f);
    });

    /* 12. 弹窗按钮 */
    var ok = $("modal-ok");
    if (ok) ok.addEventListener("click", function () { closeModal(true); });
    var cancel = $("modal-cancel");
    if (cancel) cancel.addEventListener("click", function () { closeModal(false); });
    var mscrim = $("modal-scrim");
    if (mscrim) mscrim.addEventListener("click", function () { closeModal(false); });

    /* 13. 版本 */
    fetchVersion();

    /* 14. Service Worker */
    updateBar = $("update-bar");
    registerSW();
    var ub = $("ub-update");
    if (ub) ub.addEventListener("click", doUpdate);
    var us = $("ub-skip");
    if (us) us.addEventListener("click", function () {
      setUpdateBar(false);
      updatePending = false;
      S.set(S.KEYS.updateSkipped, { v: "skip-" + Date.now() });
    });
    var rv = $("btn-review");
    if (rv && !rv.getAttribute("data-bound")) {
      rv.setAttribute("data-bound", "1");
      rv.addEventListener("click", function () {
        if (window.AuraReview) window.AuraReview.open();
      });
    }

    /* 停止生成：忙时显示，闲时隐藏（第二篇 §3.5） */
    var stopBtn = $("btn-stop");
    if (stopBtn) {
      stopBtn.addEventListener("click", function () {
        if (window.Aura.chat && window.Aura.chat.stopStreaming) window.Aura.chat.stopStreaming();
      });
      var syncStop = function () {
        stopBtn.hidden = !(window.Aura.chat && window.Aura.chat.isBusy && window.Aura.chat.isBusy());
      };
      setInterval(syncStop, 400);
    }

    var cu = $("btn-check-update");
    if (cu) cu.addEventListener("click", function () {
      if (!REG) {
        /* APK / 无 Service Worker：改去查安装包有没有新版 */
        if (window.Aura.updater && window.Aura.updater.check) {
          toast("正在检查新版…");
          window.Aura.updater.check().then(function (m) {
            if (m) {
              window.Aura.updater.showBar(m);
              toast("有新版 v" + m.version + "，点上面的按钮下载");
            } else {
              toast("已经是最新版（v" + (window.Aura.updater.CURRENT || "") + "）");
            }
          }).catch(function () { toast("检查失败，稍后再试"); });
        } else {
          toast("这个环境不支持自动更新");
        }
        return;
      }
      REG.update().then(function () {
        if (REG.waiting) { setUpdateBar(true); toast("有新版本了"); }
        else toast("已经是最新了");
      }).catch(function () { toast("检查失败"); });
    });

    /* 15. 视口 */
    bindViewport();

    /* 15.5 功能增强模块（多会话 / 搜索 / 导出 / 快捷短语…） */
    loadFeatures();

    /* 15.6 检查更新（手机不用重扫：直接提示有新版） */
    if (window.Aura.updater && window.Aura.updater.init) {
      try { window.Aura.updater.init(); } catch (e) { /* ignore */ }
    }

    /* 15.7 远程配置（后台管理页保存 → 手机自动应用） */
    if (window.Aura.remote && window.Aura.remote.init) {
      try { window.Aura.remote.init(); } catch (e) { /* ignore */ }
    }

    /* 15.8 密钥相关：没密钥就常驻提示 + 设置里加个"测一下" */
    initKeyTools();

    /* 15.9 任务书：启动时按真实时间结算情绪（§四 防呆 3），并同步五通道 */
    try {
      if (window.Aura.chat && window.Aura.chat.settleEngine && window.AuraEngine) {
        var _st = window.Aura.chat.settleEngine();
        if (_st && window.AuraEmotionUI) {
          window.AuraEmotionUI.applyState(_st.state, 1);
        }
        /* L3：每天记一笔（只给回顾页画曲线用，主界面看不到任何数值） */
        if (_st && window.AuraReview) window.AuraReview.logToday(_st.state);
      }
    } catch (e) { /* ignore */ }

    /* 15.9b L2 状态卡：点头像 / 点名字都出来（三段式，无百分比） */
    try {
      var cardTargets = [document.getElementById("ai-name")];
      var faceBtn = document.querySelector(".ft-face");
      if (faceBtn) cardTargets.push(faceBtn);
      cardTargets.forEach(function (elm) {
        if (!elm || elm.getAttribute("data-status-bound") === "1") return;
        elm.setAttribute("data-status-bound", "1");
        elm.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (window.Aura.chat && window.Aura.chat.statusCard) window.Aura.chat.statusCard();
        });
      });
    } catch (e) { /* ignore */ }


    /* ---------------- 15.10 第二篇：首启 4 屏 / 模式复位 / 减弱动效 ---------------- */
    try {
      /* 关闭 App 再打开 → 自动回到「跟她聊」（§5.4） */
      if (window.AuraModes) window.AuraModes.resetOnLaunch();

      /* 减弱动效（§3.9，一级设置） */
      var reduced = S.getStr("aura_reduce_motion", "");
      if (reduced === "1") document.body.setAttribute("data-motion", "reduced");
      else if (reduced === "") {
        /* 没设置过就跟系统偏好走 */
        try {
          if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
            document.body.setAttribute("data-motion", "reduced");
          }
        } catch (e) { /* ignore */ }
      }

      /* 首次进入 4 屏（18+ / AI 声明必须主动点） */
      if (window.AuraOnboarding && !window.AuraOnboarding.done()) {
        window.AuraOnboarding.start({
          cfg: cfg,
          onDone: function (d) {
            if (d && d.name) { cfg.userName = d.name; S.setStr(S.KEYS.userName, d.name); }
            if (window.AuraOnboarding.bumpSessionCount) window.AuraOnboarding.bumpSessionCount();
            /* 首启不是空白页：让她先说一句（本地生成，不花额度） */
            try { if (window.Aura.chat && window.Aura.chat.openingLine) window.Aura.chat.openingLine(true); } catch (e) { }
          }
        });
      } else {
        if (window.AuraOnboarding && window.AuraOnboarding.bumpSessionCount) {
          var n = window.AuraOnboarding.bumpSessionCount();
          if (n >= 3) window.AuraOnboarding.maybeAskEmergency(cfg);
        }
      }

      /* 连续使用 2 小时提醒一次（§14，温和、不锁功能） */
      var startedAt = Date.now();
      var reminded = false;
      setInterval(function () {
        if (reminded) return;
        if (Date.now() - startedAt < 2 * 3600 * 1000) return;
        reminded = true;
        toast("我有点困了，明天再聊？");
      }, 60 * 1000);
    } catch (e) { /* 不许影响启动 */ }


    /* ---------------- 15.11 第二篇设置项 ---------------- */
    try {
      var rm = $("in-reduce-motion");
      if (rm) {
        rm.checked = S.getStr("aura_reduce_motion", "") === "1";
        rm.addEventListener("change", function () {
          S.setStr("aura_reduce_motion", rm.checked ? "1" : "0");
          if (rm.checked) document.body.setAttribute("data-motion", "reduced");
          else document.body.removeAttribute("data-motion");
          toast(rm.checked ? "已减弱动效" : "动效恢复");
        });
      }
      var qr = $("in-quick-replies");
      if (qr) {
        qr.checked = S.getStr("aura_quick_replies", "") !== "0";
        qr.addEventListener("change", function () {
          S.setStr("aura_quick_replies", qr.checked ? "1" : "0");
          toast(qr.checked ? "她问问题时会给你三个短选项" : "已关掉快捷回应");
        });
      }
      var al = $("about-line");
      if (al) {
        var ver = (window.Aura.updater && window.Aura.updater.CURRENT) || "?";
        var pv = (window.AuraPrompt && window.AuraPrompt.PROMPT_VERSION) || "?";
        al.textContent = "版本 " + ver + " · 提示词 " + pv + " · 情绪引擎 本地规则";
      }
      var bd = $("btn-ai-decl");
      if (bd) bd.addEventListener("click", function () {
        if (window.AuraOnboarding) window.AuraOnboarding.showDeclaration();
      });
      var br2 = $("btn-review2");
      if (br2) br2.addEventListener("click", function () {
        if (window.AuraReview) window.AuraReview.open();
      });
    } catch (e) { /* ignore */ }


    /* ---------------- 15.12 第四篇：细腻程度 + 折叠的高级设置 ---------------- */
    try {
      var tierRadios = document.querySelectorAll('input[name="tier"]');
      var curTier = S.getStr("aura_tier", "") === "delicate" ? "delicate" : "standard";
      tierRadios.forEach(function (r) {
        r.checked = (r.value === curTier);
        r.addEventListener("change", function () {
          var before = S.getStr("aura_tier", "") === "delicate" ? "delicate" : "standard";
          S.setStr("aura_tier", r.value);
          /* 首次切换提示一次，第二次起不再提示（§6.1） */
          if (before !== r.value && S.getStr("aura_tier_hinted", "") !== "1") {
            S.setStr("aura_tier_hinted", "1");
            toast("换个模型，她说话可能会有点不一样");
          } else {
            toast(r.value === "delicate" ? "换成细腻了" : "换成标准了");
          }
        });
      });

      /* 连点版本号 5 次 → 解锁高级块（§9.2） */
      var aboutLine = $("about-line");
      var adv = $("model-adv");
      if (aboutLine && adv) {
        var taps = 0, tapTimer = null;
        aboutLine.style.cursor = "default";
        aboutLine.addEventListener("click", function () {
          taps += 1;
          if (tapTimer) clearTimeout(tapTimer);
          tapTimer = setTimeout(function () { taps = 0; }, 1200);
          if (taps >= 5) {
            adv.hidden = false;
            taps = 0;
            toast("已显示模型与接口（调试信息）");
            /* 第六篇 §6：成本与额度（只给开发者看，用户界面不出现） */
            try {
              if (window.AuraUsage) {
                var us = window.AuraUsage.summary();
                var line = $("model-adv-line");
                if (line) {
                  line.textContent = "当前线路：主线路 · 今日 " + us.requests + " 次 · " +
                    Math.round(us.tokens / 1000) + "k tokens · 缓存命中 " +
                    Math.round(us.hitRate * 100) + "%";
                  var al2 = window.AuraUsage.alarms();
                  if (al2.length) toast(al2[0]);
                }
              }
            } catch (e) { /* ignore */ }
          }
        });
        /* 连续 fallback 3 轮后显示"当前使用备用线路"（§8） */
        if (S.getStr("aura_fallback_note", "") === "1") {
          var line = $("model-adv-line");
          if (line) line.textContent = "当前线路：备用线路";
        }
      }
    } catch (e) { /* ignore */ }


    /* ---------------- 15.13 第七篇：三层配置（先渲染，不等网络） ---------------- */
    try {
      if (window.AuraCfg) {
        var active = window.AuraCfg.loadActive();
        window.__auraCfgActive = active;
        /* 应用外观/文案/开关（三层里拿到什么就用什么，绝不为空） */
        if (window.Aura.remote && window.Aura.remote.applyFromStore) {
          window.Aura.remote.applyFromStore(active.config);
        }
        /* 设置页三项（132） */
        var cfgLine = $("cfg-line");
        if (cfgLine) {
          cfgLine.textContent = "配置 v" + active.config.configVersion +
            " · 来源 " + ({ active: "本地", scan: "本地(扫描)", bundled: "内置" }[active.source] || active.source) +
            " · 资源 " + Object.keys(window.AuraCfg.ASSET_MAP).length + "/" +
            Object.keys(window.AuraCfg.ASSET_MAP).length;
        }
        console.log("[cfg] 版本", active.config.configVersion, "来源", active.source);
      }
    } catch (e) { /* 配置层出错也不许白屏 */ }


    /* 恢复默认 + 长按版本号 5 秒（§8.1，最后一道逃逸） */
    try {
      var rs = $("btn-cfg-reset");
      if (rs) rs.addEventListener("click", function () {
        if (!window.confirm("恢复成包里自带的配置？本机缓存的那几代会删掉。")) return;
        if (window.AuraCfg) {
          var r = window.AuraCfg.resetToBundled();
          toast("已恢复默认（v" + r.config.configVersion + "）");
          setTimeout(function () { location.reload(); }, 600);
        }
      });
      var al = $("about-line");
      if (al && !al.getAttribute("data-reset-bound")) {
        al.setAttribute("data-reset-bound", "1");
        var t0 = 0;
        al.addEventListener("pointerdown", function () { t0 = Date.now(); });
        al.addEventListener("pointerup", function () {
          if (Date.now() - t0 >= 5000 && window.AuraCfg) {
            window.AuraCfg.resetToBundled();
            toast("已恢复默认配置");
            setTimeout(function () { location.reload(); }, 600);
          }
        });
      }
    } catch (e) { /* ignore */ }


    /* ---------------- 15.14 IndexedDB：版本闸门 → 迁移 → 还原（不阻塞渲染） ---------------- */
    try {
      if (window.AuraDB) {
        /* 后台跑，绝不等它；界面已经用 localStorage 渲染出来了 */
        window.AuraDB.open()
          .then(function () { return window.AuraDB.gate(); })
          .then(function (g) {
            window.__auraDbGate = g;
            if (g.readOnly) {
              console.warn("[idb] 只读模式：数据版本高于代码，禁止写入");
              return null;
            }
            /* 先还原（localStorage 被系统清过的话），再迁移 */
            return window.AuraDB.hydrate().then(function (restored) {
              if (restored && Object.keys(restored).length) {
                console.log("[idb] 已从 IndexedDB 还原", restored);
              }
              return window.AuraDB.migrate();
            });
          })
          .then(function (rep) {
            if (!rep) return;
            window.__auraDbReport = rep;
            var line = $("cfg-line");
            if (rep.ok) {
              console.log("[idb] 迁移完成", rep.before, "→", rep.after);
            } else {
              console.warn("[idb] 迁移未通过校验，继续用 localStorage", rep);
            }
          })
          .catch(function (e) { console.warn("[idb] 初始化失败（继续用 localStorage）", e); });
      }
    } catch (e) { /* 存储层出错不许影响启动 */ }


    /* ---------------- 15.15 漫画风 V0（第三篇）：网点四档 + 夜间转深 ---------------- */
    try {
      var comicOn = S.getStr("aura_comic", "") !== "0";     /* 默认开 */
      if (comicOn) {
        document.body.classList.add("comic");
        /* 漫画风与 theme-soft 互斥：同一时间只用一套皮 */
        document.body.setAttribute("data-soft", "0");
      } else {
        document.body.classList.remove("comic");
      }

      /* 状态 → 网点密度（第三篇 §1.2：稀疏 8% / 中 15% / 密 30% / 无） */
      function applyDots(state) {
        if (!comicOn) return;
        var map = { calm: "8", soft: "8", tired: "15", low: "15", sulky: "8", serious: "30", blank: "0" };
        document.body.setAttribute("data-dots", map[state] || "8");
      }
      /* 夜间（23:00~06:00）自动转深，不依赖深色开关 */
      function applyNight() {
        if (!comicOn) return;
        var hh = new Date().getHours();
        document.body.setAttribute("data-night", (hh >= 23 || hh < 6) ? "1" : "0");
      }
      var st0 = (window.Aura.chat && window.Aura.chat.engineState) ? window.Aura.chat.engineState() : null;
      applyDots(st0 && st0.state);
      applyNight();
      setInterval(function () {
        var st = (window.Aura.chat && window.Aura.chat.engineState) ? window.Aura.chat.engineState() : null;
        applyDots(st && st.state);
        applyNight();
      }, 30000);

      /* 设置开关 */
      var cm = $("in-comic");
      if (cm) {
        cm.checked = comicOn;
        cm.addEventListener("change", function () {
          S.setStr("aura_comic", cm.checked ? "1" : "0");
          document.body.classList.toggle("comic", cm.checked);
          if (cm.checked) { applyDots((window.Aura.chat.engineState() || {}).state); applyNight(); }
          toast(cm.checked ? "漫画风已开" : "回到暖纸风");
        });
      }
    } catch (e) { /* ignore */ }

    /* 16. 存储不可用提示（启动时就说，不要等用户试壁纸） */
    if (!S.storageOK) {
      setTimeout(function () {
        toast("这个打开方式不让网页存东西，刷新会复原");
      }, 800);
    }

    /* 17. 首次启动引导（19.9） */
    if (S.getStr("aura_first_run", "") !== "1") {
      S.setStr("aura_first_run", "1");
      setTimeout(function () {
        if (cfg.mode === "direct" && !cfg.apiKey) {
          window.Aura.ui.alert("先填一个 DeepSeek 密钥（只存在这台设备上），再设个名字、设个称呼，其余都能在设置里改。");
        } else {
          window.Aura.ui.alert("设个名字，设个称呼，其余都能在设置里改。");
        }
      }, 600);
    }

    /* 17'. 桌面图标切换（仅 APK 有原生能力） */
    initIconSwitcher();

    /* 18. 事件订阅 */
    bus.on("toast", toast);
    bus.on("chat:idle", function () { maybeShowUpdate(); });
    bus.on("wallpaper:need-trim", function () {
      toast("存储快满了，先把旧对话收进摘要再存");
    });
  }

  /* 手机音色选择（APK 专用：列出手机里所有 TTS 引擎的音色） */
  /* 配置更新地址（远程配置的源） */
  function initRemoteCfgField() {
    var rc = $("in-remote-cfg");
    if (!rc) return;
    rc.value = S.getStr("aura_remote_cfg", "") || "";
    rc.addEventListener("change", function () {
      var v = (rc.value || "").trim();
      S.setStr("aura_remote_cfg", v);
      toast(v ? "配置地址已保存" : "已改回默认地址");
      if (window.Aura.remote && window.Aura.remote.poll) window.Aura.remote.poll();
    });
  }

  function initVoicePicker() {
    var row = $("voice-pick-row");
    var sel = $("in-voice-pick");
    if (!row || !sel) return;
    if (!window.Aura.voice || !window.Aura.voice.listNativeVoices) return;

    window.Aura.voice.listNativeVoices().then(function (voices) {
      if (!voices || !voices.length) return;   /* 网页版没有原生音色，不显示 */
      row.hidden = false;
      sel.textContent = "";
      var cur = (cfg.voice && cfg.voice.nativeVoice) || "";

      if (!cur && window.Aura.voice.autoPickNativeVoice) {
        window.Aura.voice.autoPickNativeVoice();
        cur = (cfg.voice && cfg.voice.nativeVoice) || "";
      }

      voices.forEach(function (v) {
        var o = document.createElement("option");
        var id = v.engine + "::" + v.id;
        o.value = id;
        var lang = /^zh[-_]cn/i.test(v.lang || "") ? "" : "（" + v.lang + "）";
        o.textContent = v.label + lang + (v.needsNetwork ? " · 需联网" : "");
        if (id === cur) o.selected = true;
        sel.appendChild(o);
      });

      sel.addEventListener("change", function () {
        if (window.Aura.voice.setNativeVoice) window.Aura.voice.setNativeVoice(sel.value);
        toast("音色换好了，试听一下");
        if (window.Aura.voice.speak) {
          window.Aura.voice.speak("我在，你慢慢说。", "calm", { manual: true });
        }
      });
    }).catch(function () { /* 没有插件就算了 */ });
  }

  /* 桌面图标切换（Capacitor 原生插件） */
  var ICON_SETS = [
    { alias: "AliasDefault", hex: "#8CA6A0", name: "灰绿" },
    { alias: "AliasWarm", hex: "#B0A79E", name: "暖灰" },
    { alias: "AliasBlue", hex: "#90A4B0", name: "雾蓝" },
    { alias: "AliasRose", hex: "#C0A0A0", name: "藕粉" },
    { alias: "AliasViolet", hex: "#9A9AB0", name: "灰紫" }
  ];

  /* ---------------- 密钥相关的小工具 ---------------- */
  /* ① 没密钥时常驻一条提示（点了直接跳设置那一栏）
     ② 设置里给密钥加一个「测一下」按钮（真的去打一次 /v1/models）*/
  function initKeyTools() {
    var KEY_BAR_ID = "key-bar";

    function needKey() {
      return cfg.mode !== "server" && !cfg.apiKey;
    }

    function syncKeyBar() {
      var bar = document.getElementById(KEY_BAR_ID);
      if (!needKey()) {
        if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
        return;
      }
      if (bar) return;
      bar = document.createElement("div");
      bar.id = KEY_BAR_ID;
      bar.style.cssText = [
        "position:fixed", "left:0", "right:0", "top:0", "z-index:9000",
        "background:#c96442", "color:#fff", "font-size:13px", "line-height:1.4",
        "padding:9px 14px", "text-align:center", "cursor:pointer",
        "font-family:inherit"
      ].join(";");
      bar.textContent = "还没填 DeepSeek 密钥 · 点这里去填";
      bar.addEventListener("click", function () {
        if (window.Aura.ui && window.Aura.ui.openDrawer) window.Aura.ui.openDrawer();
        setTimeout(function () {
          var k = $("in-key");
          if (k) {
            try { k.scrollIntoView({ block: "center", behavior: "smooth" }); } catch (e) { }
            k.focus();
          }
        }, 220);
      });
      document.body.appendChild(bar);
    }

    syncKeyBar();
    setInterval(syncKeyBar, 3000);

    var saveBtn = $("btn-key-save");
    if (saveBtn && !$("btn-key-test")) {
      var t = document.createElement("button");
      t.id = "btn-key-test";
      t.className = "btn";
      t.type = "button";
      t.textContent = "测一下";
      t.style.marginLeft = "8px";
      t.addEventListener("click", function () {
        var key = (cfg.apiKey || "").trim();
        if (!key) { toast("先填密钥再测"); return; }
        toast("正在连 DeepSeek…");
        fetch("https://api.deepseek.com/v1/models", {
          headers: { "Authorization": "Bearer " + key }
        }).then(function (r) {
          if (r.status === 401) throw new Error("密钥不对（401）");
          if (!r.ok) throw new Error("服务返回 " + r.status);
          return r.json();
        }).then(function (d) {
          var ids = (d && d.data ? d.data : []).map(function (m) { return m.id; }).slice(0, 3);
          toast("密钥可用（模型：" + (ids.join(" / ") || "已连通") + "）");
        }).catch(function (e) {
          var msg = String(e && e.message || e);
          if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
            msg = "连不上 api.deepseek.com（手机网络/代理问题）";
          }
          toast("自检失败：" + msg);
        });
      });
      saveBtn.parentNode.insertBefore(t, saveBtn.nextSibling);
    }
  }

  function initIconSwitcher() {
    var row = $("icon-row");
    var box = $("icon-swatches");
    var plugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.IconSwitcher;
    if (!row || !box || !plugin) return;
    row.hidden = false;
    box.textContent = "";
    ICON_SETS.forEach(function (s) {
      var b = document.createElement("button");
      b.className = "swatch";
      b.type = "button";
      b.style.background = s.hex;
      b.title = s.name;
      b.setAttribute("aria-label", s.name);
      if (cfg.iconName === s.alias) b.classList.add("on");
      b.addEventListener("click", function () {
        plugin.switchIcon({ name: s.alias }).then(function () {
          window.Aura.save.iconName(s.alias);
          Array.prototype.forEach.call(box.querySelectorAll(".swatch"), function (x) { x.classList.remove("on"); });
          b.classList.add("on");
          toast("桌面图标已更换。部分手机需要回到桌面等一两秒");
        }).catch(function () {
          toast("这个系统不支持换图标");
        });
      });
      box.appendChild(b);
    });
  }

  /* 从后端取人设模板（单一数据源，前端不抄一份） */
  function loadPersonas() {
    fetch("/api/personas").then(function (r) { return r.json(); }).then(function (d) {
      if (!d || !d.presets || !d.presets.length) return;
      window.Aura.save.templates(d.presets);
      if (!cfg.persona || !cfg.persona.text) {
        for (var i = 0; i < d.presets.length; i++) {
          if (d.presets[i].id === "default") {
            window.Aura.save.persona({ id: "default", text: d.presets[i].text });
            break;
          }
        }
      }
      buildPersonaSelect();
      var ta = $("in-persona-text");
      if (ta && cfg.persona) ta.value = cfg.persona.text;
    }).catch(function () {
      /* 取不到模板不影响聊天，只是下拉为空 */
      buildPersonaSelect();
    });
  }

  /* 功能增强模块：动态载入，避免阻塞首屏 */
  function loadFeatures() {
    if (document.getElementById("aura-features-script")) return;
    var s = document.createElement("script");
    s.id = "aura-features-script";
    s.src = "/static/js/features.js";
    s.onload = function () {
      if (window.Aura.features && window.Aura.features.init) window.Aura.features.init();
    };
    s.onerror = function () { console.warn("[aura] features.js 加载失败"); };
    document.head.appendChild(s);
  }

  function fetchVersion() {
    fetch("/api/version").then(function (r) { return r.json(); }).then(function (d) {
      var line = $("version-line");
      if (line) line.textContent = "版本 " + (d.version || "") + " · " + (d.date || "");
      /* 服务端没配密钥 → 问一次（只在服务器模式下才需要） */
      if (d && !d.has_key && cfg.mode === "server" && !cfg.apiKey
          && S.getStr(S.KEYS.keyNotice, "") !== "1") {
        S.setStr(S.KEYS.keyNotice, "1");
        setTimeout(function () { toast("还没设置 API 密钥，点设置里的「设置 API 密钥」"); }, 1500);
      }
    }).catch(function () { });
  }

  /* 情感面板下滑关闭 */
  function bindSheetDrag() {
    var sheet = $("sheet");
    if (!sheet) return;
    var startY = 0, dragging = false;
    sheet.addEventListener("touchstart", function (e) {
      startY = e.touches[0].clientY;
      dragging = true;
    }, { passive: true });
    sheet.addEventListener("touchmove", function (e) {
      if (!dragging) return;
      var dy = e.touches[0].clientY - startY;
      if (dy > 0) sheet.style.transform = "translateY(" + dy + "px)";
    }, { passive: true });
    sheet.addEventListener("touchend", function (e) {
      if (!dragging) return;
      dragging = false;
      var dy = (e.changedTouches[0].clientY - startY);
      sheet.style.transform = "";
      if (dy > 60) closeSheet();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
