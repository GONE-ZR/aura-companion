/* ============================================================
   settings.js —— 存储契约 / 主题 / 壁纸 / 迁移
   存储 key 名是契约，任何版本都不得重命名（规格书 20.1）
   ============================================================ */
(function () {
  "use strict";

  /* ---------- 契约 key ---------- */
  var KEYS = {
    summary: "aura_summary",
    memory: "aura_memory",
    mood: "aura_mood",
    moodHistory: "aura_mood_history",
    moodFace: "aura_mood_face",
    faceLevel: "aura_face_level",
    emotionTint: "aura_emotion_tint",
    aiName: "aura_ai_name",
    userName: "aura_user_name",
    persona: "aura_persona",
    templates: "aura_templates",
    wallpaper: "aura_wallpaper",
    mask: "aura_mask",
    accent: "aura_accent",
    theme: "aura_theme",
    voice: "aura_voice",
    voiceRate: "aura_voice_rate",
    voiceMap: "aura_voice_map",
    nativeVoice: "aura_native_voice",
    emotionVoice: "aura_emotion_voice",
    draft: "aura_draft",
    moodOn: "aura_mood_on",
    coupleOn: "aura_couple_on",
    sessionId: "aura_session_id",
    city: "aura_city",
    weatherOn: "aura_weather_on",
    weatherDaily: "aura_weather_daily",
    /* 新增 key（不改动既有契约） */
    voiceVol: "aura_voice_vol",
    voiceRateTouched: "aura_voice_rate_touched",
    updateSkipped: "aura_update_skipped",
    imgNotice: "aura_imgNotice",
    wxNotice: "aura_wx_notice",
    keyNotice: "aura_key_notice",
    coupleNotice: "aura_couple_notice",
    server: "aura_server",
    apiKey: "aura_api_key",
    mode: "aura_mode",
    thinkDelay: "aura_think_delay",
    iconName: "aura_icon_name",
    wxLat: "aura_wx_lat",
    wxLon: "aura_wx_lon",
    migrateVer: "aura_migrated_ver"
  };

  var MESSAGES_PREFIX = "aura_msgs_";

  /* ---------- 安全存取 ---------- */
  function rawGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }
  function rawSet(k, v) {
    /* 写穿透：持久层同步一份到 IndexedDB（异步，不阻塞） */
    try { if (window.AuraDB) window.AuraDB.mirror(k, String(v)); } catch (e) { }

    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function rawDel(k) {
    try { localStorage.removeItem(k); } catch (e) { return false; }
    /* 镜像同步删：否则下次 hydrate 会把刚删掉的键写回来 */
    try { if (window.AuraDB && window.AuraDB.forget) window.AuraDB.forget(k); } catch (e) { }
    return true;
  }
  function getJSON(k, fallback) {
    var s = rawGet(k);
    if (s === null || s === undefined || s === "") return fallback;
    try {
      var v = JSON.parse(s);
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) {
      // 读坏了不删，保留原地等下次修
      return fallback;
    }
  }
  function setJSON(k, v) {
    try { return rawSet(k, JSON.stringify(v)); } catch (e) { return false; }
  }
  function getStr(k, fallback) {
    var s = rawGet(k);
    return (s === null || s === undefined) ? fallback : String(s);
  }
  function setStr(k, v) { return rawSet(k, String(v)); }

  /* ---------- 存储可用性探测（启动就跑，别等用户试壁纸） ---------- */
  var storageOK = (function () {
    try {
      var t = "__aura_probe__";
      localStorage.setItem(t, "1");
      localStorage.removeItem(t);
      return true;
    } catch (e) { return false; }
  })();

  /* ---------- 小工具 ---------- */
  function uid() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function hexToHsl(hex) {
    hex = String(hex || "").trim().replace("#", "");
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return { h: 166, s: 13, l: 60 };
    var r = parseInt(hex.slice(0, 2), 16) / 255,
        g = parseInt(hex.slice(2, 4), 16) / 255,
        b = parseInt(hex.slice(4, 6), 16) / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
  }
  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      var v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * v).toString(16).padStart(2, "0");
    };
    return ("#" + f(0) + f(8) + f(4)).toUpperCase();
  }

  /* ---------- 音色表 ---------- */
  var VOICES = [
    { id: "zh-CN-XiaoxiaoNeural", name: "温柔女声（默认）" },
    { id: "zh-CN-XiaoyiNeural", name: "清亮、年轻" },
    { id: "zh-CN-YunxiNeural", name: "年轻男声" },
    { id: "zh-CN-YunjianNeural", name: "低沉男声" },
    { id: "zh-CN-liaoning-XiaobeiNeural", name: "柔和女声（辽宁）" },
    { id: "zh-CN-shaanxi-XiaoniNeural", name: "女声（陕西）" }
  ];

  var EMOTIONS = ["calm", "happy", "tender", "angry", "low", "stifled", "jealous", "curious"];

  var EMOTION_LABEL = {
    calm: "安稳", happy: "高兴", tender: "心疼", angry: "生气",
    low: "低落", stifled: "闷", jealous: "有点在意", curious: "好奇"
  };

  /* 默认情绪→音色（规格 13.2） */
  var DEFAULT_VOICE_MAP = {
    calm: "zh-CN-XiaoxiaoNeural",
    tender: "zh-CN-XiaoxiaoNeural",
    low: "zh-CN-XiaoxiaoNeural",
    stifled: "zh-CN-XiaoxiaoNeural",
    happy: "zh-CN-XiaoyiNeural",
    curious: "zh-CN-XiaoyiNeural",
    jealous: "zh-CN-XiaoyiNeural",
    angry: "zh-CN-YunjianNeural"
  };

  /* 情绪参数偏移（规格 13.3） */
  var EMOTION_TTS = {
    calm:     { rate: 0.00, pitch: 0,  vol: 1.00 },
    happy:    { rate: 0.06, pitch: 8,  vol: 1.00 },
    tender:   { rate: -0.04, pitch: -2, vol: 1.00 },
    angry:    { rate: 0.02, pitch: -4, vol: 0.90 },
    low:      { rate: -0.08, pitch: -6, vol: 0.70 },
    stifled:  { rate: -0.05, pitch: -4, vol: 0.85 },
    jealous:  { rate: 0.01, pitch: 3,  vol: 0.90 },
    curious:  { rate: 0.03, pitch: 4,  vol: 1.00 }
  };

  /* 情绪色相/明度/饱和偏移（规格 12.12） */
  var EMOTION_TINT = {
    calm:     { h: 0,   l: 0,   s: 1.00, glow: 6,  breath: 0 },
    happy:    { h: 12,  l: 6,   s: 1.00, glow: 9,  breath: 5.2 },
    tender:   { h: -8,  l: 2,   s: 1.00, glow: 7,  breath: 0 },
    angry:    { h: -18, l: -6,  s: 0.80, glow: 5,  breath: 0 },
    low:      { h: -10, l: -10, s: 0.70, glow: 4,  breath: 8.5 },
    stifled:  { h: -14, l: -6,  s: 0.95, glow: 5,  breath: 0 },
    jealous:  { h: 22,  l: 3,   s: 0.85, glow: 7,  breath: 0 },
    curious:  { h: 8,   l: 4,   s: 1.00, glow: 8,  breath: 6 }
  };

  var FACE_LEVELS = {
    calm:  { mul: 0,   cap: 0, jealousEvery: 0 },
    normal:{ mul: 0.6, cap: 2, jealousEvery: 30 },
    vivid: { mul: 1.0, cap: 3, jealousEvery: 15 }
  };

  /* ---------- 当前配置（内存快照） ---------- */
  var cfg = {
    aiName: "",
    userName: "",
    persona: null,          /* {id,text} */
    templates: null,        /* 服务端下发的预设列表 */
    theme: "auto",
    accentHex: "#8CA6A0",
    accent: { h: 166, s: 13, l: 60 },
    mask: 70,
    wallpaper: "",
    voice: {
      base: "zh-CN-XiaoxiaoNeural",
      rate: 0.95,
      vol: 1.0,
      rateTouched: false,
      auto: true,
      nativeVoice: "",
      map: null
    },
    moodOn: true,
    coupleOn: false,
    faceLevel: "normal",
    emotionTint: true,
    city: "",
    weatherOn: true,
    weatherDaily: false,
    sessionId: "",
    server: "",
    apiKey: "",
    /* 连接方式：direct = 手机自己直连 DeepSeek（不需要服务器、电脑关机也能用）
       server = 走自己的服务器（有 edge-tts 真音色） */
    mode: "direct",
    thinkDelay: "short",
    iconName: "AliasDefault"
  };

  function loadAll() {
    cfg.sessionId = getStr(KEYS.sessionId, "") || uid();
    setStr(KEYS.sessionId, cfg.sessionId);

    cfg.aiName = getStr(KEYS.aiName, "") || "我";
    cfg.userName = getStr(KEYS.userName, "") || "";

    cfg.theme = getStr(KEYS.theme, "auto");
    cfg.accentHex = getStr(KEYS.accent, "#8CA6A0");
    cfg.accent = hexToHsl(cfg.accentHex);
    cfg.mask = clamp(parseInt(getStr(KEYS.mask, "70"), 10) || 70, 0, 90);
    cfg.wallpaper = getStr(KEYS.wallpaper, "");

    cfg.voice.base = getStr(KEYS.voice, "zh-CN-XiaoxiaoNeural");
    cfg.voice.rate = clamp(parseFloat(getStr(KEYS.voiceRate, "0.95")) || 0.95, 0.8, 1.2);
    cfg.voice.vol = clamp(parseFloat(getStr(KEYS.voiceVol, "1")) || 1, 0.6, 1);
    cfg.voice.rateTouched = getStr(KEYS.voiceRateTouched, "") === "1";
    cfg.voice.auto = getStr(KEYS.emotionVoice, "1") !== "0";
    cfg.voice.nativeVoice = getStr(KEYS.nativeVoice, "");
    var m = getJSON(KEYS.voiceMap, null);
    cfg.voice.map = {};
    for (var i = 0; i < EMOTIONS.length; i++) {
      var k = EMOTIONS[i];
      cfg.voice.map[k] = (m && m[k]) || DEFAULT_VOICE_MAP[k];
    }

    cfg.moodOn = getStr(KEYS.moodOn, "1") !== "0";
    cfg.coupleOn = getStr(KEYS.coupleOn, "0") === "1";
    cfg.faceLevel = getStr(KEYS.faceLevel, "normal");
    if (!FACE_LEVELS[cfg.faceLevel]) cfg.faceLevel = "normal";
    cfg.emotionTint = getStr(KEYS.emotionTint, "1") !== "0";

    cfg.city = getStr(KEYS.city, "");
    cfg.weatherOn = getStr(KEYS.weatherOn, "1") !== "0";
    cfg.weatherDaily = getStr(KEYS.weatherDaily, "0") === "1";

    cfg.server = getStr(KEYS.server, "");
    cfg.apiKey = getStr(KEYS.apiKey, "");
    cfg.mode = getStr(KEYS.mode, "direct");
    if (cfg.mode !== "direct" && cfg.mode !== "server") cfg.mode = "direct";
    /* 回复前的停顿：off=不等 / short=很短（默认）/ normal=规格书的拟真节奏 */
    cfg.thinkDelay = getStr(KEYS.thinkDelay, "short");
    if (["off", "short", "normal"].indexOf(cfg.thinkDelay) === -1) cfg.thinkDelay = "short";
    cfg.iconName = getStr(KEYS.iconName, "AliasDefault");

    var p = getJSON(KEYS.persona, null);
    if (p && typeof p.text === "string") cfg.persona = p;
    var t = getJSON(KEYS.templates, null);
    if (t && t.length) cfg.templates = t;

    return cfg;
  }

  function savePersona(p) {
    cfg.persona = p;
    setJSON(KEYS.persona, p);
  }
  function saveTemplates(list) {
    cfg.templates = list;
    setJSON(KEYS.templates, list);
  }
  function saveVoice(patch) {
    if (patch.base !== undefined) { cfg.voice.base = patch.base; setStr(KEYS.voice, patch.base); }
    if (patch.rate !== undefined) { cfg.voice.rate = patch.rate; setStr(KEYS.voiceRate, patch.rate); }
    if (patch.vol !== undefined) { cfg.voice.vol = patch.vol; setStr(KEYS.voiceVol, patch.vol); }
    if (patch.rateTouched !== undefined) {
      cfg.voice.rateTouched = !!patch.rateTouched;
      setStr(KEYS.voiceRateTouched, cfg.voice.rateTouched ? "1" : "0");
    }
    if (patch.nativeVoice !== undefined) {
      cfg.voice.nativeVoice = patch.nativeVoice || "";
      setStr(KEYS.nativeVoice, cfg.voice.nativeVoice);
    }
    if (patch.auto !== undefined) { cfg.voice.auto = !!patch.auto; setStr(KEYS.emotionVoice, cfg.voice.auto ? "1" : "0"); }
    if (patch.map !== undefined) {
      cfg.voice.map = patch.map;
      setJSON(KEYS.voiceMap, patch.map);
    }
  }
  function saveTheme(v) {
    cfg.theme = v; setStr(KEYS.theme, v); applyTheme();
  }
  function saveAccent(hex) {
    cfg.accentHex = hex; cfg.accent = hexToHsl(hex);
    setStr(KEYS.accent, hex);
    applyAccentBase();
  }
  function saveMask(v) {
    cfg.mask = clamp(v, 0, 90); setStr(KEYS.mask, cfg.mask); applyWallpaper();
  }
  function saveWallpaper(dataUrl) {
    cfg.wallpaper = dataUrl || "";
    if (dataUrl) setStr(KEYS.wallpaper, dataUrl); else rawDel(KEYS.wallpaper);
    applyWallpaper();
  }
  function saveMoodOn(v) { cfg.moodOn = !!v; setStr(KEYS.moodOn, v ? "1" : "0"); }
  function saveCoupleOn(v) { cfg.coupleOn = !!v; setStr(KEYS.coupleOn, v ? "1" : "0"); }
  function saveFaceLevel(v) { cfg.faceLevel = FACE_LEVELS[v] ? v : "normal"; setStr(KEYS.faceLevel, cfg.faceLevel); }
  function saveEmotionTint(v) { cfg.emotionTint = !!v; setStr(KEYS.emotionTint, v ? "1" : "0"); }
  function saveCity(v) { cfg.city = v || ""; setStr(KEYS.city, cfg.city); }
  function saveWeatherOn(v) { cfg.weatherOn = !!v; setStr(KEYS.weatherOn, v ? "1" : "0"); }
  function saveWeatherDaily(v) { cfg.weatherDaily = !!v; setStr(KEYS.weatherDaily, v ? "1" : "0"); }
  function saveServer(v) { cfg.server = v || ""; setStr(KEYS.server, cfg.server); }
  function saveApiKey(v) { cfg.apiKey = v || ""; setStr(KEYS.apiKey, cfg.apiKey); }
  function saveMode(v) {
    cfg.mode = (v === "server") ? "server" : "direct";
    setStr(KEYS.mode, cfg.mode);
  }
  function saveThinkDelay(v) {
    cfg.thinkDelay = ["off", "short", "normal"].indexOf(v) === -1 ? "short" : v;
    setStr(KEYS.thinkDelay, cfg.thinkDelay);
  }
  function saveIconName(v) { cfg.iconName = v || "AliasDefault"; setStr(KEYS.iconName, cfg.iconName); }
  function saveAiName(v) { cfg.aiName = v || "我"; setStr(KEYS.aiName, cfg.aiName); }
  function saveUserName(v) { cfg.userName = v || ""; setStr(KEYS.userName, cfg.userName); }

  /* ---------- 主题 / 配色 ---------- */
  function applyTheme() {
    var t = cfg.theme;
    if (t === "auto") {
      t = (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) ? "dark" : "light";
    }
    document.body.setAttribute("data-theme", t);
    document.documentElement.style.colorScheme = t;
    applyWallpaper();  /* 夜间蒙版自动 +10% */
  }

  function applyAccentBase() {
    var r = document.documentElement.style;
    r.setProperty("--acc-h", cfg.accent.h);
    r.setProperty("--acc-s", cfg.accent.s);
    r.setProperty("--acc-l", cfg.accent.l);
  }

  /* 情绪色是相对基准的偏移（规格 12.12） */
  function applyEmotionTint(emotion) {
    var r = document.documentElement.style;
    if (!cfg.emotionTint || !emotion) {
      r.setProperty("--acc-h", cfg.accent.h);
      r.setProperty("--acc-s", cfg.accent.s);
      r.setProperty("--acc-l", cfg.accent.l);
      r.setProperty("--glow-a", "6");
      r.setProperty("--glow-b", "6");
      r.setProperty("--breath-dur", "0s");
      return;
    }
    var mul = FACE_LEVELS[cfg.faceLevel].mul;
    var t = EMOTION_TINT[emotion] || EMOTION_TINT.calm;
    var night = document.body.getAttribute("data-theme") === "dark";
    var lm = night ? 0.7 : 1;
    r.setProperty("--acc-h", Math.round(cfg.accent.h + t.h * mul));
    r.setProperty("--acc-s", Math.round(cfg.accent.s * (1 + (t.s - 1) * mul)));
    r.setProperty("--acc-l", Math.round(cfg.accent.l + t.l * mul * lm));
    r.setProperty("--glow-a", String(t.glow * mul));
    r.setProperty("--glow-b", String(t.glow * mul));
    r.setProperty("--breath-dur", t.breath ? (t.breath + "s") : "0s");
  }

  /* ---------- 壁纸 ---------- */
  function applyWallpaper() {
    var wp = document.getElementById("wp-layer");
    var mask = document.getElementById("veil-layer");
    if (!wp || !mask) return;
    if (cfg.wallpaper) {
      wp.style.backgroundImage = "url(\"" + cfg.wallpaper + "\")";
      wp.style.display = "block";
    } else {
      wp.style.backgroundImage = "none";
      wp.style.display = "none";
    }
    var night = document.body.getAttribute("data-theme") === "dark";
    var m = cfg.mask + (night ? 10 : 0);      /* 夜间 +10%，只渲染层，不写入存储 */
    mask.style.opacity = String(Math.min(100, m) / 100);
  }

  /* ---------- 迁移（规格 20.3） ---------- */
  function migrate() {
    var VER = "1";
    var done = getStr(KEYS.migrateVer, "");
    if (done === VER) return { ok: true, skipped: true };

    try {
      /* 老版本可能把对话存在 aura_history / aura_chat 里 → 并入新 key */
      var legacy = [];
      ["aura_history", "aura_chat", "aura_messages"].forEach(function (k) {
        var v = getJSON(k, null);
        if (Array.isArray(v) && v.length) legacy = legacy.concat(v);
        rawDel(k);
      });
      if (legacy.length) {
        var msgKey = MESSAGES_PREFIX + cfg.sessionId;
        var cur = getJSON(msgKey, []);
        if (!Array.isArray(cur)) cur = [];
        setJSON(msgKey, cur.concat(legacy));
      }
      /* 老版本情绪结构 {v:} → {light:, stage:} */
      var mood = getJSON(KEYS.mood, null);
      if (mood && typeof mood === "object" && mood.v !== undefined && mood.light === undefined) {
        setJSON(KEYS.mood, { light: clamp(mood.v, 20, 100), stage: mood.stage || 0, lastSeen: mood.lastSeen || Date.now() });
      }
      setStr(KEYS.migrateVer, VER);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  /* ---------- 存储用量 ---------- */
  function storageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        var v = localStorage.getItem(k) || "";
        total += (k.length + v.length) * 2;
      }
    } catch (e) { /* ignore */ }
    return total;
  }

  /* ---------- 导出 / 导入（仅桌面端） ---------- */
  function exportAll() {
    var out = { _app: "aura-companion", _ver: 1, _at: new Date().toISOString(), data: {} };
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf("aura_") === 0) out.data[k] = localStorage.getItem(k);
      }
    } catch (e) { /* ignore */ }
    return out;
  }
  function importAll(obj) {
    if (!obj || !obj.data || typeof obj.data !== "object") return false;
    for (var k in obj.data) {
      if (Object.prototype.hasOwnProperty.call(obj.data, k) && k.indexOf("aura_") === 0) {
        rawSet(k, obj.data[k]);
      }
    }
    return true;
  }

  /* ---------- 事件总线 ---------- */
  var listeners = {};
  function on(evt, fn) {
    (listeners[evt] = listeners[evt] || []).push(fn);
  }
  function emit(evt, data) {
    (listeners[evt] || []).forEach(function (fn) {
      try { fn(data); } catch (e) { console.warn("[aura] listener error", evt, e); }
    });
  }

  /* ---------- 对话存取 ---------- */
  function msgKey(sessionId) { return MESSAGES_PREFIX + (sessionId || cfg.sessionId); }
  function loadMessages() {
    /* §1.2 统一出口：软删除的消息不返回给界面 */
    var arr = getJSON(msgKey(), []);
    if (!Array.isArray(arr)) return [];
    if (window.AuraRecords) return window.AuraRecords.messages(cfg.sessionId);
    return arr.filter(function (m) { return m && !m.deletedAt; });
  }
  function loadRawMessages() {
    var arr = getJSON(msgKey(), []);
    return Array.isArray(arr) ? arr : [];
  }
  function saveMessages(arr) {
    /* §1.2：保存时保留墓碑，不许顺手抹掉软删除的消息 */
    if (window.AuraRecords) return window.AuraRecords.saveMessages(cfg.sessionId, arr);
    return setJSON(msgKey(), arr);
  }
  function clearMessages() {
    rawDel(msgKey());
    rawDel(KEYS.summary);
    rawDel(KEYS.memory);
  }

  /* ---------- 对外 ---------- */
  window.Aura = window.Aura || {};
  window.Aura.store = {
    KEYS: KEYS,
    MESSAGES_PREFIX: MESSAGES_PREFIX,
    get: getJSON, set: setJSON, getStr: getStr, setStr: setStr, del: rawDel,
    storageOK: storageOK,
    bytes: storageBytes
  };
  window.Aura.cfg = cfg;
  window.Aura.loadAll = loadAll;
  window.Aura.save = {
    persona: savePersona, templates: saveTemplates, voice: saveVoice,
    theme: saveTheme, accent: saveAccent, mask: saveMask, wallpaper: saveWallpaper,
    moodOn: saveMoodOn, coupleOn: saveCoupleOn, faceLevel: saveFaceLevel,
    emotionTint: saveEmotionTint, city: saveCity, weatherOn: saveWeatherOn,
    weatherDaily: saveWeatherDaily, server: saveServer, apiKey: saveApiKey,
    mode: saveMode,
    thinkDelay: saveThinkDelay,
    iconName: saveIconName, aiName: saveAiName, userName: saveUserName
  };
  window.Aura.apply = {
    theme: applyTheme, accent: applyAccentBase, tint: applyEmotionTint, wallpaper: applyWallpaper
  };
  window.Aura.util = {
    uid: uid, clamp: clamp, hexToHsl: hexToHsl, hslToHex: hslToHex
  };
  window.Aura.bus = { on: on, emit: emit };
  window.Aura.messages = {
    load: loadMessages, save: saveMessages, clear: clearMessages, key: msgKey
  };
  window.Aura.data = { exportAll: exportAll, importAll: importAll, migrate: migrate };
  window.Aura.VOICES = VOICES;
  window.Aura.EMOTIONS = EMOTIONS;
  window.Aura.EMOTION_LABEL = EMOTION_LABEL;
  window.Aura.EMOTION_TTS = EMOTION_TTS;
  window.Aura.EMOTION_TINT = EMOTION_TINT;
  window.Aura.DEFAULT_VOICE_MAP = DEFAULT_VOICE_MAP;
  window.Aura.FACE_LEVELS = FACE_LEVELS;
})();
