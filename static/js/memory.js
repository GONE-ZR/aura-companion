/* ============================================================
   memory.js —— 记忆系统（第 7 章）
   三层：固定层（人设+情绪行+长期记忆）→ 摘要层 → 近期层（最近 40 条原文）
   严禁把 base64 图片写进历史；严禁改写已发送过的内容（保前缀缓存）。
   ============================================================ */
(function () {
  "use strict";

  var S = window.Aura.store;
  var bus = window.Aura.bus;

  /* ---------------- tokens 粗估（7.6） ---------------- */
  function estimate(text) {
    if (!text) return 0;
    var s = String(text);
    var cn = (s.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
    var other = s.length - cn;
    var en = Math.ceil(other / 4);
    return Math.ceil((cn + en) * 1.15);
  }

  function estimateMessages(arr) {
    var total = 0;
    (arr || []).forEach(function (m) {
      if (typeof m.content === "string") total += estimate(m.content);
      else if (Array.isArray(m.content)) {
        m.content.forEach(function (b) {
          if (b && b.type === "text") total += estimate(b.text);
          else if (b && b.type === "image_url") total += 384;  /* 一张图最多 384 tokens */
        });
      }
    });
    return total;
  }

  /* ---------------- 读 / 写 ---------------- */
  function getSummary() { return S.getStr(S.KEYS.summary, "") || ""; }
  function setSummary(v) { S.setStr(S.KEYS.summary, v || ""); }
  function getLongTerm() { return S.getStr(S.KEYS.memory, "") || ""; }
  function setLongTerm(v) { S.setStr(S.KEYS.memory, String(v || "").slice(0, 400)); }

  /* ---------------- 摘要任务锁（7.7） ---------------- */
  var summarizing = false;

  function apiKeyHeader() {
    var k = window.Aura.cfg.apiKey || "";
    return k ? { "X-Aura-Key": k } : {};
  }

  function askModel(messages, maxTokens, systemText) {
    /* 直连模式：手机自己打 DeepSeek（没有服务器也能做摘要） */
    if (window.Aura.cfg.mode === "direct" && window.Aura.cfg.apiKey) {
      var msgs = [];
      if (systemText) msgs.push({ role: "system", content: systemText });
      messages.forEach(function (m) { msgs.push({ role: m.role, content: m.content }); });
      return fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + window.Aura.cfg.apiKey
        },
        body: JSON.stringify({
          model: "deepseek-flash",
          messages: msgs,
          max_tokens: maxTokens,
          temperature: 0.2,
          stream: false
        })
      }).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      }).then(function (d) {
        try { return (d.choices[0].message.content) || ""; } catch (e) { return ""; }
      });
    }

    return fetch("/api/chat", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, apiKeyHeader()),
      body: JSON.stringify({
        messages: messages,
        system_prompt: systemText,
        max_tokens: maxTokens,
        temperature: 0.2
      })
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    }).then(function (d) {
      return (d && d.reply) || "";
    });
  }

  /* ---------------- 触发摘要（7.4） ---------------- */
  var MAX_UNSUMMARIZED = 40;
  var MAX_TOKENS_UNSUMMARIZED = 60000;
  var CHUNK = 20;   /* 一次压缩最旧的 20 条 */

  function maybeSummarize(messages, onDone) {
    if (summarizing) return false;
    var count = messages.length;
    var toks = estimateMessages(messages);
    if (count <= MAX_UNSUMMARIZED && toks <= MAX_TOKENS_UNSUMMARIZED) return false;

    summarizing = true;
    var chunk = messages.slice(0, CHUNK);
    var rest = messages.slice(CHUNK);

    var payload = chunk.map(function (m) {
      return { role: m.role, content: m.content };
    });

    /* max_tokens 给足：deepseek-flash 是推理模型，先要吐一段思维链，
       预算太小的话全被思维链吃光，正文一个字都剩不下。 */
    askModel(payload, 800, "提炼事实，不评价，不寒暄。")
      .then(function (text) {
        if (!text) throw new Error("empty summary");
        var old = getLongTerm();
        var merged = (old ? old + "\n" : "") + text.trim();
        setLongTerm(merged);
        setSummary((getSummary() ? getSummary() + "\n" : "") + text.trim());
        /* 丢掉被压缩掉的原文 */
        onDone(rest);
      })
      .catch(function () {
        /* 失败保留原文，下次再试，不影响本轮 */
        onDone(messages);
      })
      .then(function () {
        summarizing = false;
      });
    return true;
  }

  /* ---------------- 组装 system 的记忆部分 ---------------- */
  function memoryBlock() {
    var mem = getLongTerm();
    if (!mem) return "";
    return "\n\n【关于我的长期记忆】\n" + mem;
  }

  function summaryBlock() {
    var s = getSummary();
    if (!s) return "";
    return "\n\n【更早对话的要点】\n" + s;
  }

  /* ---------------- 对外 ---------------- */
  window.Aura.memory = {
    estimate: estimate,
    estimateMessages: estimateMessages,
    getSummary: getSummary,
    setSummary: setSummary,
    getLongTerm: getLongTerm,
    setLongTerm: setLongTerm,
    memoryBlock: memoryBlock,
    summaryBlock: summaryBlock,
    maybeSummarize: maybeSummarize,
    isSummarizing: function () { return summarizing; },
    /* 抽屉里显示用 */
    stat: function (messages) {
      var arr = messages || window.Aura.messages.load();
      return {
        count: arr.length,
        approx: estimateMessages(arr),
        summary: getSummary(),
        memory: getLongTerm()
      };
    },
    /* 触发摘要（供设置里手动调用） */
    force: function (messages, onDone) {
      summarizing = false;
      return maybeSummarize(messages, onDone);
    }
  };
})();
