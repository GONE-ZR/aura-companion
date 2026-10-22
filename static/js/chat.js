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

  function bubbleFor(msg) {
    var wrap = el("div", "msg " + (msg.role === "me" ? "me" : "ai"));
    var b = el("div", "bubble");
    var body = el("div", "bubble-text");
    body.textContent = msg.content || "";
    b.appendChild(body);
    wrap.appendChild(b);

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
    messages.forEach(function (m) { log.appendChild(bubbleFor(m)); });
    scrollToEnd(true);
  }

  function appendMessage(msg, animate) {
    if (!log) return;
    if (log.querySelector(".empty-state")) log.textContent = "";
    var node = bubbleFor(msg);
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
    return cfg.mode === "direct" && !!cfg.apiKey;
  }

  function buildPayload(userText, images) {
    var msgs = messages.map(function (m) {
      return { role: m.role === "me" ? "user" : "assistant", content: m.content };
    });
    if (images && images.length) {
      var last = msgs.pop();
      msgs.push({ role: "user", content: userText });
    }
    return {
      system_prompt: buildSystem(),
      messages: msgs,
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

  function buildDirectPayload(payload) {
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
    return {
      model: DS_MODEL,
      messages: msgs,
      temperature: payload.temperature,
      max_tokens: payload.max_tokens,
      stream: true
    };
  }

  function directRequest(payload) {
    return fetch(DS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + cfg.apiKey
      },
      body: JSON.stringify(buildDirectPayload(payload))
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

    /* 发送锁：防连点（第 19.3） */
    setBusy(true);

    var userText = text || "给你看一张图";
    lastUserText = userText;

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

  function streamReply(meMsg, meNode, aiMsg, node, body, bubble, think, dots, userText, images, emo) {
    var payload = buildPayload(userText, images);
    var controller = ("AbortController" in window) ? new AbortController() : null;

    var req = isDirect()
      ? directRequest(payload).then(function (res) {
          /* 直连模式没有本地服务器做图片块转换，这里自己补一次 */
          return res;
        })
      : fetch("/api/chat/stream", {
          method: "POST",
          headers: apiHeaders(),
          body: JSON.stringify(payload),
          signal: controller ? controller.signal : undefined
        });

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
      var text = "";
      var got = false;

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
            text += delta;
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
      /* 这一条是带着什么情绪说的 —— 气泡会跟着变（生气/高兴/兴奋…） */
      if (window.Aura.expr) {
        try {
          bubble.setAttribute("data-face", window.Aura.expr.faceFor(emo.type, emo.intensity));
        } catch (e) { /* ignore */ }
      }
      messages.push(aiMsg);
      window.Aura.messages.save(messages);
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
  function onKeyDown(e) {
    if (!input) return;
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
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
  window.Aura.chat = {
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
