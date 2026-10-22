/* ============================================================
   wallpaper.js —— 壁纸（规格书 第 16 章）
   · 先预览再使用（16.2）
   · 压缩流程与五档降级阶梯（16.3）
   · 存储预算（16.4）
   · 失败必须分原因（16.5）
   · 图层顺序由 CSS 负责，这里只写 aura_wallpaper / aura_mask（16.6）
   · 重置只碰壁纸与蒙版，不动人设/称呼/主题/情绪/音色（16.7）

   对外：
   window.Aura.wallpaper = { init, pick, preview, clear, compress }
   ============================================================ */
(function () {
  "use strict";

  var A = window.Aura = window.Aura || {};

  /* ---------------- 常量（规格 16.3 / 16.4 / 16.5） ---------------- */
  /* 五档降级阶梯：存不下就自动再压一档 */
  var LADDER = [[1600, 0.82], [1280, 0.75], [1080, 0.70], [900, 0.62], [720, 0.55]];
  var MAX_FILE = 40 * 1024 * 1024;    /* 超过 40MB 直接拦下，避免手机卡死 */
  var MAX_RAW = 400 * 1024;           /* 壁纸本体上限 400KB（base64 约 550KB） */
  var TOTAL_BUDGET = 4 * 1024 * 1024; /* 壁纸 + 历史 > 4MB 就先提示前端 */
  var DEFAULT_MASK = 70;              /* 蒙版复位到 70% */

  /* 失败文案按真实原因分，不许一律说"图片太大" */
  var MSG = {
    noStore: "这个打开方式不让网页存东西，刷新会复原。",
    decode: "这张照片格式读不了，在相册里先存成 JPG 再试。",
    tooBig: "这张照片太大了（超过 40MB），换一张小点的。",
    trim: "空间不太够了，先清一点历史再设壁纸。",
    busy: "这张照片没弄好，换一张再试。"
  };

  var els = {};
  var inited = false;
  var lastSource = "gallery";
  var toastTimer = null;
  var overlay = null;

  /* ---------------- toast：优先用 app.js 的 Aura.toast ---------------- */
  function toast(msg) {
    if (A && typeof A.toast === "function") {
      try { A.toast(msg); return; } catch (e) { /* 落回自带实现 */ }
    }
    var el = document.getElementById("toast");
    var before = el ? el.textContent : "";
    if (A && A.bus && typeof A.bus.emit === "function") {
      try { A.bus.emit("toast", msg); } catch (e) { /* ignore */ }
    }
    if (!el) return;
    /* 没人接管（例如 app.js 还没加载完）就自己显示，避免提示丢失 */
    setTimeout(function () {
      if (el.textContent !== before) return;   /* 已经有别人处理了 */
      el.textContent = msg;
      el.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
    }, 0);
  }

  /* ---------------- 小工具 ---------------- */
  function on(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
  }

  /* base64 长度 → 原始字节数 */
  function rawBytes(dataUrl) {
    if (!dataUrl) return 0;
    var i = dataUrl.indexOf(",");
    var b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
    return Math.floor(b64.length * 3 / 4);
  }

  function kb(bytes) {
    return Math.max(1, Math.round(bytes / 1024));
  }

  function clampMask(v) {
    v = parseInt(v, 10);
    if (!isFinite(v)) return DEFAULT_MASK;
    return Math.min(90, Math.max(0, v));
  }

  /* ---------------- 解码：createImageBitmap → Image + objectURL ---------------- */
  function decodeViaImg(file) {
    return new Promise(function (resolve, reject) {
      var url = "";
      try { url = URL.createObjectURL(file); }
      catch (e) { reject(new Error("decode-failed")); return; }
      var im = new Image();
      im.onload = function () { URL.revokeObjectURL(url); resolve(im); };
      im.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode-failed")); };
      im.src = url;
    });
  }

  function decodeImage(file) {
    if (typeof createImageBitmap === "function") {
      var p = null;
      try { p = createImageBitmap(file, { imageOrientation: "from-image" }); }
      catch (e) { p = null; }
      if (p && typeof p.then === "function") {
        return Promise.resolve(p).catch(function () { return decodeViaImg(file); });
      }
    }
    return decodeViaImg(file);
  }

  function closeImg(img) {
    try { if (img && typeof img.close === "function") img.close(); } catch (e) { /* ignore */ }
  }

  /* ---------------- 压缩：最长边 ≤ maxSide，白底打底，输出 JPEG ---------------- */
  function render(img, maxSide, quality) {
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (!w || !h) throw new Error("decode-failed");
    var scale = Math.min(1, maxSide / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));
    var canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    var ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no-canvas");
    ctx.fillStyle = "#ffffff";                 /* 白色打底：透明 PNG 转 JPEG 才不会变黑 */
    ctx.fillRect(0, 0, cw, ch);
    ctx.drawImage(img, 0, 0, cw, ch);
    return canvas.toDataURL("image/jpeg", quality);
  }

  /* 对外：压缩单张图，返回 dataURL */
  function compress(file, maxSide, quality) {
    return decodeImage(file).then(function (img) {
      try { return render(img, maxSide, quality); }
      finally { closeImg(img); }
    });
  }

  /* 一次解码，生成五档候选（从大到小），写入时逐档往下退 */
  function buildCandidates(file) {
    return decodeImage(file).then(function (img) {
      var out = [];
      try {
        for (var i = 0; i < LADDER.length; i++) {
          var url = "";
          try { url = render(img, LADDER[i][0], LADDER[i][1]); }
          catch (e) { break; }
          if (!url || url.indexOf("data:image/jpeg") !== 0) break;
          out.push(url);
        }
      } finally { closeImg(img); }
      return out;
    });
  }

  /* 选预览用的那一张：第一个不超过 400KB 的；都不够就取最小的一档 */
  function pickCandidate(cands) {
    for (var i = 0; i < cands.length; i++) {
      if (rawBytes(cands[i]) <= MAX_RAW) return cands[i];
    }
    return cands[cands.length - 1];
  }

  /* ---------------- 全屏预览 + 「用这张」/「换一张」（16.2） ---------------- */
  function mkBtn(label, onClick) {
    var b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    b.setAttribute(
      "style",
      "padding:10px 22px;border-radius:14px;border:1px solid var(--line, rgba(255,255,255,.22));" +
      "background:var(--surface, #23282b);color:inherit;font-size:15px;line-height:1.2;cursor:pointer;"
    );
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function showPreview(dataUrl) {
    return new Promise(function (resolve) {
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);

      var box = document.createElement("div");
      box.setAttribute(
        "style",
        "position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999;background:rgba(10,12,13,.95);" +
        "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:20px;"
      );

      var img = document.createElement("img");
      img.alt = "壁纸预览";
      img.src = dataUrl;
      img.setAttribute(
        "style",
        "max-width:100%;max-height:74vh;object-fit:contain;border-radius:14px;background:#fff;"
      );

      var row = document.createElement("div");
      row.setAttribute("style", "display:flex;gap:12px;flex-wrap:wrap;justify-content:center;");

      function close(act) {
        if (box.parentNode) box.parentNode.removeChild(box);
        overlay = null;
        resolve(act);
      }

      row.appendChild(mkBtn("用这张", function () { close("use"); }));
      row.appendChild(mkBtn("换一张", function () { close("swap"); }));

      box.appendChild(img);
      box.appendChild(row);
      document.body.appendChild(box);
      overlay = box;
    });
  }

  /* ---------------- 写入：预算检查 → 逐档试存 → 报真实原因 ---------------- */
  function tryWrite(dataUrl) {
    var key = (A.store && A.store.KEYS && A.store.KEYS.wallpaper) || "aura_wallpaper";
    try {
      /* 直接写一次是为了拿到 QuotaExceededError（settings.js 的 setStr 会吞掉异常） */
      window.localStorage.setItem(key, dataUrl);
      return { ok: true };
    } catch (e) {
      var name = (e && e.name) || "";
      var code = e && e.code;
      if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014) {
        return { ok: false, reason: "quota" };
      }
      return { ok: false, reason: "other", message: MSG.noStore };
    }
  }

  function commit(dataUrl, cands) {
    var size = rawBytes(dataUrl);
    var used = (A.store && typeof A.store.bytes === "function") ? A.store.bytes() : 0;

    /* 壁纸 + 历史 > 4MB：交给前端处理（不自己删数据） */
    if (used + size > TOTAL_BUDGET) {
      if (A.bus && typeof A.bus.emit === "function") {
        try { A.bus.emit("wallpaper:need-trim", { used: used, need: size }); } catch (e) { /* ignore */ }
      }
      toast(MSG.trim);
      return false;
    }

    var start = cands.indexOf(dataUrl);
    var list = start >= 0 ? cands.slice(start) : [dataUrl];
    var last = list[list.length - 1];

    for (var i = 0; i < list.length; i++) {
      var cand = list[i];
      /* 降级档也不许超 400KB 预算 */
      if (i > 0 && rawBytes(cand) > MAX_RAW) continue;
      var r = tryWrite(cand);
      if (r.ok) {
        A.save.wallpaper(cand);           /* 写入并让渲染层生效 */
        toast("壁纸换好了，占了 " + kb(rawBytes(cand)) + "KB。");
        return true;
      }
      if (r.reason !== "quota") {
        toast(r.message || MSG.noStore);
        return false;
      }
      /* quota → 退到下一档继续试 */
    }

    toast("原图太大，已压到 " + kb(rawBytes(last)) + "KB 仍存不下。");
    return false;
  }

  /* ---------------- 对外接口 ---------------- */

  /* 选图：source = 'gallery' | 'camera' */
  function pick(source) {
    lastSource = source === "camera" ? "camera" : "gallery";
    var input = lastSource === "camera" ? els.cam : els.gallery;
    if (!input) { toast("这个打开方式选不了文件。"); return; }
    try { input.value = ""; } catch (e) { /* ignore */ }
    input.click();
  }

  /* 预览：先压缩出候选 → 全屏预览 → 确认才写入 */
  function preview(file) {
    if (!file) return Promise.resolve(false);

    if (file.size > MAX_FILE) { toast(MSG.tooBig); return Promise.resolve(false); }
    if (!A.store || !A.store.storageOK) { toast(MSG.noStore); return Promise.resolve(false); }

    return buildCandidates(file).then(function (cands) {
      if (!cands.length) { toast(MSG.decode); return false; }
      var chosen = pickCandidate(cands);
      return showPreview(chosen).then(function (act) {
        if (act !== "use") {
          pick(lastSource);               /* 换一张：重新打开选择器 */
          return false;
        }
        return commit(chosen, cands);
      });
    }, function (e) {
      var m = (e && e.message) || "";
      toast(m === "decode-failed" ? MSG.decode : MSG.busy);
      return false;
    });
  }

  /* 清除壁纸：恢复纯色，蒙版复位 70%（不碰人设/称呼/主题/情绪/音色） */
  function clear() {
    A.save.wallpaper("");
    A.save.mask(DEFAULT_MASK);
    syncMask();
    toast("壁纸清掉了。");
    return true;
  }

  function syncMask() {
    var v = clampMask(A.cfg ? A.cfg.mask : DEFAULT_MASK);
    if (els.mask) els.mask.value = String(v);
    if (els.valMask) els.valMask.textContent = String(v);
  }

  function init() {
    if (inited) return;
    inited = true;

    els.gallery = document.getElementById("file-wall");
    els.cam = document.getElementById("file-cam");
    els.btnTop = document.getElementById("btn-wall");
    els.btnPick = document.getElementById("btn-wall-pick");
    els.btnCam = document.getElementById("btn-wall-cam");
    els.btnClear = document.getElementById("btn-wall-clear");
    els.mask = document.getElementById("in-mask");
    els.valMask = document.getElementById("val-mask");

    on(els.btnTop, "click", function () { pick("gallery"); });     /* 顶栏快捷入口 */
    on(els.btnPick, "click", function () { pick("gallery"); });
    on(els.btnCam, "click", function () { pick("camera"); });
    on(els.btnClear, "click", function () { clear(); });

    on(els.gallery, "change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) preview(f);
    });
    on(els.cam, "change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (f) preview(f);
    });

    /* 滑块调的是蒙版不透明度（0–90），不是图片 opacity */
    on(els.mask, "input", function () {
      var v = clampMask(els.mask.value);
      A.save.mask(v);
      if (els.valMask) els.valMask.textContent = String(v);
    });

    syncMask();

    /* 启动即探测 localStorage，不可用要在页面启动时主动提示一次（16.5） */
    if (!A.store || !A.store.storageOK) toast(MSG.noStore);
  }

  A.wallpaper = {
    init: init,
    pick: pick,
    preview: preview,
    clear: clear,
    compress: compress
  };

  /* 页面启动就跑一次（app.js 之后再调 init() 也不会重复绑定） */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
