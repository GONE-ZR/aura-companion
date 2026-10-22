/* ============================================================
   voice.js —— 语音播报（规格 13 章）+ 语音输入（规格 14 章）
   ------------------------------------------------------------
   能力诚实（13.1）：
     edge-tts 只有 rate / pitch / volume 三个参数，没有真正的情绪风格。
     所以「带着情绪念出来」只做三层近似：
       1) 换音色（最有效）  2) 调 rate/pitch/volume  3) 文本断句停顿
     呼吸声、气声、笑声、哽咽一律做不到，也不假装做。
   ============================================================ */
(function () {
  "use strict";

  var A = window.Aura = window.Aura || {};

  /* ---------- 常量 ---------- */
  var AUTO_READ_KEY = "aura_voice_autoread";        /* 自动朗读开关（存储契约里没有，单独存） */
  var NIGHT_NOTICE_KEY = "aura_voice_night_notice"; /* 夜间提示，一天只弹一次 */
  var PREVIEW_TEXT = "我在，你慢慢说。";              /* 13.10 试听固定句 */
  var RATE_MIN = 0.75, RATE_MAX = 1.15;             /* 13.3 rate 硬钳制 */
  var PITCH_MIN = -12, PITCH_MAX = 12;              /* 13.3 pitch 硬钳制 */
  var NIGHT_RATE = 0.88;                            /* 13.11 夜间自动语速 */
  var NIGHT_VOL_CAP = 0.7;                          /* 13.11 夜间音量上限 */
  var NIGHT_RATE_FACTOR = 0.9;                      /* 13.3 夜间整体再乘 0.9 */
  var SYNTH_FALLBACK_RATE = 0.9;                    /* 13.12 回落语速 0.9 */
  var ELL_PAUSE_MIN = 250, ELL_PAUSE_MAX = 300;     /* 13.4 「……」段间停顿 */
  var GAP_MIN = 200, GAP_MAX = 400;                 /* 13.9 段间呼吸 */
  var LOW_GAP = 500;                                /* 13.9 低落时 500ms */
  var MAX_SENT_PER_SEG = 3;                         /* 13.5 每段 1–3 句 */
  var MAX_SEG_CHARS = 60;

  /* 展示顺序按规格 13.2 的表格顺序，比 EMOTIONS 的内部顺序更贴近用户直觉 */
  var DISPLAY_ORDER = ["calm", "tender", "low", "stifled", "happy", "curious", "jealous", "angry"];

  /* ---------- 运行时状态 ---------- */
  var curEmotion = "calm";      /* 当前这一轮的情绪（face:change 驱动） */
  var speaking = false;        /* 正在朗读 */
  var recognizing = false;      /* 正在识别 */
  var audioEl = null;          /* 共用的播放器 */
  var cache = {};              /* TTS blob URL 缓存：key -> url */
  var cancelToken = 0;         /* 打断令牌 */
  var pendingTimer = null;     /* 段间停顿的定时器 */
  var unlocked = false;        /* 音频是否已解锁 */
  var unlockTried = false;
  var personaStamp = "";       /* 用于检测「切人设」→ 清缓存 */
  var lastErrToast = "";       /* 同一错误不重复提示 */
  var micEl = null;
  /* 「用户手动点了朗读」标记：chat.js 的小喇叭先调 stop() 再调 speak()，
     这里用 stop() 打标记，让这次 speak() 绕开「自动朗读」与「过短不读」两道闸，
     这样关掉自动朗读之后点小喇叭仍然读得出来（规格 25 章清单：2601 行）。 */
  var manualHint = false;
  var manualHintAt = 0;

  /* ============================================================
     基础工具
     ============================================================ */
  function clamp(v, a, b) {
    if (A.util && typeof A.util.clamp === "function") return A.util.clamp(v, a, b);
    return Math.min(b, Math.max(a, v));
  }
  function byId(id) { return document.getElementById(id); }
  function clearNode(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }
  function emit(evt, data) {
    try { if (A.bus && typeof A.bus.emit === "function") A.bus.emit(evt, data); } catch (e) { /* ignore */ }
  }
  function toast(msg, ms) {
    var el = byId("toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    try { el.classList.add("show"); } catch (e) { /* ignore */ }
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.hidden = true;
      try { el.classList.remove("show"); } catch (e) { /* ignore */ }
    }, ms || 2800);
  }
  var toastTimer = null;

  function storeGet(key, fallback) {
    try {
      if (A.store && typeof A.store.getStr === "function") {
        var v = A.store.getStr(key, fallback);
        return (v === null || v === undefined) ? fallback : v;
      }
      var s = localStorage.getItem(key);
      return (s === null || s === undefined) ? fallback : s;
    } catch (e) { return fallback; }
  }
  function storeSet(key, val) {
    try {
      if (A.store && typeof A.store.setStr === "function") return A.store.setStr(key, val);
      localStorage.setItem(key, String(val));
      return true;
    } catch (e) { return false; }
  }

  /* ============================================================
     配置读取（全部动态读 A.cfg，方便 loadAll() 之后再取）
     ============================================================ */
  function vcfg() {
    var c = (A.cfg && A.cfg.voice) ? A.cfg.voice : null;
    if (!c) {
      c = { base: "zh-CN-XiaoxiaoNeural", rate: 0.95, vol: 1, rateTouched: false, auto: true, map: null };
    }
    return c;
  }
  function saveVoice(patch) {
    try { if (A.save && A.save.voice) A.save.voice(patch); } catch (e) { /* ignore */ }
  }
  function faceLevel() {
    var lv = (A.cfg && A.cfg.faceLevel) || "normal";
    var t = (A.FACE_LEVELS && A.FACE_LEVELS[lv]) ? A.FACE_LEVELS[lv] : { mul: 0.6 };
    return t;
  }
  function isCalmLevel() { return faceLevel().mul === 0; }   /* 情绪鲜明度=平静 → 系数 0 */
  function isNight() {
    var h = new Date().getHours();
    return h >= 22 || h < 6;                               /* 22:00–06:00 */
  }
  function emotionList() {
    var all = (A.EMOTIONS && A.EMOTIONS.length) ? A.EMOTIONS : DISPLAY_ORDER;
    var out = [], i;
    for (i = 0; i < DISPLAY_ORDER.length; i++) {
      if (all.indexOf(DISPLAY_ORDER[i]) >= 0) out.push(DISPLAY_ORDER[i]);
    }
    for (i = 0; i < all.length; i++) {
      if (out.indexOf(all[i]) < 0) out.push(all[i]);
    }
    return out;
  }
  function labelOf(key) {
    return (A.EMOTION_LABEL && A.EMOTION_LABEL[key]) ? A.EMOTION_LABEL[key] : key;
  }
  function voiceIds() {
    var out = {};
    var vs = A.VOICES || [];
    for (var i = 0; i < vs.length; i++) out[vs[i].id] = true;
    return out;
  }
  function isValidVoice(id) { return !!voiceIds()[id]; }
  function baseVoice() {
    var b = vcfg().base;
    return isValidVoice(b) ? b : "zh-CN-XiaoxiaoNeural";
  }
  /* 情绪偏移（平静档一律为 0） */
  function offsetsOf(em) {
    var t = (A.EMOTION_TTS && A.EMOTION_TTS[em]) ? A.EMOTION_TTS[em] : { rate: 0, pitch: 0, vol: 1 };
    if (isCalmLevel()) return { rate: 0, pitch: 0, vol: 1 };
    return t;
  }
  function normEmotion(em) {
    if (em && A.EMOTION_TTS && A.EMOTION_TTS[em]) return em;
    if (curEmotion && A.EMOTION_TTS && A.EMOTION_TTS[curEmotion]) return curEmotion;
    return "calm";
  }

  /* ============================================================
     参数换算（13.2 / 13.3 / 13.11）
     ============================================================ */
  function pctOf(x) {
    if (Math.abs(x) < 0.0005) return "+0%";
    var v = Math.round(Math.abs(x) * 100);
    return (x >= 0 ? "+" : "-") + v + "%";
  }
  function parseNum(s) {
    var m = /([+-]?\d+(?:\.\d+)?)/.exec(String(s || ""));
    return m ? parseFloat(m[1]) : 0;
  }

  /* 音色：开关关 → 全用基准；开关开 → 查表；表里失效音色回落基准并提示一次 */
  function resolveVoice(em) {
    var cfg = vcfg();
    var base = baseVoice();
    if (!cfg.auto) return base;
    var map = cfg.map || {};
    var v = map[em] || (A.DEFAULT_VOICE_MAP ? A.DEFAULT_VOICE_MAP[em] : "");
    if (!v || v === "__base__") return base;
    if (!isValidVoice(v)) {
      noteBadVoice(v);
      return base;
    }
    return v;
  }
  function noteBadVoice(v) {
    var key = "voice:" + v;
    if (lastErrToast === key) return;
    lastErrToast = key;
    toast("某个音色已不可用，已换成默认。");
  }

  /* 返回 {voice, rate:'+0%', pitch:'+0Hz', volume:'+0%'} */
  function buildTtsParams(emotion) {
    var cfg = vcfg();
    var em = normEmotion(emotion);
    var off = offsetsOf(em);
    var night = isNight();

    /* 基准语速：夜间且用户没手动改过 → 0.88（13.11） */
    var userRate = (cfg.rate && cfg.rate > 0) ? cfg.rate : 0.95;
    var baseRate = userRate;
    if (night && !cfg.rateTouched) baseRate = NIGHT_RATE;

    /* rate：相对偏移 → 夜间再乘 0.9 → 硬钳制 0.75–1.15 */
    var rate = baseRate * (1 + off.rate);
    if (night) rate *= NIGHT_RATE_FACTOR;
    rate = clamp(rate, RATE_MIN, RATE_MAX);

    /* pitch：夜间偏移减半 → 硬钳制 ±12Hz */
    var pitch = off.pitch;
    if (night) pitch = pitch / 2;
    pitch = clamp(pitch, PITCH_MIN, PITCH_MAX);

    /* volume */
    var userVol = (cfg.vol && cfg.vol > 0) ? cfg.vol : 1;
    var vol = userVol * (off.vol === undefined ? 1 : off.vol);
    if (em === "angry") {                       /* 生气禁止提高音量和音高 */
      vol = Math.min(vol, userVol);
      pitch = Math.min(pitch, 0);
    }
    if (em === "low" || em === "stifled") {     /* 低落与闷不低于用户值的 60% */
      vol = Math.max(vol, userVol * 0.6);
    }
    if (night && !cfg.rateTouched) vol = Math.min(vol, NIGHT_VOL_CAP);
    vol = clamp(vol, 0, 1);

    return {
      voice: resolveVoice(em),
      rate: pctOf(rate - 1),
      pitch: (pitch >= 0 ? "+" : "") + Math.round(pitch) + "Hz",
      volume: pctOf(vol - 1)
    };
  }

  /* ============================================================
     文本清洗与断句（13.4 / 13.5）
     ============================================================ */
  function cleanText(raw) {
    var t = String(raw === null || raw === undefined ? "" : raw);

    /* ① 去掉括号内容（含中英文、方头括号）—— 舞台提示不要读出来 */
    t = t.replace(/（[^（）]*）/g, "");
    t = t.replace(/\([^()]*\)/g, "");
    t = t.replace(/【[^【】]*】/g, "");
    t = t.replace(/\[[^\[\]]*\]/g, "");

    /* ② 去掉 markdown 符号 */
    t = t.replace(/```[\s\S]*?```/g, "");
    t = t.replace(/`([^`]*)`/g, "$1");
    t = t.replace(/\*\*\*([\s\S]*?)\*\*\*/g, "$1");
    t = t.replace(/\*\*([\s\S]*?)\*\*/g, "$1");
    t = t.replace(/\*([^*\n]*)\*/g, "$1");
    t = t.replace(/__([^_]*)__/g, "$1");
    t = t.replace(/~~([^~]*)~~/g, "$1");
    t = t.replace(/^\s{0,3}#{1,6}\s+/gm, "");
    t = t.replace(/^\s{0,3}>\s?/gm, "");
    t = t.replace(/^\s*[-*+]\s+/gm, "");
    t = t.replace(/^\s*\d+[.、)]\s+/gm, "");
    t = t.replace(/^[ \t]*([-*_])[ \t]*(\1[ \t]*){2,}$/gm, "");

    /* ③ 连续标点压成一个（「……」不压，后面单独处理） */
    t = t.replace(/([，。！？；：、,.!?;:])\1+/g, "$1");
    t = t.replace(/[ \t]{2,}/g, " ");
    t = t.replace(/\n{2,}/g, "\n");
    return t.replace(/\s+$/g, "").replace(/^\s+/g, "");
  }

  function splitSentences(s) {
    var out = [], buf = "";
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      buf += ch;
      if ("。！？!?\n".indexOf(ch) >= 0) {
        while (i + 1 < s.length && "。！？!?\n，,、".indexOf(s.charAt(i + 1)) >= 0) {
          buf += s.charAt(i + 1); i++;
        }
        out.push(buf); buf = "";
      }
    }
    if (buf.replace(/\s/g, "")) out.push(buf);
    var res = [];
    for (var j = 0; j < out.length; j++) {
      var t = out[j].replace(/\s+/g, " ").trim();
      if (t) res.push(t);
    }
    return res;
  }
  function groupSentences(sents) {
    var segs = [], cur = [], len = 0;
    for (var i = 0; i < sents.length; i++) {
      var s = sents[i];
      if (cur.length >= MAX_SENT_PER_SEG || (cur.length >= 1 && len + s.length > MAX_SEG_CHARS)) {
        segs.push(cur.join("")); cur = []; len = 0;
      }
      cur.push(s); len += s.length;
    }
    if (cur.length) segs.push(cur.join(""));
    return segs;
  }
  function rnd(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  /* 返回 [{text, pauseAfter}]，pauseAfter 是这一段之后的停顿毫秒数 */
  function splitForSpeech(text, emotion) {
    var t = cleanText(text);
    if (!t) return [];

    var low = (normEmotion(emotion) === "low");
    var pieces = t.split(/(…{1,}|\.{3,})/);   /* 先在「……」处切开 */

    var segs = [];
    var ellPending = false;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!p) continue;
      if (/^(…{1,}|\.{3,})$/.test(p)) { ellPending = true; continue; }
      var blocks = groupSentences(splitSentences(p));
      for (var j = 0; j < blocks.length; j++) {
        segs.push({ text: blocks[j], pauseAfter: 0, breakBefore: (j === 0) ? (ellPending ? "ell" : "gap") : "none" });
      }
      ellPending = false;
    }
    /* 段间停顿：省略号处 250–300ms；普通换段 200–400ms，低落 500ms
       —— 停顿长度由「下一段前面是什么断点」决定 */
    for (var k = 0; k < segs.length; k++) {
      if (k === segs.length - 1) { segs[k].pauseAfter = 0; continue; }
      if (segs[k + 1].breakBefore === "ell") {
        segs[k].pauseAfter = rnd(ELL_PAUSE_MIN, ELL_PAUSE_MAX);
      } else {
        segs[k].pauseAfter = low ? LOW_GAP : rnd(GAP_MIN, GAP_MAX);
      }
    }
    for (var m = 0; m < segs.length; m++) delete segs[m].breakBefore;
    return segs;
  }

  /* 「嗯。」「……」「那。」这类没有实义内容的短句不自动朗读（13.8） */
  var FILLER_RE = /^(?:嗯|哦|啊|唉|欸|唔|呵|哈|噢|喔|诶|额|那|吧|呀|呢|在|的|是|对|不|没|好|行|呗|啦)+$/;
  function isTrivial(text) {
    var core = String(text).replace(/[\s，。！？、；：…,.!?;:'"“”‘’（）()]/g, "");
    if (!core) return true;
    if (core.length > 4) return false;
    return FILLER_RE.test(core);
  }

  /* ============================================================
     缓存与播放器
     ============================================================ */
  function hashKey(s) {
    var h = 5381, i = s.length;
    while (i) { h = ((h * 33) ^ s.charCodeAt(--i)) >>> 0; }
    return h.toString(36);
  }
  function cacheKey(text, params) {
    return hashKey([params.voice, params.rate, params.pitch, params.volume, text].join("|"));
  }
  function clearCache() {
    for (var k in cache) {
      if (Object.prototype.hasOwnProperty.call(cache, k)) {
        try { URL.revokeObjectURL(cache[k]); } catch (e) { /* ignore */ }
      }
    }
    cache = {};
  }
  function getAudio() {
    if (!audioEl) {
      try { audioEl = new Audio(); } catch (e) { audioEl = null; }
      if (audioEl) { audioEl.preload = "auto"; }
    }
    return audioEl;
  }
  function playUrl(url) {
    return new Promise(function (resolve, reject) {
      var a = getAudio();
      if (!a) { reject(new Error("no audio element")); return; }
      var done = false;
      function onEnd() { if (done) return; done = true; cleanup(); resolve(true); }
      function onErr() { if (done) return; done = true; cleanup(); reject(new Error("playback failed")); }
      function cleanup() {
        a.removeEventListener("ended", onEnd);
        a.removeEventListener("error", onErr);
      }
      a.addEventListener("ended", onEnd);
      a.addEventListener("error", onErr);
      try { a.pause(); a.src = url; } catch (e) { /* ignore */ }
      var p = null;
      try { p = a.play(); } catch (e) { onErr(); return; }
      if (p && typeof p.catch === "function") {
        p.catch(function (err) { if (!done) { done = true; cleanup(); reject(err); } });
      }
    });
  }

  /* ============================================================
     音频解锁（13.7）
     ============================================================ */
  var SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=";
  function unlock() {
    if (unlocked) return true;
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        var ctx = new Ctx();
        if (ctx.state === "suspended" && typeof ctx.resume === "function") {
          var rp = ctx.resume();
          if (rp && typeof rp.catch === "function") rp.catch(function () { /* ignore */ });
        }
        unlocked = true;
        unlockTried = true;
        return true;
      }
    } catch (e) { /* ignore */ }
    try {
      var a = document.createElement("audio");
      a.muted = true;
      a.volume = 0;
      a.src = SILENT_WAV;
      var p = a.play();
      if (p && typeof p.then === "function") {
        p.then(function () { unlocked = true; }, function () { /* ignore */ });
      }
      unlockTried = true;
      return true;
    } catch (e) {
      unlockTried = true;
      return false;
    }
  }

  /* 被浏览器拦下：不报错，改成「点一下听」 */
  function onBlocked(text) {
    unlocked = false;
    if (lastErrToast === "blocked") return;
    lastErrToast = "blocked";
    toast("点一下听。");
    emit("voice:blocked", { text: String(text || "") });
  }

  /* ============================================================
     取音频（网页/PWA → /api/tts；Electron → 桌面桥 → /api/tts → speechSynthesis）
     ============================================================ */
  function isElectron() {
    return !!(window.auraDesktop && typeof window.auraDesktop.tts === "function");
  }
  function httpTts(text, params) {
    if (navigator.onLine === false) {
      var e = new Error("offline");
      e.offline = true;
      return Promise.reject(e);
    }
    var key = cacheKey(text, params);
    if (cache[key]) return Promise.resolve({ url: cache[key] });
    return fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: text,
        voice: params.voice,
        rate: params.rate,
        pitch: params.pitch,
        volume: params.volume
      })
    }).then(function (res) {
      if (!res.ok) throw new Error("tts http " + res.status);
      return res.blob();
    }).then(function (blob) {
      var url = URL.createObjectURL(blob);
      cache[key] = url;
      return { url: url };
    });
  }
  function desktopTts(text, params) {
    var bridge = window.auraDesktop;
    if (!bridge || typeof bridge.tts !== "function") return Promise.reject(new Error("no desktop bridge"));
    return Promise.resolve(bridge.tts(text, {
      voice: params.voice,
      rate: params.rate,
      pitch: params.pitch,
      volume: params.volume
    })).then(function (r) {
      if (r && r.ok === false) throw new Error("desktop tts failed");
      if (r === undefined || r === null) return { done: true };  /* 桥自己播了 */
      if (typeof r === "string") {
        return { url: (r.indexOf("data:") === 0) ? r : ("data:audio/mpeg;base64," + r) };
      }
      if (typeof Blob !== "undefined" && r instanceof Blob) return { url: URL.createObjectURL(r) };
      if (typeof ArrayBuffer !== "undefined" && r instanceof ArrayBuffer) {
        return { url: URL.createObjectURL(new Blob([r], { type: "audio/mpeg" })) };
      }
      if (r && typeof r === "object" && (r.url || r.audioUrl)) return { url: r.url || r.audioUrl };
      return { done: true };
    });
  }
  function ensureAudio(text, params) {
    /* 直连模式：没有服务器就没有 edge-tts，直接用系统语音（本地合成，零延迟） */
    if (window.Aura && window.Aura.cfg && window.Aura.cfg.mode === "direct") {
      return Promise.reject(new Error("direct-mode"));
    }
    if (isElectron()) {
      return desktopTts(text, params).catch(function () { return httpTts(text, params); });
    }
    return httpTts(text, params);
  }

  /* speechSynthesis 回落（13.12）
     升级：排除 compact / eloquence 这类劣质引擎，优先在线自然音色 */
  var BAD_SYNTH = /(compact|eloquence|novelty|albert|bad news|bells|boing|bubbles|cellos|jester|organ|superstar|trinoids|whisper|zarvox)/i;
  var GOOD_SYNTH = /(natural|neural|online|premium|enhanced|xiaoxiao|xiaoyi|xiaobei|xiaoni|huihui|yaoyao|tingting|google)/i;
  var FEMALE_SYNTH = /(xiaoxiao|xiaoyi|xiaobei|xiaoni|xiaomeng|xiaomo|xiaoxuan|tingting|huihui|yaoyao|female|女|google 普通话)/i;

  function synthScore(v) {
    var n = (v.name || "") + " " + (v.voiceURI || "");
    var s = 0;
    if (BAD_SYNTH.test(n)) s -= 100;
    if (GOOD_SYNTH.test(n)) s += 30;
    if (FEMALE_SYNTH.test(n)) s += 20;
    if (/^zh[-_]cn/i.test(v.lang || "")) s += 12;
    else if (/^zh/i.test(v.lang || "")) s += 5;
    if (v.localService === false) s += 8;   /* 在线音色通常更自然 */
    return s;
  }

  function pickVoice(voices) {
    var zh = [], i, v;
    for (i = 0; i < voices.length; i++) {
      v = voices[i];
      if (v && v.lang && /^zh/i.test(v.lang)) zh.push(v);
    }
    if (!zh.length) return null;
    /* 用户手动选过的优先 */
    var picked = (A.cfg && A.cfg.voice && A.cfg.voice.nativeVoice) || "";
    if (picked) {
      for (i = 0; i < zh.length; i++) {
        if ((zh[i].voiceURI === picked) || (zh[i].name === picked)) return zh[i];
      }
    }
    zh.sort(function (a, b) { return synthScore(b) - synthScore(a); });
    return zh[0];
  }
  function speakViaSynthesis(text, params, em) {
    return new Promise(function (resolve, reject) {
      if (!window.speechSynthesis) { reject(new Error("no speechSynthesis")); return; }
      var u = new window.SpeechSynthesisUtterance(text);
      var voices = window.speechSynthesis.getVoices ? window.speechSynthesis.getVoices() : [];
      var v = pickVoice(voices || []);
      if (v) u.voice = v;
      u.lang = "zh-CN";
      var cfg = vcfg();
      var base = cfg.rateTouched ? (cfg.rate || SYNTH_FALLBACK_RATE) : SYNTH_FALLBACK_RATE;
      var off = offsetsOf(em);
      u.rate = clamp(base * (1 + off.rate), 0.5, 2);
      u.pitch = clamp(1 + parseNum(params.pitch) / 24, 0, 2);
      u.volume = clamp(1 + parseNum(params.volume) / 100, 0, 1);
      var done = false;
      u.onend = function () { if (!done) { done = true; resolve(true); } };
      u.onerror = function (e) { if (!done) { done = true; reject(e || new Error("synthesis error")); } };
      try { window.speechSynthesis.speak(u); } catch (e) { if (!done) { done = true; reject(e); } }
    });
  }

  /* ============================================================
     朗读主流程
     ============================================================ */
  function checkPersona() {
    var p = (A.cfg && A.cfg.persona) ? A.cfg.persona : null;
    var stamp = p ? String(p.id || p.text || "").slice(0, 64) : "";
    if (stamp !== personaStamp) { personaStamp = stamp; clearCache(); }
  }

  function wait(ms, token) {
    if (!ms) return Promise.resolve(true);
    return new Promise(function (resolve) {
      pendingTimer = setTimeout(function () {
        pendingTimer = null;
        resolve(token === cancelToken);
      }, ms);
    });
  }

  function playSegments(segs, params, em, token) {
    var idx = 0;
    function next() {
      if (token !== cancelToken) return Promise.resolve(false);
      if (idx >= segs.length) return Promise.resolve(true);
      var seg = segs[idx++];
      return playSegment(seg.text, params, em).then(function () {
        return wait(seg.pauseAfter, token);
      }).then(function (ok) {
        if (ok === false) return false;
        return next();
      });
    }
    return next();
  }

  /* 安卓原生 TTS（APK 里 WebView 没有 speechSynthesis，必须走这个） */
  function nativeTtsPlugin() {
    return (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.AuraTts) || null;
  }

  /* 把 "+4%" / "-4Hz" 折算成安卓要的倍率 */
  function nativeParams(params) {
    var rate = 1.0, pitch = 1.0;
    var r = String(params.rate || "+0%");
    var p = String(params.pitch || "+0Hz");
    var m = r.match(/([+-]?\d+(?:\.\d+)?)%/);
    if (m) rate = 0.95 * (1 + parseFloat(m[1]) / 100);
    var m2 = p.match(/([+-]?\d+(?:\.\d+)?)Hz/);
    /* 系统 TTS 对音高敏感：偏移量打 2.5 折再交给原生侧（原生侧还会再压一次） */
    if (m2) pitch = 1 + (parseFloat(m2[1]) / 50) * 0.25;
    return { rate: rate, pitch: pitch };
  }

  /* 手机自带的音色列表（APK 专用） */
  var nativeVoicesCache = null;
  function listNativeVoices() {
    var plugin = nativeTtsPlugin();
    if (!plugin || typeof plugin.listVoices !== "function") return Promise.resolve([]);
    if (nativeVoicesCache) return Promise.resolve(nativeVoicesCache);
    return plugin.listVoices().then(function (res) {
      var voices = (res && res.voices) || [];
      /* 按分数排序：神经网络/高品质 → 中文女声优先 */
      voices.sort(function (a, b) {
        return (b.score || 0) - (a.score || 0);
      });
      nativeVoicesCache = voices;
      return voices;
    }).catch(function () { return []; });
  }

  function getNativeVoice() {
    return (A.cfg && A.cfg.voice && A.cfg.voice.nativeVoice) || "";
  }

  function setNativeVoice(id) {
    if (A.save && A.save.voice) A.save.voice({ nativeVoice: id || "" });
  }

  /* 自动挑一个最好听的（首次没有手动选择时用） */
  function autoPickNativeVoice() {
    return listNativeVoices().then(function (voices) {
      if (!voices.length) return "";
      var cur = getNativeVoice();
      if (cur) {
        for (var i = 0; i < voices.length; i++) {
          if ((voices[i].engine + "::" + voices[i].id) === cur) return cur;
        }
      }
      var FEMALE = /(晓晓|晓伊|晓妮|晓北|慧慧|瑶瑶|婷婷|婉|xiaoxiao|xiaoyi|xiaoni|huihui|yaoyao|tingting|female)/i;
      var MALE = /(云希|云健|云扬|康康|yunxi|yunjian|yunyang|kangkang|male)/i;
      var best = null, bestScore = -1e9;
      voices.forEach(function (v) {
        if (!/^zh/i.test(v.lang || "")) return;
        var s = v.score || 0;
        var name = (v.label || "") + " " + (v.id || "");
        if (FEMALE.test(name)) s += 15;
        if (MALE.test(name)) s -= 10;      /* 默认要女声，但不彻底排除 */
        if (/^zh[-_]cn/i.test(v.lang)) s += 8;
        if (s > bestScore) { bestScore = s; best = v; }
      });
      if (!best) return "";
      var id = best.engine + "::" + best.id;
      setNativeVoice(id);
      return id;
    });
  }

  function nativeSpeak(text, params) {
    var plugin = nativeTtsPlugin();
    if (!plugin) return Promise.reject(new Error("no native tts"));
    return autoPickNativeVoice().then(function (voiceId) {
      return new Promise(function (resolve, reject) {
        var id = null;
        var listener = null;
        var timer = null;
        function cleanup() {
          try { if (listener) listener.remove(); } catch (e) { }
          if (timer) clearTimeout(timer);
        }
        try {
          listener = plugin.addListener("ttsDone", function (ev) {
            if (!id || !ev || !ev.id || ev.id === id) { cleanup(); resolve({ done: true }); }
          });
        } catch (e) { /* ignore */ }
        plugin.speak(Object.assign({ text: text, voiceId: voiceId || "" }, nativeParams(params)))
          .then(function (res) {
            id = res && res.id;
            /* 兜底：万一没有回调，30 秒后也算完成 */
            timer = setTimeout(function () { cleanup(); resolve({ done: true }); }, 30000);
          })
          .catch(function (err) { cleanup(); reject(err); });
      });
    });
  }

  function playSegment(text, params, em) {
    /* APK：优先原生系统 TTS（离线、零延迟、有中文女声） */
    if (nativeTtsPlugin()) {
      return nativeSpeak(text, params).catch(function (err) {
        if (window.speechSynthesis) {
          return speakViaSynthesis(text, params, em).catch(function () { throw err; });
        }
        throw err;
      });
    }
    return ensureAudio(text, params).then(function (res) {
      if (res && res.done) return true;
      if (!res || !res.url) throw new Error("no audio");
      return playUrl(res.url);
    }).catch(function (err) {
      /* Electron / 直连模式 回落 speechSynthesis；其它形态直接失败 */
      if ((isElectron() || (window.Aura && window.Aura.cfg && window.Aura.cfg.mode === "direct"))
          && window.speechSynthesis) {
        return speakViaSynthesis(text, params, em).catch(function () { throw err; });
      }
      throw err;
    });
  }

  function speakInternal(text, em, forceVoice) {
    checkPersona();
    var params = buildTtsParams(em);
    if (forceVoice) params.voice = forceVoice;
    var segs = splitForSpeech(text, em);
    if (!segs.length) return Promise.resolve(false);

    var token = ++cancelToken;
    speaking = true;
    return playSegments(segs, params, em, token).then(function (ok) {
      if (token === cancelToken) speaking = false;
      emit("voice:done", { text: text });
      return ok;
    }, function (err) {
      speaking = false;
      if (err && err.name === "NotAllowedError") {
        onBlocked(text);
      } else {
        noteTtsError(err);
      }
      return false;
    });
  }

  function noteTtsError(err) {
    var msg;
    if (err && err.offline) msg = "现在没有网络，读不出来。";
    else msg = "这次没读出来，先看文字吧。";
    if (lastErrToast === msg) return;
    lastErrToast = msg;
    toast(msg);
  }

  /* 对外：朗读一段助手回复
     opts.auto = true  → 走「自动朗读」口径：尊重自动朗读开关 + 极短不读（13.8）
     opts.manual = true → 强制朗读（忽略上面两道闸）
     都不给时：若刚刚发生过 stop()（小喇叭的调用姿势），按手动处理 */
  function speak(text, emotion, opts) {
    opts = opts || {};
    var em = normEmotion(emotion);
    var clean = cleanText(text);
    if (!clean) return Promise.resolve(false);

    var manual = !!opts.manual || takeManualHint();
    if (!manual) {
      if (!getAutoRead()) {
        emit("voice:skipped", { text: clean, reason: "auto-off" });
        return Promise.resolve(false);
      }
      if (isTrivial(clean)) {
        emit("voice:skipped", { text: clean, reason: "short" });
        return Promise.resolve(false);
      }
    }
    return speakInternal(clean, em, opts.voice || null);
  }

  /* 自动朗读口径的朗读（其它模块想用「自动」语义时调这个） */
  function speakAuto(text, emotion) {
    return speak(text, emotion, { auto: true });
  }

  /* 对外：单段播放（气泡旁的小喇叭用，忽略「不自动朗读 / 过长不读」判定） */
  function playChunk(text, emotion) {
    var em = normEmotion(emotion);
    var clean = cleanText(text);
    if (!clean) return Promise.resolve(false);
    return speakInternal(clean, em, null);
  }

  function stop() {
    cancelToken++;
    speaking = false;
    manualHint = true;              /* 标记「接下来这次 speak() 多半是用户手动点的」 */
    manualHintAt = Date.now();
    if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
    try { if (audioEl) { audioEl.pause(); try { audioEl.currentTime = 0; } catch (e) { /* ignore */ } } } catch (e) { /* ignore */ }
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
  }
  function isSpeaking() { return !!speaking; }

  /* 取走手动标记（只在短时间内有效，防止旧标记误伤自动朗读） */
  function takeManualHint() {
    if (manualHint && (Date.now() - manualHintAt) < 400) { manualHint = false; return true; }
    manualHint = false;
    return false;
  }

  /* ============================================================
     自动朗读开关
     ============================================================ */
  function getAutoRead() {
    var v = storeGet(AUTO_READ_KEY, "1");
    return v !== "0";
  }
  function setAutoRead(v) {
    storeSet(AUTO_READ_KEY, v ? "1" : "0");
  }

  /* ============================================================
     情绪 → 音色对应表 UI（13.10，8 行）
     ============================================================ */
  function addOption(sel, value, text) {
    var o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    sel.appendChild(o);
  }
  function currentMap() {
    var cfg = vcfg();
    var m = {};
    var keys = emotionList();
    for (var i = 0; i < keys.length; i++) {
      m[keys[i]] = (cfg.map && cfg.map[keys[i]]) || A.DEFAULT_VOICE_MAP[keys[i]] || "";
    }
    return m;
  }
  function renderVoiceMap(container) {
    var wrap = container || byId("voice-map-wrap");
    if (!wrap) return;
    clearNode(wrap);
    var map = currentMap();
    var keys = emotionList();
    for (var i = 0; i < keys.length; i++) {
      (function (key) {
        var row = document.createElement("div");
        row.className = "vm-row";
        row.setAttribute("data-emotion", key);
        row.style.display = "flex";
        row.style.alignItems = "center";
        row.style.gap = "8px";
        row.style.margin = "8px 0 0";

        var lab = document.createElement("span");
        lab.className = "vm-label";
        lab.textContent = labelOf(key);
        lab.style.flex = "0 0 3.4em";
        lab.style.fontSize = "13px";
        lab.style.color = "var(--text-dim)";

        var sel = document.createElement("select");
        sel.className = "txt vm-select";
        sel.id = "vm-sel-" + key;
        sel.style.flex = "1 1 auto";
        sel.style.minWidth = "0";
        addOption(sel, "__base__", "跟随基准音色");
        var vs = A.VOICES || [];
        for (var j = 0; j < vs.length; j++) addOption(sel, vs[j].id, vs[j].name);
        sel.value = map[key] || "__base__";

        var btn = document.createElement("button");
        btn.className = "btn vm-test";
        btn.type = "button";
        btn.textContent = "试听";
        btn.style.flex = "0 0 auto";

        sel.addEventListener("change", function () {
          var m = currentMap();
          m[key] = sel.value;
          saveVoice({ map: m });
          clearCache();          /* 改对应表 → 立刻清缓存，下一句用新音色 */
        });
        btn.addEventListener("click", function () {
          var v = sel.value;
          previewVoice(key, v === "__base__" ? null : v);
        });

        row.appendChild(lab);
        row.appendChild(sel);
        row.appendChild(btn);
        wrap.appendChild(row);
      })(keys[i]);
    }
  }

  /* 试听：用该行音色读固定一句（13.10） */
  function previewVoice(key, voiceId) {
    var params = buildTtsParams(key);
    if (voiceId) params.voice = voiceId;
    else params.voice = baseVoice();
    var segs = splitForSpeech(PREVIEW_TEXT, key);
    if (!segs.length) return Promise.resolve(false);
    var token = ++cancelToken;
    speaking = true;
    return playSegments(segs, params, key, token).then(function (ok) {
      if (token === cancelToken) speaking = false;
      return ok;
    }, function () { speaking = false; return false; });
  }

  function applyMapVisibility() {
    var wrap = byId("voice-map-wrap");
    if (!wrap) return;
    var on = !!vcfg().auto;
    wrap.hidden = !on;
    wrap.style.display = on ? "" : "none";
  }

  /* ============================================================
     语音输入（14 章）
     ============================================================ */
  function hasSpeechRecognition() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
  function nativePlugin() {
    var c = window.Capacitor;
    if (!c || !c.Plugins) return null;
    var p = c.Plugins.SpeechRecognition;
    return p && typeof p.start === "function" ? p : null;
  }
  function focusInput() {
    var el = byId("input");
    if (el && typeof el.focus === "function") { try { el.focus(); } catch (e) { /* ignore */ } }
  }
  function setMicUI(on) {
    if (!micEl) micEl = byId("btn-mic");
    if (!micEl) return;
    try {
      micEl.classList.toggle("on", !!on);
      micEl.classList.toggle("listening", !!on);
    } catch (e) { /* ignore */ }
    micEl.setAttribute("aria-pressed", on ? "true" : "false");
  }

  /* 14.2 getUserMedia 错误映射 */
  function mapMediaError(err) {
    var name = (err && err.name) ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "麦克风被拒绝了。点地址栏左边的小锁 → 权限 → 麦克风改成允许，再按一次。";
    }
    if (name === "NotFoundError") return "没找到麦克风。检查一下是不是有设备占用着。";
    if (name === "NotReadableError") return "麦克风被别的应用占用了，关掉那个应用再试。";
    return "麦克风打不开，先用打字也可以。";
  }
  /* 14.3 recognition.onerror 映射 */
  function mapRecognitionError(code) {
    switch (code) {
      case "no-recognizer":
        return "这台手机没有语音识别服务，直接用打字也行";
      case "busy":
        return "上一句还在听，等一下再按";
      case "start-failed":
        return "语音启动失败，再按一次试试";
      case "not-allowed":
      case "permission-denied":
        return "麦克风被拒绝了。点地址栏左边的小锁 → 权限 → 麦克风改成允许。";
      case "service-not-allowed":
        return "这个浏览器禁用了语音识别服务。换 Chrome 或 Edge，或者直接用打字。";
      case "audio-capture":
        return "没有收到声音，检查麦克风是否被占用。";
      case "network":
        return "语音识别要连服务器，现在网络不通。稍后再试或打字。";
      case "no-speech":
        return "没听到你说话，再按一次试试。";
      case "aborted":
        return "语音被中断了。";
      case "language-not-supported":
        return "这个浏览器不支持中文识别。";
      default:
        return "语音打不开，先用打字也可以。";
    }
  }

  function failRecognition(message) {
    recognizing = false;
    setMicUI(false);
    if (message) toast(message, 3600);
    focusInput();                       /* 14.4 输入框保持可用并聚焦 */
    emit("voice:error", { message: message || "" });
  }

  /* 14.1 第 4 步：主动开一次麦克风，立刻释放，按 err.name 分流 */
  function probeMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return Promise.resolve({ ok: false, message: "这个浏览器拿不到麦克风接口。" });
    }
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      try {
        var tracks = stream.getTracks ? stream.getTracks() : [];
        for (var i = 0; i < tracks.length; i++) { try { tracks[i].stop(); } catch (e) { /* ignore */ } }
      } catch (e) { /* ignore */ }
      return { ok: true, message: "" };
    }).catch(function (err) {
      return { ok: false, message: mapMediaError(err) };
    });
  }

  function runWebRecognition() {
    return new Promise(function (resolve) {
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      var rec;
      try { rec = new SR(); } catch (e) {
        resolve({ ok: false, text: "", message: "这个浏览器没有语音识别能力，换 Chrome 或 Edge，或者直接用打字。" });
        return;
      }
      rec.lang = "zh-CN";
      rec.continuous = false;
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      var settled = false;
      function finish(obj) {
        if (settled) return;
        settled = true;
        recognizing = false;
        setMicUI(false);
        resolve(obj);
      }
      rec.onresult = function (ev) {
        var txt = "";
        try { txt = ev.results[0][0].transcript || ""; } catch (e) { txt = ""; }
        if (txt) finish({ ok: true, text: txt, message: "" });
        else finish({ ok: false, text: "", message: "没听到你说话，再按一次试试。" });
      };
      rec.onerror = function (ev) {
        finish({ ok: false, text: "", message: mapRecognitionError(ev && ev.error ? ev.error : "unknown") });
      };
      rec.onend = function () {
        if (!settled) finish({ ok: false, text: "", message: "语音被中断了。" });
      };
      try {
        recognizing = true;
        setMicUI(true);
        rec.start();
      } catch (e) {
        finish({ ok: false, text: "", message: "语音打不开，先用打字也可以。" });
      }
    });
  }

  /* 14.6 APK 原生识别 */
  function runNativeRecognition() {
    var p = nativePlugin();
    if (!p) return Promise.resolve(null);
    var ready = Promise.resolve(true);
    if (typeof p.available === "function") {
      ready = Promise.resolve(p.available({ language: "zh-CN" })).catch(function () { return true; });
    }
    return ready.then(function (ok) {
      if (ok === false) return null;    /* 插件不可用 → 降级到打字 */
      return Promise.resolve(p.start({
        language: "zh-CN",
        maxResults: 1,
        prompt: "",
        partialResults: false
      })).then(function (res) {
        var txt = "";
        try { txt = (res && res.matches && res.matches[0] && res.matches[0].transcript) || ""; } catch (e) { txt = ""; }
        if (txt) return { ok: true, text: txt, message: "" };
        return { ok: false, text: "", message: "没听到你说话，再按一次试试。" };
      }).catch(function (err) {
        var code = (err && (err.code || err.message)) || "unknown";
        return { ok: false, text: "", message: mapRecognitionError(String(code)) };
      });
    }).catch(function () { return null; });
  }

  /* 对外：开始识别 → Promise<{ok, text}> */
  function startRecognition() {
    if (recognizing) return Promise.resolve({ ok: false, text: "", message: "已经在听了。" });

    /* APK 原生优先 */
    var native = nativePlugin();
    if (native) {
      return runNativeRecognition().then(function (res) {
        if (res) {
          if (!res.ok) failRecognition(res.message);
          else { recognizing = false; setMicUI(false); emit("voice:result", { text: res.text }); }
          return res;
        }
        return webRecognitionFlow();      /* 插件不可用 → 降级 */
      });
    }
    return webRecognitionFlow();
  }

  function webRecognitionFlow() {
    /* 14.1 顺序：① 安全上下文 ② Web Speech API ③ getUserMedia ④ 实际打开 ⑤ onerror */
    if (!window.isSecureContext) {
      var m1 = "这个打开方式不能用麦克风。浏览器只允许 https 或 localhost，换成网址打开就行。";
      failRecognition(m1);
      return Promise.resolve({ ok: false, text: "", message: m1 });
    }
    if (!hasSpeechRecognition()) {
      var m2 = "这个浏览器没有语音识别能力，换 Chrome 或 Edge，或者直接用打字。";
      failRecognition(m2);
      return Promise.resolve({ ok: false, text: "", message: m2 });
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      var m3 = "这个浏览器拿不到麦克风接口。";
      failRecognition(m3);
      return Promise.resolve({ ok: false, text: "", message: m3 });
    }
    return probeMic().then(function (probe) {
      if (!probe.ok) {
        failRecognition(probe.message);
        return { ok: false, text: "", message: probe.message };
      }
      return runWebRecognition().then(function (res) {
        if (!res.ok) failRecognition(res.message);
        else emit("voice:result", { text: res.text });
        return res;
      });
    });
  }

  function stopRecognition() {
    recognizing = false;
    setMicUI(false);
    var p = nativePlugin();
    if (p && typeof p.stop === "function") { try { p.stop(); } catch (e) { /* ignore */ } }
    focusInput();
  }

  /* ============================================================
     麦克风自检（14.5）
     ============================================================ */
  function permState() {
    if (!navigator.permissions || !navigator.permissions.query) {
      return Promise.resolve("浏览器不支持权限查询");
    }
    return navigator.permissions.query({ name: "microphone" }).then(function (p) {
      return p && p.state ? p.state : "未知";
    }).catch(function () { return "查询失败（浏览器可能不支持 microphone 权限查询）"; });
  }
  function envName() {
    if (isElectron()) return "桌面 App（Electron）";
    if (window.Capacitor) return "安卓 APK（Capacitor）";
    if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return "PWA（独立窗口）";
    return "浏览器网页";
  }
  function diagnostics() {
    var lines = [];
    var loc = window.location || {};
    lines.push("① 页面协议与主机：" + (loc.protocol || "?") + "//" + (loc.host || "?"));
    lines.push("② 安全上下文 isSecureContext：" + (window.isSecureContext ? "是" : "否"));
    lines.push("③ Web Speech API：" + (hasSpeechRecognition() ? "支持" : "不支持"));
    lines.push("④ getUserMedia：" + (navigator.mediaDevices && navigator.mediaDevices.getUserMedia ? "有" : "无"));
    return permState().then(function (st) {
      lines.push("⑤ 麦克风权限（permissions.query）：" + st);
      return probeMic().then(function (p) {
        lines.push("⑥ 实际能否打开麦克风：" + (p.ok ? "可以（已立即释放）" : ("打不开 —— " + p.message)));
        lines.push("运行环境：" + envName());
        lines.push("网络：" + (navigator.onLine === false ? "离线" : "在线"));
        lines.push("语音合成：" + (window.speechSynthesis ? "浏览器自带可用" : "不可用"));
        lines.push("生成时间：" + (window.AuraTime ? window.AuraTime.full(Date.now()) : ""));
        return lines.join("\n");
      });
    }).catch(function (e) {
      lines.push("自检过程中出现异常：" + String(e && e.message ? e.message : e));
      return lines.join("\n");
    });
  }

  /* 自检弹窗：#modal + #modal-extra 里塞可全选复制的文本框和复制按钮 */
  function openSelfCheck() {
    var modal = byId("modal");
    var extra = byId("modal-extra");
    var mtext = byId("modal-text");
    var ok = byId("modal-ok");
    var cancel = byId("modal-cancel");
    var scrim = byId("modal-scrim");
    if (!modal || !extra) return;

    clearNode(extra);
    if (mtext) mtext.textContent = "麦克风自检";
    if (cancel) cancel.hidden = true;

    var ta = document.createElement("textarea");
    ta.className = "txt area";
    ta.readOnly = true;
    ta.rows = 12;
    ta.style.width = "100%";
    ta.value = "正在检测…";

    var note = document.createElement("p");
    note.className = "hint";
    note.textContent = "";

    var btn = document.createElement("button");
    btn.className = "btn primary";
    btn.type = "button";
    btn.textContent = "复制这段文字";

    extra.appendChild(ta);
    extra.appendChild(btn);
    extra.appendChild(note);

    function legacyCopy() {
      var okc = false;
      try {
        ta.focus();
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        okc = document.execCommand("copy");
      } catch (e) { okc = false; }
      note.textContent = okc ? "已复制。" : "长按上面的文字手动复制就行。";
    }
    btn.addEventListener("click", function () {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(ta.value).then(function () {
            note.textContent = "已复制。";
          }, legacyCopy);
          return;
        }
      } catch (e) { /* ignore */ }
      legacyCopy();
    });

    if (ok) ok.textContent = "关闭";
    if (modal.hidden) {
      modal.hidden = false;
      if (scrim) scrim.hidden = false;
      ok.onclick = closeSelfCheck;
      if (scrim) scrim.onclick = closeSelfCheck;
    }
    diagnostics().then(function (text) {
      ta.value = text;
    });
  }
  function closeSelfCheck() {
    var modal = byId("modal");
    var extra = byId("modal-extra");
    var scrim = byId("modal-scrim");
    var ok = byId("modal-ok");
    if (modal) modal.hidden = true;
    if (scrim) scrim.hidden = true;
    if (ok) { ok.onclick = null; ok.textContent = "知道了"; }
    if (extra) clearNode(extra);
  }

  /* ============================================================
     抽屉接线（13.10）
     ============================================================ */
  function setLabel(sel, text) {
    var el = byId(sel);
    if (el) el.textContent = text;
  }
  function initDrawer() {
    var cfg = vcfg();

    /* 基准音色下拉（别人已经填过选项就别再填，免得把选中项冲掉） */
    var baseSel = byId("in-voice-base");
    if (baseSel) {
      if (!baseSel.options || !baseSel.options.length) {
        clearNode(baseSel);
        var vs = A.VOICES || [];
        for (var i = 0; i < vs.length; i++) addOption(baseSel, vs[i].id, vs[i].name);
      }
      baseSel.value = baseVoice();
      baseSel.addEventListener("change", function () {
        saveVoice({ base: baseSel.value });
        clearCache();
        renderVoiceMap();
      });
    }

    /* 语速滑块 */
    var rate = byId("in-voice-rate");
    if (rate) {
      rate.value = String(cfg.rate);
      setLabel("val-rate", (Number(cfg.rate) || 0.95).toFixed(2));
      rate.addEventListener("input", function () {
        setLabel("val-rate", (parseFloat(rate.value) || 0.95).toFixed(2));
      });
      rate.addEventListener("change", function () {
        var v = parseFloat(rate.value);
        if (!(v > 0)) v = 0.95;
        saveVoice({ rate: v, rateTouched: true });   /* 13.11 用户手动改过就不再被夜间覆盖 */
        setLabel("val-rate", v.toFixed(2));
      });
    }

    /* 音量滑块 */
    var vol = byId("in-voice-vol");
    if (vol) {
      vol.value = String(cfg.vol);
      setLabel("val-vol", String(Math.round((Number(cfg.vol) || 1) * 100)));
      vol.addEventListener("input", function () {
        setLabel("val-vol", String(Math.round((parseFloat(vol.value) || 1) * 100)));
      });
      vol.addEventListener("change", function () {
        var v = parseFloat(vol.value);
        if (!(v > 0)) v = 1;
        saveVoice({ vol: v });
        setLabel("val-vol", String(Math.round(v * 100)));
      });
    }

    /* 情绪自动换音色开关
       ⚠️ app.js 里也有一个 bindSwitch 在这个开关上。若两处都「自己切一次」，
       一次点击会被切两下 = 看着像没反应。所以这里改成：
         · 用 MutationObserver 盯 aria-checked，别人切了我就跟着存 + 显隐对应表；
         · 再兜一个 click：如果点了之后状态没人动过，说明没人接线，我补切一下。 */
    var sw = byId("in-voice-auto");
    if (sw) {
      sw.setAttribute("aria-checked", cfg.auto ? "true" : "false");
      try { sw.classList.toggle("on", !!cfg.auto); } catch (e) { /* ignore */ }

      var lastAuto = cfg.auto ? "true" : "false";
      function applyAuto() {
        var now = sw.getAttribute("aria-checked");
        if (now === lastAuto) return;
        lastAuto = now;
        saveVoice({ auto: now === "true" });
        applyMapVisibility();          /* 关掉只隐藏表，不清空（13.10） */
        clearCache();
      }
      if (window.MutationObserver) {
        var mo = new MutationObserver(applyAuto);
        try { mo.observe(sw, { attributes: true, attributeFilter: ["aria-checked"] }); } catch (e) { /* ignore */ }
      }
      sw.addEventListener("click", function () {
        var before = sw.getAttribute("aria-checked");
        setTimeout(function () {
          var after = sw.getAttribute("aria-checked");
          if (after === before) {        /* 没人切 → 我来切 */
            var on = after !== "true";
            sw.setAttribute("aria-checked", on ? "true" : "false");
            try { sw.classList.toggle("on", on); } catch (e) { /* ignore */ }
            lastAuto = sw.getAttribute("aria-checked");
            saveVoice({ auto: on });
            applyMapVisibility();
            clearCache();
          }
        }, 0);
      });
    }

    renderVoiceMap();
    applyMapVisibility();
  }

  /* ============================================================
     初始化
     ============================================================ */
  function init() {
    if (!A.cfg || !A.cfg.voice) {
      try { if (typeof A.loadAll === "function") A.loadAll(); } catch (e) { /* ignore */ }
    }

    /* 当前这一轮的情绪（face:change） */
    if (A.bus && typeof A.bus.on === "function") {
      A.bus.on("face:change", function (p) {
        if (!p || !p.type) return;
        if (p.type !== curEmotion) curEmotion = p.type;
      });
    }

    initDrawer();

    /* 麦克风按钮 */
    micEl = byId("btn-mic");
    if (micEl) {
      micEl.addEventListener("click", function () {
        if (recognizing) { stopRecognition(); return; }
        startRecognition();
      });
    }

    /* 麦克风自检按钮 */
    var chk = byId("btn-mic-check");
    if (chk) chk.addEventListener("click", openSelfCheck);

    /* 13.7 首次用户手势解锁音频 */
    if (!unlockTried) {
      var once = function () { unlock(); };
      document.addEventListener("pointerdown", once, { once: true, capture: true });
      document.addEventListener("keydown", once, { once: true, capture: true });
      document.addEventListener("touchstart", once, { once: true, capture: true });
    }
    var send = byId("btn-send");
    if (send) send.addEventListener("click", function () { unlock(); });

    /* 13.11 夜间首次进入提示（一天一次） */
    try {
      if (isNight() && !vcfg().rateTouched) {
        var today = new Date().toISOString().slice(0, 10);
        if (storeGet(NIGHT_NOTICE_KEY, "") !== today) {
          storeSet(NIGHT_NOTICE_KEY, today);
          setTimeout(function () { toast("夜深了，我把声音放轻了。"); }, 1200);
        }
      }
    } catch (e) { /* ignore */ }

    /* 页面卸载时统一释放 blob URL */
    window.addEventListener("pagehide", function () { clearCache(); });
    window.addEventListener("beforeunload", function () { clearCache(); });
  }

  /* ============================================================
     对外
     ============================================================ */
  A.voice = {
    speak: speak,
    speakAuto: speakAuto,
    stop: stop,
    isSpeaking: isSpeaking,
    setAutoRead: setAutoRead,
    getAutoRead: getAutoRead,
    unlock: unlock,
    splitForSpeech: splitForSpeech,
    buildTtsParams: buildTtsParams,
    startRecognition: startRecognition,
    stopRecognition: stopRecognition,
    isRecognizing: function () { return !!recognizing; },
    diagnostics: diagnostics,
    renderVoiceMap: renderVoiceMap,
    init: init,
    /* 附加：单段播放、试听、缓存清理 */
    playChunk: playChunk,
    previewVoice: previewVoice,
    clearCache: clearCache,
    openSelfCheck: openSelfCheck,
    isElectron: isElectron,
    currentEmotion: function () { return curEmotion; }
  };
})();
