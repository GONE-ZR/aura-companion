/* ============================================================
   chat.js —— 对话与流式（第 10、17、19 章）
   规则：全部用 textContent 渲染；发送锁防连点；失败回填输入框；
        思考延迟与长度正相关；流中断保留已收到的文字。
   ============================================================ */
(function () {
  "use strict";

  var S = window.Aura.store;
  var cfg = window.Aura.cfg;
  var bus = window.Aura.bus;

  var log = null;
  var input = null;
  var sendBtn = null;
  var busy = false;
  var messages = [];              /* {id, role:'me'|'ai', content, ts} */
  var transientImg = {};          /* msgId -> dataURL（只在内存，绝不进 localStorage） */
  var pendingImg = null;          /* 待发送图片 {dataURL, w, h} */
  var userScrolledUp = false;
  var jumpBtn = null;

  /* ---------------- 工具 ---------------- */
  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }
  function nowId() { return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ---------------- 渲染 ---------------- */
  function renderEmpty() {
    if (!log) return;
    log.textContent = "";
    var e = el("div", "empty-state");
    var t = el("p", "empty-text");
    /* 文案可被后台管理页远程改写（没设过就用默认那句） */
    var custom = "";
    try { custom = window.Aura.store.getStr("aura_text_empty", "") || ""; } catch (err) { custom = ""; }
    t.textContent = custom || "我在。";
    var d = el("div", "empty-dot");
    e.appendChild(t);
    e.appendChild(d);
    log.appendChild(e);
  }

  /* 时间戳元素（§1.2）：定长 + tabular-nums 由 CSS 保证不抖 */
  function timeEl(ts) {
    var t = el("div", "msg-time");
    t.textContent = window.AuraTime ? window.AuraTime.hms(ts) : "";
    t.setAttribute("datetime", window.AuraTime ? window.AuraTime.iso(ts) : "");
    return t;
  }

  /* 日期分割条（§1.2）：今天 / 昨天 / 10月20日 / 2025年10月20日 */
  function dayEl(ts) {
    var d = el("div", "day-sep");
    d.textContent = window.AuraTime ? window.AuraTime.dayLabel(ts) : "";
    return d;
  }

  /* 长按看完整时间（轻量浮层，点外部关闭） */
  var timeTip = null;
  function showTimeTip(target, ts) {
    hideTimeTip();
    var tip = el("div", "time-tip");
    tip.textContent = window.AuraTime ? window.AuraTime.full(ts) : "";
    document.body.appendChild(tip);
    var r = target.getBoundingClientRect();
    var w = 170;
    var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
    tip.style.left = left + "px";
    tip.style.top = Math.max(8, r.top - 44) + "px";
    timeTip = tip;
    setTimeout(function () {
      document.addEventListener("pointerdown", hideTimeTip, { once: true });
    }, 30);
  }
  function hideTimeTip() {
    if (timeTip && timeTip.parentNode) timeTip.parentNode.removeChild(timeTip);
    timeTip = null;
  }

  function bubbleFor(msg, prev) {
    var wrap = el("div", "msg " + (msg.role === "me" ? "me" : "ai"));
    if (window.AuraTime && window.AuraTime.shouldShow(msg.ts, prev && prev.ts)) {
      wrap.appendChild(timeEl(msg.ts));
    }
    var b = el("div", "bubble");
    var body = el("div", "bubble-text");
    body.textContent = msg.content || "";
    b.appendChild(body);
    wrap.appendChild(b);

    /* 长按 550ms → 显示这条的完整时间（绑在整组上，多气泡也生效） */
    var pressTimer = null;
    function clearPress() {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    }
    wrap.addEventListener("pointerdown", function () {
      clearPress();
      pressTimer = setTimeout(function () {
        pressTimer = null;
        showTimeTip(wrap, msg.ts);
      }, 550);
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach(function (ev) {
      wrap.addEventListener(ev, clearPress);
    });
    wrap.addEventListener("pointermove", clearPress);

    var img = transientImg[msg.id];
    if (img) {
      var im = el("img", "bubble-img");
      im.src = img;
      im.alt = "图片";
      im.addEventListener("click", function () {
        if (window.Aura.ui && window.Aura.ui.viewImage) window.Aura.ui.viewImage(img);
      });
      wrap.insertBefore(im, b);
    }

    if (msg.role === "ai") {
      var sp = el("button", "speak-btn");
      sp.setAttribute("aria-label", "朗读");
      sp.title = "朗读";
      sp.textContent = "♪";
      sp.addEventListener("click", function () {
        if (window.Aura.voice) {
          window.Aura.voice.stop();
          window.Aura.voice.speak(msg.content, (window.Aura.mood && window.Aura.mood.currentEmotion().type) || "calm");
        }
      });
      wrap.appendChild(sp);
    }
    return wrap;
  }

  function renderAll() {
    if (!log) return;
    log.textContent = "";
    if (!messages.length) { renderEmpty(); return; }
    var prev = null;
    messages.forEach(function (m) {
      if (!(window.AuraTime && window.AuraTime.sameDay(m.ts, prev && prev.ts))) {
        log.appendChild(dayEl(m.ts));
      }
      log.appendChild(bubbleFor(m, prev));
      prev = m;
    });
    scrollToEnd(true);
  }

  function appendMessage(msg, animate) {
    if (!log) return;
    if (log.querySelector(".empty-state")) log.textContent = "";
    /* 找前一条（决定要不要显示时间戳 / 日期条） */
    var prev = null;
    for (var i = 0; i < messages.length; i++) {
      if (messages[i].id === msg.id) { prev = i > 0 ? messages[i - 1] : null; break; }
    }
    if (!(window.AuraTime && window.AuraTime.sameDay(msg.ts, prev && prev.ts))) {
      log.appendChild(dayEl(msg.ts));
    }
    var node = bubbleFor(msg, prev);
    if (!animate) node.classList.add("no-anim");
    log.appendChild(node);
    return node;
  }

  /* ---------------- 滚动 ---------------- */
  function scrollToEnd(force) {
    if (!log) return;
    if (userScrolledUp && !force) return;
    try { log.scrollIntoView({ behavior: "auto", block: "end" }); }
    catch (e) { log.scrollTop = log.scrollHeight; }
  }

  function ensureJumpBtn() {
    if (jumpBtn) return jumpBtn;
    jumpBtn = el("button", "jump-latest");
    jumpBtn.textContent = "回到最新";
    jumpBtn.setAttribute("aria-label", "回到最新消息");
    jumpBtn.style.cssText = "position:fixed;left:50%;transform:translateX(-50%);bottom:104px;" +
      "z-index:30;padding:6px 14px;border-radius:999px;border:1px solid var(--line);" +
      "background:var(--surface);color:var(--text-dim);font-size:12px;display:none;box-shadow:0 2px 10px rgba(0,0,0,.06)";
    jumpBtn.addEventListener("click", function () {
      userScrolledUp = false;
      jumpBtn.style.display = "none";
      scrollToEnd(true);
    });
    document.body.appendChild(jumpBtn);
    return jumpBtn;
  }

  function onScroll() {
    if (!log) return;
    var far = log.scrollHeight - log.scrollTop - log.clientHeight;
    if (far > 90) {
      userScrolledUp = true;
      if (jumpBtn) jumpBtn.style.display = "block";
    } else {
      userScrolledUp = false;
      if (jumpBtn) jumpBtn.style.display = "none";
    }
  }

  /* ---------------- system prompt 组装 ---------------- */
  function timeHint() {
    var d = new Date();
    var h = d.getHours();
    var line = "当前本地时间：" + d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) +
      " " + pad(h) + ":" + pad(d.getMinutes()) + "。";
    if (h >= 1 && h < 5) line += "凌晨，不要追问，句子更短。";
    else if (h >= 6 && h < 9) line += "早上，可以自然问一句\"起了？\"。";
    else if (h >= 11 && h < 14) line += "中午，可以自然问一句\"吃了吗\"。";
    else if (h >= 17 && h < 20) line += "傍晚，可以自然问一句\"吃了吗\"。";
    else if (h >= 22 || h < 1) line += "深夜，语速自动放慢。";
    line += "不要报时，不要提醒作息，不要说\"该睡了\"。";
    return line;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function buildSystem() {
    var persona = (cfg.persona && cfg.persona.text) || "";
    if (!persona) {
      var t = cfg.templates || [];
      for (var i = 0; i < t.length; i++) {
        if (t[i].id === "default") { persona = t[i].text; break; }
      }
    }
    var parts = [];
    if (persona) parts.push(persona);

    /* 称呼（8.2 第 6 条） */
    var who = [];
    if (cfg.aiName) who.push("你的名字是" + cfg.aiName + "。");
    if (cfg.userName) who.push("你称呼对方为" + cfg.userName + "。");
    if (who.length) parts.push(who.join(""));

    /* 情绪行（11.6 / 12.6） */
    if (window.Aura.mood) {
      var ml = window.Aura.mood.systemLine();
      if (ml) parts.push(ml);
      var el2 = window.Aura.mood.emotionLine();
      if (el2) parts.push(el2);
    }

    /* 长期记忆 + 摘要（7.1/7.2） */
    if (window.Aura.memory) {
      var mb = window.Aura.memory.memoryBlock();
      if (mb) parts.push(mb);
      var sb = window.Aura.memory.summaryBlock();
      if (sb) parts.push(sb);
    }

    parts.push(timeHint());

    /* 天气上下文（18.4） */
    if (window.Aura.weather) {
      var wx = window.Aura.weather.injectForTurn(lastUserText);
      if (wx) {
        parts.push(wx);
        parts.push("拿到天气信息时，只在用户问到、或与之直接相关时才提；" +
          "提的时候给具体建议（穿什么、带不带伞、要不要加一件），" +
          "不要说\"注意保暖\"\"记得穿衣\"这类空话。");
      }
    }

    /* 朗读提示（13.4） */
    parts.push("你的回复会被读出来。为了听起来像人在说话：\n" +
      "- 用句号断句，不要长句。\n" +
      "- 需要停一下的地方用\"……\"，但一条回复最多一处。\n" +
      "- 不要用括号、不要用星号动作描写。\n" +
      "- 不要写\"（叹气）\"\"（停顿）\"这类舞台提示，读出来会变成噪音。");

    return parts.join("\n\n");
  }

  /* 天气注入需要知道本轮用户说了什么 */
  var lastUserText = "";

  /* ---------------- 请求体 ---------------- */
  function apiHeaders() {
    var h = { "Content-Type": "application/json" };
    if (cfg.apiKey) h["X-Aura-Key"] = cfg.apiKey;
    return h;
  }

  function isDirect() {
    return cfg.mode !== "server" && hasChannel();
  }

  /* ---------------- 情绪引擎状态（本地持久化） ---------------- */
  var ENGINE_KEY = "aura_engine_v1";
  var _engine = null;

  function engineState() {
    if (!window.AuraEngine) return null;
    if (_engine) return _engine;
    try { _engine = JSON.parse(localStorage.getItem(ENGINE_KEY) || "null"); } catch (e) { _engine = null; }
    if (!_engine || typeof _engine.patience !== "number") {
      _engine = window.AuraEngine.createState();
    }
    return _engine;
  }
  function saveEngine() {
    if (!_engine) return;
    try { localStorage.setItem(ENGINE_KEY, JSON.stringify(_engine)); } catch (e) { /* ignore */ }
  }
  /* App 启动 / 每次发消息前结算一次（按真实时间衰减） */
  function settleEngine() {
    var st = engineState();
    if (!st) return null;
    /* 第五篇 §2：今天的生活线先落盘，情绪原因再从这里读 */
    try {
      if (window.AuraLife) {
        window.AuraLife.ensureToday(new Date());
        /* 状态与原因都取落盘的生活线（不临场编） */
        if (st.patience < 60 && (st.state === "calm" || st.state === "soft")) {
          var ls = window.AuraLife.stateFor();
          var lc = window.AuraLife.causeFor();
          if (ls) st.state = ls;
          if (lc) st.cause = lc;
        }
      }
    } catch (e) { /* ignore */ }
    try {
      window.AuraEngine.settle(st, Date.now());
      window.AuraEngine.checkNoReply(st, Date.now());
      saveEngine();
    } catch (e) { /* ignore */ }
    return st;
  }

  function lastGapMs() {
    var last = messages.length ? messages[messages.length - 1].ts : 0;
    return last ? Date.now() - last : 0;
  }

  function buildPayload(userText, images) {
    var msgs = messages.map(function (m) {
      return { role: m.role === "me" ? "user" : "assistant", content: m.content };
    });
    if (images && images.length) {
      msgs.pop();
      msgs.push({ role: "user", content: userText });
    }

    /* §五 装配：[1] 角色 + [3] 记忆 → system；[2] 历史 → messages；[4] 状态 → 末尾 */
    var asm = null;
    try {
      if (window.AuraPrompt) {
        asm = (window.AuraPrompt.assembleCached || window.AuraPrompt.assembleSplit)({
          engine: window.AuraEngine,
          state: engineState(),
          memories: window.AuraMemfacts ? window.AuraMemfacts.forPrompt() : [],
          history: messages.map(function (m) {
            return { role: m.role === "me" ? "user" : "assistant", text: m.content };
          }),
          now: Date.now(),
          lastGap: lastGapMs(),
          summary: (window.Aura.memory && window.Aura.memory.summaryText && window.Aura.memory.summaryText()) || "",
          emergency: (cfg && cfg.emergency) || "",
          resumeHint: (function () {
            try {
              if (!window.AuraOpenLoop) return "";
              var plan = window.AuraOpenLoop.plan(userText, Date.now());
              if (plan.mode === "none" || plan.mode === "fresh" || plan.mode === "abandon") return "";
              /* 只给"接话头"或"轻提一句"，不让她复述历史 */
              return plan.mode === "light"
                ? "他隔了几天才回来。可以轻提一句「" + plan.topic + "」，不追问。"
                : "接着「" + plan.topic + "」往下聊，不要复述之前说过的话。";
            } catch (e) { return ""; }
          })(),
          hotline: (cfg && cfg.hotline) || ""
        });
      }
    } catch (e) { asm = null; }

    return {
      system_prompt: asm ? asm.system : buildSystem(),
      messages: asm ? asm.messages : msgs,
      images: images || [],
      temperature: 0.7,
      max_tokens: 1200
    };
  }

  /* 直连模式：手机自己打 DeepSeek。
     DeepSeek 允许跨域（Access-Control-Allow-Origin 会回显 Origin），
     所以浏览器/WebView 里可以直接调，不需要任何服务器。 */
  var DS_URL = "https://api.deepseek.com/v1/chat/completions";
  var DS_MODEL = "deepseek-flash";

  /* ---------------- 网络通道（本轮定案：代理优先，直连兜底） ----------------
     ① Cloudflare Workers 代理：包里零密钥，可公开下载；地址可热更新
     ② 用户自己填 Key：直连 DeepSeek
     ③ 明确选了"服务器"（旧模式，只在电脑上调试时用）：走 /api/chat/stream
     缺通道时**绝不静默掉回本机服务** —— 在 APK 里那是 https://localhost，必然失败。 */
  function chatProxy() {
    try {
      var p = S.getStr("aura_chat_proxy", "");
      if (!p && window.AuraCfg) {
        var a = window.AuraCfg.loadActive();
        p = (a && a.config && a.config.net && a.config.net.chatProxy) || "";
      }
      return p ? String(p).trim().replace(/\/+$/, "") : "";
    } catch (e) { return ""; }
  }
  function proxyUrl(path) {
    var p = chatProxy();
    return p ? (p + path) : "";
  }
  function hasChannel() { return !!(cfg.apiKey || chatProxy()); }


  /* ---------------- 第四篇：模型层（白名单 + 参数 + 思考必须关） ---------------- */
  var MODELS = {
    standard: { id: "deepseek-flash", temp: 1.25, maxTokens: 300 },
    delicate: { id: "deepseek-v4-pro", temp: 1.15, maxTokens: 300 }
  };
  var FALLBACK = { id: "deepseek-flash", temp: 1.25, maxTokens: 300 };  /* 同 tier，通常就是 flash */

  function tier() {
    try { return S.getStr("aura_tier", "") === "delicate" ? "delicate" : "standard"; } catch (e) { return "standard"; }
  }
  function modelProfile(t) {
    return MODELS[t] || MODELS.standard;
  }

  function buildDirectPayload(payload, useFallback) {
    var msgs = [];
    if (payload.system_prompt) msgs.push({ role: "system", content: payload.system_prompt });
    payload.messages.forEach(function (m) {
      var content = m.content;
      if (payload.images && payload.images.length && m.role === "user"
          && m === payload.messages[payload.messages.length - 1]) {
        var blocks = [{ type: "text", text: content || "给你看一张图" }];
        payload.images.forEach(function (img) {
          if (typeof img === "string" && img.indexOf("data:image") === 0) {
            blocks.push({ type: "image_url", image_url: { url: img } });
          }
        });
        content = blocks;
      }
      msgs.push({ role: m.role, content: content });
    });
    var prof = useFallback ? FALLBACK : modelProfile(tier());
    var wantStream = payload.stream !== false;
    var out = {
      model: prof.id,
      /* §3.2：主对话每轮必须显式关闭思考模式，否则首行标签必被破坏 */
      thinking: { type: "disabled" },
      messages: msgs,
      temperature: (typeof payload.temperature === "number") ? payload.temperature : prof.temp,
      max_tokens: payload.max_tokens || prof.maxTokens,
      stream: wantStream
    };
    if (wantStream) out.stream_options = { include_usage: true };
    if (payload.response_format) out.response_format = payload.response_format;
    return out;
  }

  /* 连续 fallback 计数（第四篇 §8：连续 3 轮后设置页出现"当前使用备用线路"） */
  var fallbackStreak = 0;

  function directRequest(payload, useFallback, signal) {
    /* 有代理就走代理（Key 在 Workers 里，客户端不带 Authorization）；
       没代理才直连 DeepSeek（用户自己填的 Key） */
    var viaProxy = !!chatProxy();
    var url = viaProxy ? proxyUrl("/chat") : DS_URL;
    var headers = { "Content-Type": "application/json" };
    if (!viaProxy) headers["Authorization"] = "Bearer " + cfg.apiKey;
    return fetch(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(buildDirectPayload(payload, useFallback)),
      signal: signal
    });
  }

  /* 失败重试 + 静默切备用（§8）：不弹窗、不改用户的选择、不降级 prompt */
  function requestWithFallback(payload, signal) {
    var one = function (fallback) { return directRequest(payload, fallback, signal); };
    return one(false).then(function (res) {
      if (res.ok) return res;
      return new Promise(function (ok) { setTimeout(ok, 800); })
        .then(function () { return one(false); })
        .then(function (res2) {
          if (res2.ok) return res2;
          fallbackStreak += 1;
          return one(true);
        });
    }).catch(function (err) {
      /* 网络层失败也走同一条兜底链 */
      return new Promise(function (ok) { setTimeout(ok, 800); })
        .then(function () { return one(true); })
        .catch(function () { throw err; });
    }).then(function (res) {
      if (res && res.ok) {
        /* 成功则清零（但连 3 轮用过备用时保留标记给设置页） */
        if (fallbackStreak >= 3 && S.getStr("aura_fallback_note", "") !== "1") {
          S.setStr("aura_fallback_note", "1");
          try { bus.emit("fallback:streak", fallbackStreak); } catch (e) { }
        }
      }
      return res;
    });
  }

  /* ---------------- 思考延迟（10.7） ----------------
     规格书要求"回复不像瞬时到达"，但 deepseek-flash 本身就要思考 ~1.8s，
     再叠一层最长 2.4s 的等待就是双倍延迟（实测首字要 4 秒多）。
     所以做成三档：off 不等 / short 很短（默认）/ normal 规格书节奏。 */
  function thinkDelay(text) {
    var mode = cfg.thinkDelay || "short";
    if (mode === "off") return 0;
    var len = (text || "").length;
    var base;
    if (len < 10) base = 700;
    else if (len < 40) base = 1250;
    else base = 2000;
    if (mode === "short") base = Math.round(base * 0.22);
    var jitter = base * (Math.random() * 0.4 - 0.2);   /* ±20% */
    return Math.max(0, Math.round(base + jitter));
  }

  /* ---------------- 安全层：命中后这一轮不走人设（§八） ---------------- */
  function renderSafetyTurn(userText, safety) {
    /* §3.2：命中就立刻掐掉正在跑的生成/搜索，不许两边同时说话 */
    try {
      if (activeController) { activeController.abort(); activeController = null; }
    } catch (e) { /* ignore */ }
    setBusy(false);

    var meMsg = { id: nowId(), role: "me", content: userText, ts: Date.now() };
    messages.push(meMsg);
    appendMessage(meMsg, false);
    window.Aura.messages.save(messages);

    input.value = "";
    autoGrow();
    setBusy(false);

    var meta = window.AuraSafety.metaFor(safety.category);
    try { if (window.AuraEmotionUI) window.AuraEmotionUI.applyMeta(meta); } catch (e) { /* ignore */ }

    setTimeout(function () {
      /* 求助卡片（在气泡上方） */
      if (log) {
        var card = document.createElement("div");
        card.className = "safety-card";
        var h = document.createElement("h4");
        h.textContent = "先顾好自己";
        var p1 = document.createElement("div");
        p1.textContent = "24 小时心理援助热线：";
        var a = document.createElement("span");
        a.className = "nums";
        a.textContent = window.AuraSafety.HOTLINE;
        p1.appendChild(a);
        var p2 = document.createElement("div");
        p2.textContent = "有紧急危险：先离开现在的空间，打 110 / 120，或联系你信任的人。";
        card.appendChild(h);
        card.appendChild(p1);
        card.appendChild(p2);
        log.appendChild(card);
      }

      var replyText = window.AuraSafety.replyFor(safety.category);
      var aiMsg = { id: nowId(), role: "ai", content: replyText, ts: Date.now(), bubbleCount: 3 };
      var node = appendMessage(aiMsg, false);
      node.classList.add("safety-bubble");
      messages.push(aiMsg);
      window.Aura.messages.save(messages);
      scrollToEnd(true);

      if (window.Aura.voice) {
        try { window.Aura.voice.speak(replyText, "serious"); } catch (e) { /* ignore */ }
      }
      /* 安全轮不喂给情绪引擎，也不抽记忆 */
    }, 420);
  }

  /* ---------------- 没密钥时的引导 ---------------- */
  function noKeyHint() {
    /* §1.2：优先用"填 Key"引导层（有输入框、能当场保存），而不是只弹一句 toast */
    if (window.Aura && window.Aura.showKeyGate) {
      try { window.Aura.showKeyGate(); return; } catch (e) { /* 退回气泡提示 */ }
    }
    if (window.Aura.ui && window.Aura.ui.toast) {
      window.Aura.ui.toast("还没填 DeepSeek 密钥，先填一下");
    }
    /* 在聊天区里明说一遍（这条不存历史，下次发送就清掉） */
    if (log) {
      var old = log.querySelector(".nokey-note");
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var box = document.createElement("div");
      box.className = "msg ai nokey-note";
      var inner = document.createElement("div");
      inner.className = "bubble";
      var txt = document.createElement("div");
      txt.className = "bubble-text";
      txt.textContent = "还没填密钥，所以我发不出去。点右上角设置 → 连接 → 填「DeepSeek 密钥」，或者填「代理地址」，两者留一个就行，填完就能聊了。";
      inner.appendChild(txt);
      box.appendChild(inner);
      log.appendChild(box);
      scrollToEnd(true);
    }
    /* 直接把设置打开，并高亮密钥那一栏 */
    setTimeout(function () {
      if (window.Aura.ui && window.Aura.ui.openDrawer) window.Aura.ui.openDrawer();
      var k = document.getElementById("in-key");
      if (k) {
        try {
          k.scrollIntoView({ block: "center", behavior: "smooth" });
          k.focus();
        } catch (e) { /* ignore */ }
      }
    }, 260);
  }

  /* ---------------- 发送 ---------------- */
  function setBusy(v) {
    busy = v;
    if (sendBtn) sendBtn.disabled = v || !input.value.trim();
    if (input) input.setAttribute("aria-busy", v ? "true" : "false");
  }

  function send() {
    if (busy) return;
    var text = input.value.trim();
    var hasImg = !!pendingImg;
    if (!text && !hasImg) return;

    /* §1.1 红线：不管 mode 是什么，只要既没有 Key 也没有代理，就**一条请求都不发**。
       APK 里的同源是 https://localhost，发出去必然失败，而且不会报错 —— 那是最坏的情况。 */
    if (!hasChannel()) {
      noKeyHint();
      return;
    }

    /* 发送锁：防连点（第 19.3） */
    setBusy(true);

    var userText = text || "给你看一张图";
    lastUserText = userText;

    /* §八 安全层：先分类。命中就换整套流程，人设让位 */
    var safety = null;
    try { if (window.AuraSafety) safety = window.AuraSafety.classify(userText); } catch (e) { safety = null; }
    if (safety && safety.hit && safety.category) {
      setBusy(false);
      renderSafetyTurn(userText, safety);
      return;
    }

    /* §四 情绪引擎：先按真实时间结算，再吃这条消息 */
    var st = settleEngine();
    if (st && window.AuraEngine) {
      try {
        var view = window.AuraEngine.publicView(st);
        window.AuraEngine.onUserMessage(st, userText, {
          sheWasSerious: view.state === "serious" || view.state === "blank",
          now: Date.now(),
          messageId: meMsg ? meMsg.id : null,
          lifeEvents: window.AuraLife ? window.AuraLife.today() : null
        });
        window.AuraEngine.maybeSulky(st, userText, { now: Date.now() });
        saveEngine();
        if (window.AuraEmotionUI) window.AuraEmotionUI.applyState(st.state, 1);
      } catch (e) { /* 引擎出错不许拦住对话 */ }
    }

    /* 图片隐私告知（17.1） */
    if (hasImg && S.getStr(S.KEYS.imgNotice, "") !== "1") {
      S.setStr(S.KEYS.imgNotice, "1");
    }

    /* 本轮情绪（在生成之前定，第 13.6） */
    var emo = { type: "calm", intensity: 0 };
    if (window.Aura.mood) emo = window.Aura.mood.onUserMessage(userText);

    /* 入历史（图片只留占位符，第 17.4） */
    var meMsg = { id: nowId(), role: "me", content: hasImg ? "[发了一张图片]" : userText, ts: Date.now() };
    messages.push(meMsg);
    var images = [];
    if (hasImg) {
      images.push(pendingImg.dataURL);
      transientImg[meMsg.id] = pendingImg.dataURL;
    }
    window.Aura.messages.save(messages);

    /* 清输入 */
    input.value = "";
    autoGrow();
    pendingImg = null;
    renderAttach();

    appendMessage(meMsg, false);
    var meNode = log.lastElementChild;
    userScrolledUp = false;
    scrollToEnd(true);

    /* 助手占位气泡 */
    var aiMsg = { id: nowId(), role: "ai", content: "", ts: Date.now() };
    var node = appendMessage(aiMsg, true);
    var bubble = node.querySelector(".bubble");
    var body = bubble.querySelector(".bubble-text");
    bubble.classList.add("thinking");
    var think = el("span", "think-label");
    think.textContent = "在想…";
    bubble.appendChild(think);
    var dots = el("span", "dots");
    dots.appendChild(el("i")); dots.appendChild(el("i")); dots.appendChild(el("i"));
    bubble.appendChild(dots);
    scrollToEnd(true);

    /* 延迟后再发请求 */
    setTimeout(function () {
      streamReply(meMsg, meNode, aiMsg, node, body, bubble, think, dots, userText, images, emo);
    }, thinkDelay(userText));
  }

  var activeController = null;

  /* 第二篇 §3.5：流式中常驻停止按钮；点击**保留已输出内容** */
  function stopStreaming() {
    if (activeController) {
      try { activeController.abort(); } catch (e) { /* ignore */ }
      activeController = null;
      setBusy(false);
      toast("停了");
    }
  }

  function streamReply(meMsg, meNode, aiMsg, node, body, bubble, think, dots, userText, images, emo) {
    var payload = buildPayload(userText, images);
    var controller = ("AbortController" in window) ? new AbortController() : null;
    activeController = controller;

    var req;
    if (cfg.mode === "server") {
      /* 只在用户明确选了"走服务器"时才走本机服务（电脑上调试用） */
      req = fetch("/api/chat/stream", {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify(payload),
        signal: controller ? controller.signal : undefined
      }).catch(function (err) {
        if (hasChannel()) {
          try { toast("连不上服务，改走直连"); } catch (e) { }
          return requestWithFallback(payload);
        }
        throw err;
      });
    } else if (hasChannel()) {
      req = requestWithFallback(payload, controller ? controller.signal : undefined);
    } else {
      /* 没代理也没 Key：明确报"没配好"，**不许**掉回 /api/chat/stream（APK 里必挂） */
      req = Promise.reject(new Error("NO_CHANNEL"));
    }

    req.then(function (res) {
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          throw new Error((d && d.error) || ("http" + res.status));
        });
      }
      if (!res.body) throw new Error("no-stream");

      var reader = res.body.getReader();
      var dec = new TextDecoder("utf-8");
      var buf = "";
      var rawAll = "";        /* 原始累积（含首行标签） */
      var text = "";          /* 剥掉标签后的正文 */
      var got = false;
      var metaDone = false;

      function applyMetaOnce(m) {
        if (metaDone) return;
        metaDone = true;
        try {
          if (window.AuraEmotionUI) window.AuraEmotionUI.applyMeta(m);
        } catch (e) { /* 视觉层出问题不许影响对话 */ }
      }

      /* 模型偶尔不吐 JSON，而是吐 "calm, dusk, 0" 这种逗号列表 —— 也当标签剥掉 */
      var TAGLIKE = /^\s*(calm|smile|soft|tease|sulky|serious|blank|tired)\s*[,，]\s*(warm|dusk|cool|gray)\s*[,，]\s*([0-2])\s*$/i;

      /* 首行是 {"e":...} 就剥掉并先切表情；不是就当正文 */
      function stripMeta(all) {
        if (!window.AuraMeta) return all;
        var nl = all.indexOf("\n");
        var head = nl === -1 ? all : all.slice(0, nl);

        /* ① JSON 标签 */
        var parsed = window.AuraMeta.parseLine(head);
        if (parsed) {
          applyMetaOnce(parsed);
          if (nl === -1) return "";
          return all.slice(nl + 1);
        }
        /* ② "calm, dusk, 0" 这种逗号列表（模型偶尔不吐 JSON） */
        var m2 = head.match(TAGLIKE);
        if (m2) {
          applyMetaOnce({ e: m2[1].toLowerCase(), b: m2[2].toLowerCase(), i: Number(m2[3]) });
          if (nl === -1) return "";
          return all.slice(nl + 1);
        }
        if (nl === -1 && head.trim().charAt(0) === "{") return "";   /* 可能是半个标签 */
        applyMetaOnce(window.AuraMeta.fallbackMeta());               /* 首行不像标签 → 兜底 */
        return all;
      }

      function handleChunk(raw) {
        buf += raw;
        var parts = buf.split("\n");
        buf = parts.pop();
        parts.forEach(function (line) {
          line = line.trim();
          if (!line || line.indexOf("data:") !== 0) return;
          var payloadStr = line.slice(5).trim();
          if (payloadStr === "[DONE]") return;
          var obj;
          try { obj = JSON.parse(payloadStr); } catch (e) { return; }
          if (obj.error) throw new Error(obj.error);
          /* 第六篇 §6：最后一帧带 usage（include_usage），只记数量不记内容 */
          if (obj.usage && window.AuraUsage) {
            try { window.AuraUsage.recordUsage(obj.usage, { model: obj.model || "" }); } catch (e) { }
          }
          var delta = "";
          try { delta = (obj.choices && obj.choices[0].delta && obj.choices[0].delta.content) || ""; }
          catch (e) { delta = ""; }
          if (delta) {
            if (!got) {
              got = true;
              bubble.classList.remove("thinking");
              if (think && think.parentNode) think.parentNode.removeChild(think);
              if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
            }
            rawAll += delta;
            text = stripMeta(rawAll);
            body.textContent = text;
            scrollToEnd(false);
          }
        });
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) {
            if (buf) handleChunk("");
            return text;
          }
          handleChunk(dec.decode(r.value, { stream: true }));
          return pump();
        });
      }

      return pump().then(function () { return { text: text, partial: got }; });
    }).then(function (out) {
      var text = out.text || "";
      bubble.classList.remove("thinking");
      if (think && think.parentNode) think.parentNode.removeChild(think);
      if (dots && dots.parentNode) dots.parentNode.removeChild(dots);
      if (!text) {
        /* 一个字都没有 → 视为失败，回填输入框 */
        node.remove();
        messages = messages.filter(function (m) { return m.id !== aiMsg.id; });
        /* 用户那条也撤掉：内容已经回到输入框了，留着会重复 */
        if (meNode) meNode.remove();
        messages = messages.filter(function (m) { return m.id !== meMsg.id; });
        window.Aura.messages.save(messages);
        input.value = userText;
        autoGrow();
        toast("没发出去，再试一次？");
        setBusy(false);
        if (window.Aura.ui && window.Aura.ui.focusInput) window.Aura.ui.focusInput();
        return;
      }
      body.textContent = text;
      aiMsg.content = text;

      /* §六 第 3 条：按换行 / >28 字拆成多条气泡（同一条消息里堆叠） */
      try {
        if (window.AuraMeta) {
          var parts2 = window.AuraMeta.splitBubbles(text, { max: 28 });
          if (parts2.length > 1) {
            aiMsg.bubbleCount = parts2.length;
            var bubbleWrap = bubble.parentNode;
            /* 第一条沿用原气泡，其余追加在后面 */
            body.textContent = parts2[0];
            for (var bi = 1; bi < parts2.length; bi++) {
              var extra = bubble.cloneNode(true);
              var et = extra.querySelector(".bubble-text");
              if (et) et.textContent = parts2[bi];
              extra.style.opacity = "0";
              extra.style.transform = "translateY(6px)";
              extra.style.transition = "opacity .45s ease, transform .45s ease";
              bubbleWrap.appendChild(extra);
              (function (elx, delay) {
                setTimeout(function () {
                  elx.style.opacity = "1";
                  elx.style.transform = "translateY(0)";
                }, delay);
              })(extra, 140 * bi);
            }
          } else {
            aiMsg.bubbleCount = 1;
          }
        }
      } catch (e) { /* 拆气泡失败不影响主流程 */ }
      /* 这一条是带着什么情绪说的 —— 气泡会跟着变（生气/高兴/兴奋…） */
      if (window.Aura.expr) {
        try {
          bubble.setAttribute("data-face", window.Aura.expr.faceFor(emo.type, emo.intensity));
        } catch (e) { /* ignore */ }
      }
      activeController = null;
      messages.push(aiMsg);
      window.Aura.messages.save(messages);
      try { if (window.AuraOffline) window.AuraOffline.noteOnline(); } catch (e) { }
      /* §九：每 7 轮抽一次记忆（后台跑，不阻塞） */
      /* 第五篇 §4：话题开合（本地启发式，异步判定不占主对话） */
      try {
        if (window.AuraOpenLoop) {
          if (window.AuraOpenLoop.looksOpen(userText)) window.AuraOpenLoop.open(userText);
          else if (/解决了|好了|过了|定下来了|结束了/.test(userText)) {
            var lp = window.AuraOpenLoop.latest();
            if (lp) window.AuraOpenLoop.close(lp.id);
          }
        }
      } catch (e) { /* ignore */ }
      try { recordTurn(); } catch (e) { /* ignore */ }
      try { maybeQuickReplies(text); } catch (e) { /* ignore */ }
      scrollToEnd(false);
      setBusy(false);

      /* 情绪轮次推进 */
      if (window.Aura.mood) window.Aura.mood.onTurnEnd();

      /* 回复结束了 → 如果之前有更新提示，现在可以显示（规格 23.3 f） */
      bus.emit("chat:idle");

      /* 朗读：极短回复不自动读（13.8） */
      if (window.Aura.voice && window.Aura.voice.getAutoRead && window.Aura.voice.getAutoRead()) {
        var plain = text.replace(/[\s。，、！？…,.!?"'（）()]/g, "");
        if (plain.length > 4) {
          window.Aura.voice.speak(text, emo.type);
        }
      }
    }).catch(function (err) {
      var msg = String(err && err.message || err);
      bubble.classList.remove("thinking");
      if (think && think.parentNode) think.parentNode.removeChild(think);
      if (dots && dots.parentNode) dots.parentNode.removeChild(dots);

      /* 没有任何可用通道（既没配代理，也没填 Key）→ 明确告诉人怎么修，不许假装网络问题 */
      if (msg.indexOf("NO_CHANNEL") >= 0) {
        body.textContent = "还没连上模型。去「设置 → 连接方式」填 API Key，或者让我连代理，二选一就行。";
        aiMsg.content = body.textContent;
        aiMsg.bubbleCount = 1;
        messages.push(aiMsg);
        window.Aura.messages.save(messages);
        scrollToEnd(false);
        setBusy(false);
        try { toast("先在设置里填 Key 或代理地址"); } catch (e) { }
        return;
      }

      /* 第六篇 §2：断网 → 用本地短句回一句（不弹"网络异常"、不解释原因） */
      if (window.AuraOffline && window.AuraOffline.looksOffline(err)) {
        var st0 = engineState();
        var off = window.AuraOffline.reply(st0 ? st0.state : "calm", userText);
        try {
          if (window.AuraEmotionUI) window.AuraEmotionUI.applyMeta({ e: off.e, b: off.b, i: 1 });
        } catch (e) { /* ignore */ }
        body.textContent = off.text;
        aiMsg.content = off.text;
        aiMsg.bubbleCount = 1;
        messages.push(aiMsg);
        window.Aura.messages.save(messages);
        scrollToEnd(false);
        setBusy(false);
        return;
      }

      if (body.textContent && body.textContent.length > 0) {
        /* 流中断：保留已收到的文字（19.5） */
        aiMsg.content = body.textContent;
        messages.push(aiMsg);
        window.Aura.messages.save(messages);
        toast("说到一半断了");
      } else {
        node.remove();
        messages = messages.filter(function (m) { return m.id !== aiMsg.id; });
        if (meNode) meNode.remove();
        messages = messages.filter(function (m) { return m.id !== meMsg.id; });
        window.Aura.messages.save(messages);
        input.value = userText;
        autoGrow();
        toast("没发出去，再试一次？");
        if (window.Aura.ui && window.Aura.ui.focusInput) window.Aura.ui.focusInput();
      }
      setBusy(false);
    });
  }

  /* ---------------- 输入区 ---------------- */
  function autoGrow() {
    if (!input) return;
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 132) + "px";
    if (sendBtn) sendBtn.disabled = busy || !input.value.trim();
  }

  function toast(t) {
    if (window.Aura.ui && window.Aura.ui.toast) window.Aura.ui.toast(t);
    else bus.emit("toast", t);
  }

  /* ---------------- 图片附件 ---------------- */
  function renderAttach() {
    var row = document.getElementById("attach-row");
    var img = document.getElementById("attach-thumb");
    if (!row || !img) return;
    if (pendingImg) {
      img.src = pendingImg.dataURL;
      row.hidden = false;
    } else {
      row.hidden = true;
      img.removeAttribute("src");
    }
  }

  function pickImage() {
    var f = document.getElementById("file-attach");
    if (f) f.click();
  }

  function onFile(e) {
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 40 * 1024 * 1024) { toast("这张图太大了，换一张试试"); return; }
    if (!window.Aura.wallpaper || !window.Aura.wallpaper.compress) { toast("图片处理还没准备好"); return; }
    window.Aura.wallpaper.compress(file, 1024, 0.80).then(function (dataURL) {
      pendingImg = { dataURL: dataURL };
      renderAttach();
    }).catch(function () {
      toast("这张照片格式读不了，在相册里先存成 JPG 再试");
    });
  }

  /* ---------------- 键盘（19.1） ---------------- */
  var composing = false;

  function onKeyDown(e) {
    if (!input) return;
    /* 输入法兼容（第六篇 §8）：拼音还没上屏时回车是选词，不是发送 */
    if (e.isComposing || composing || e.keyCode === 229) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  /* ---------------- 重置（19.8） ---------------- */
  function resetConversation() {
    window.Aura.messages.clear();
    messages = [];
    transientImg = {};
    renderAll();
    bus.emit("messages:reset");
  }

  /* ---------------- 对外 ---------------- */
  /* ---------------- 她先说一句（首启 / 新话题都不空白） ---------------- */
  function openingLine(isFirst) {
    var st = engineState();
    var view = (st && window.AuraEngine) ? window.AuraEngine.publicView(st) : null;
    var h = new Date().getHours();
    var line;
    var state = view ? view.state : "calm";

    if (state === "serious" || state === "blank") {
      line = isFirst ? "来了。" : "又想换个话题啊。";
    } else if (state === "tired" || state === "low") {
      line = h < 6 || h >= 23 ? "这个点还没睡？我有点困了。" : "今天有点累，不太想多说。";
    } else if (state === "sulky") {
      line = "哦。";
    } else if (h < 6) {
      line = "还没睡？";
    } else if (h < 10) {
      line = "起这么早。";
    } else if (h < 18) {
      line = isFirst ? "在。" : "说吧。";
    } else {
      line = isFirst ? "来了。" : "今天怎么样。";
    }

    var aiMsg = { id: nowId(), role: "ai", content: line, ts: Date.now(), bubbleCount: 1 };
    messages.push(aiMsg);
    appendMessage(aiMsg, false);
    window.Aura.messages.save(messages);
    scrollToEnd(true);
    if (window.Aura.voice && window.Aura.voice.speak && S.getStr("aura_voice_autoread", "") === "1") {
      try { window.Aura.voice.speak(line, state); } catch (e) { /* ignore */ }
    }
    return line;
  }

  /* ---------------- 快捷回应（§3.4：宁可不出，不要常出） ---------------- */
  var quickEl = null;

  function clearQuickReplies() {
    if (quickEl && quickEl.parentNode) quickEl.parentNode.removeChild(quickEl);
    quickEl = null;
  }

  function maybeQuickReplies(aiText) {
    try {
      if (S.getStr("aura_quick_replies", "") === "0") return;
      if (turnCount > 3) return;                       /* 只在会话前 3 轮 */
      if (!/[?？]\s*$/.test(String(aiText).trim())) return;  /* 只在她刚问了问题之后 */
      clearQuickReplies();
      var wrap = document.createElement("div");
      wrap.className = "quick-replies";
      ["嗯", "怎么了", "不想说"].forEach(function (t) {
        var b = document.createElement("button");
        b.textContent = t;
        b.onclick = function () {
          clearQuickReplies();
          if (input) {
            input.value = t;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            send();                                   /* 点了直接发，不填进输入框 */
          }
        };
        wrap.appendChild(b);
      });
      if (log && log.parentNode) log.parentNode.insertBefore(wrap, log.nextSibling);
      quickEl = wrap;
    } catch (e) { /* ignore */ }
  }

  /* ---------------- L2 状态卡（轻点头像） ----------------
     §七 L2：固定三段 —— 状态词 → 具体原因 → 对你意味着什么。禁止百分比。 */
  function statusCard() {
    var st = engineState();
    if (!st || !window.AuraEngine) return;
    var view = window.AuraEngine.publicView(st);
    var wrap = document.createElement("div");
    wrap.className = "status-card";
    wrap.style.cssText = "font-size:15px;line-height:1.9;";
    var l1 = document.createElement("div");
    l1.style.cssText = "font-family:var(--serif,serif);font-size:19px;margin-bottom:6px;";
    l1.textContent = "她今天：" + view.word;
    var l2 = document.createElement("div");
    l2.style.cssText = "color:var(--dim,#6b665d);margin-bottom:8px;";
    l2.textContent = view.cause ? view.cause.detail : "没什么特别的。";
    var l3 = document.createElement("div");
    l3.textContent = view.meaning;
    wrap.appendChild(l1);
    wrap.appendChild(l2);
    wrap.appendChild(l3);
    if (view.repaired) {
      var l4 = document.createElement("div");
      l4.style.cssText = "margin-top:8px;color:var(--dim,#6b665d);font-size:13px;";
      l4.textContent = "（" + view.repaired + "）";
      wrap.appendChild(l4);
    }
    if (window.Aura.ui && window.Aura.ui.openModal) {
      window.Aura.ui.openModal("", { okText: "知道了", extraNode: wrap });
    }
  }

  /* ---------------- 记忆抽取（§九：每 6~8 轮，不阻塞首字） ---------------- */
  var turnCount = 0;
  var lastExtractAt = 0;

  function recordTurn() {
    turnCount += 1;
    if (!window.AuraMemfacts || !window.AuraPrompt) return;
    if (!window.AuraMemfacts.shouldExtract(turnCount, 7)) return;
    if (Date.now() - lastExtractAt < 60 * 1000) return;
    lastExtractAt = Date.now();
    extractMemories();
  }

  function extractMemories() {
    /* §1.4：没有 Key 也没有代理 → 这次不抽（静默跳过，不报错、不阻塞对话） */
    if (!hasChannel()) return;
    var recent = messages.slice(-14).map(function (m) {
      return (m.role === "me" ? "用户：" : "小纯：") + m.content;
    }).join("\n");
    if (!recent.trim()) return;
    var body = {
      system_prompt: window.AuraPrompt.EXTRACT_PROMPT,
      messages: [{ role: "user", content: recent }],
      temperature: 0,                                  /* §2.5：抽取要确定性 */
      max_tokens: 600,
      stream: false,                                   /* 抽取不流式（之前硬写成流式 → res.json() 必挂） */
      response_format: { type: "json_object" }         /* §2.5：强制 JSON 输出 */
    };

    function once() {
      if (hasChannel()) return directRequest(Object.assign({}, body));
      return Promise.reject(new Error("NO_CHANNEL"));
    }

    function contentOf(d) {
      return (d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || "";
    }

    once().then(function (res) {
      if (!res.ok) throw new Error("http" + res.status);
      return res.json();
    }).then(function (d) {
      var txt = contentOf(d);
      if (!txt || !txt.trim()) return Promise.reject(new Error("empty"));   /* 空 content → 重试一次 */
      return txt;
    }).catch(function () {
      /* §2.5：空 content / 失败 → 重试 1 次；再失败就放行（不弹窗、不阻塞对话） */
      return once().then(function (res) {
        return res.ok ? res.json() : null;
      }).then(function (d) {
        return contentOf(d);
      }).catch(function () { return ""; });
    }).then(function (txt) {
      if (!txt || !txt.trim()) return;                                      /* 放行成普通对话 */
      var items = window.AuraMemfacts.parseExtraction(txt);
      if (items.length) {
        window.AuraMemfacts.add(items);
        bus.emit("memory:added", items);
      }
    });
  }

  /* 第五篇 §10 / 第六篇 §10：长按发送键 → 她说最近一个未闭合话题 */
  function recallLast() {
    if (!window.AuraOpenLoop) return;
    if (input && input.value.trim()) return;      /* 输入框有内容就不抢 */
    var line = window.AuraOpenLoop.recall();
    var aiMsg = { id: nowId(), role: "ai", content: line, ts: Date.now(), bubbleCount: 1 };
    messages.push(aiMsg);
    appendMessage(aiMsg, false);
    window.Aura.messages.save(messages);
    scrollToEnd(true);
  }

  window.Aura.chat = {
    recallLast: recallLast,
    stopStreaming: stopStreaming,
    /* 任务书 §四/§七：给 app.js 用的引擎入口 */
    engineState: engineState,
    settleEngine: settleEngine,
    saveEngine: saveEngine,
    statusCard: statusCard,
    openingLine: openingLine,
    recordTurn: recordTurn,
    /* 切换到另一个会话（多会话功能由 features.js 调用） */
    loadSession: function (sid) {
      if (!sid) return;
      cfg.sessionId = sid;
      S.setStr(S.KEYS.sessionId, sid);
      messages = window.Aura.messages.load();
      renderAll();
      if (window.Aura.features && window.Aura.features.onSessionSwitch) {
        window.Aura.features.onSessionSwitch(sid);
      }
    },
    /* 重新渲染当前会话（外部改了消息后调用） */
    reload: function () {
      messages = window.Aura.messages.load();
      renderAll();
    },
    init: function () {
      log = document.getElementById("log");
      input = document.getElementById("input");
      sendBtn = document.getElementById("btn-send");

      messages = window.Aura.messages.load();
      renderAll();

      if (input) {
        input.addEventListener("input", autoGrow);
        input.addEventListener("keydown", onKeyDown);
    /* 输入法合成态（中文候选栏弹出/收起时，气泡区不跳、不误发） */
    input.addEventListener("compositionstart", function () { composing = true; });
    input.addEventListener("compositionend", function () { composing = false; });
      }
      if (sendBtn) sendBtn.addEventListener("click", send);

      var bImg = document.getElementById("btn-img");
      if (bImg) bImg.addEventListener("click", pickImage);

      var f = document.getElementById("file-attach");
      if (f) f.addEventListener("change", onFile);

      var c = document.getElementById("attach-cancel");
      if (c) c.addEventListener("click", function () { pendingImg = null; renderAttach(); });

      if (log) log.addEventListener("scroll", onScroll, { passive: true });

      autoGrow();
      ensureJumpBtn();

      /* 草稿恢复（23.3 d） */
      var draft = S.getStr(S.KEYS.draft, "");
      if (draft && input && !input.value) {
        input.value = draft;
        autoGrow();
      }
      input && input.addEventListener("input", function () {
        S.setStr(S.KEYS.draft, input.value);
      });
    },
    send: send,
    reset: resetConversation,
    renderAll: renderAll,
    getMessages: function () { return messages; },
    isBusy: function () { return busy; },
    focus: function () { if (input) input.focus(); }
  };
})();
