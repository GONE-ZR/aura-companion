/* ============================================================
   mood.js —— 情绪系统（第 11、12 章）
   核心：这是"看一眼它最近的状态"的地方，不是分数、不是打卡、不是养成。
   情绪永远指向世界，不指向用户；不索取、不制造愧疚。
   ============================================================ */
(function () {
  "use strict";

  var S = window.Aura.store;
  var cfg = window.Aura.cfg;
  var bus = window.Aura.bus;

  /* ---------------- 情绪词典 ---------------- */
  var NEGATIVE_HARD = [
    "想死", "不想活", "自杀", "自伤", "割腕", "跳楼", "活不下去",
    "结束生命", "活着没意思", "不如死了"
  ];
  var NEGATIVE_STRONG = [
    "撑不住", "撑不下去", "崩溃", "熬不下去", "受不了了", "绝望",
    "没希望", "活着好累", "扛不住", "想消失"
  ];
  var TENDER = ["累", "好累", "睡不着", "失眠", "疼", "痛", "生病", "难受", "熬", "困", "饿", "冷", "难过"];
  var ANGRY = ["骂", "骂我", "领导骂", "甩锅", "被欺负", "欺负我", "侮辱", "凭什么", "恶心", "烦死", "气死", "被针对", "冤枉", "看不起"];
  var LOW = ["空", "空空的", "空虚", "没意思", "没意义", "无所谓", "躺平", "什么都不想", "意义"];
  var STIFLED = ["又这样", "老是", "每次都", "总是", "反复", "又来了", "还是老样子", "一直这样"];
  var HAPPY = ["谢谢", "感谢", "谢啦", "太好了", "搞定", "完成了", "成功", "过了", "升职", "开心", "哈哈", "不错", "值得", "爽", "舒服", "进步"];
  var WARM = ["谢谢", "感谢", "辛苦", "乖", "温柔", "爱", "抱抱", "心疼你", "喜欢你", "想你了"];
  var JEALOUS = ["她对我", "他对我", "别人对我", "有人对我", "他对我好", "她对我好"];

  var NEGATIVE_TYPES = ["angry", "low", "stifled", "jealous"];

  function hit(text, list) {
    for (var i = 0; i < list.length; i++) {
      if (text.indexOf(list[i]) !== -1) return list[i];
    }
    return null;
  }

  /* ---------------- 状态 ---------------- */
  function defaultMood() {
    return { light: 20, stage: 0, lastSeen: Date.now() };
  }
  function load() {
    var m = S.get(S.KEYS.mood, null);
    if (!m || typeof m !== "object") m = defaultMood();
    if (typeof m.light !== "number") m.light = 20;
    if (typeof m.stage !== "number") m.stage = 0;
    if (typeof m.lastSeen !== "number") m.lastSeen = Date.now();
    m.light = window.Aura.util.clamp(m.light, 20, 100);
    return m;
  }
  var mood = load();

  function save() {
    S.set(S.KEYS.mood, mood);
    bus.emit("mood:change", { light: mood.light, stage: mood.stage });
  }

  /* 轮次计数（用于"轮次达 10 的倍数"） */
  var turns = S.get("aura_turns", 0) || 0;

  /* 当前情绪（每轮） */
  var face = S.get(S.KEYS.moodFace, null) || { type: "calm", intensity: 0, turns: 0 };
  var forcedCalm = false;   /* 自动降档到平静，直到情绪回升 */

  function saveFace() {
    S.set(S.KEYS.moodFace, face);
    bus.emit("face:change", { type: face.type, intensity: face.intensity, turns: face.turns });
  }

  /* ---------------- 关系状态注入（11.6） ---------------- */
  var STAGE_WORD = { 0: "初识", 1: "熟悉", 2: "默契" };

  function systemLine() {
    if (!cfg.moodOn) return "";
    var word = STAGE_WORD[mood.stage] || "初识";
    if (cfg.coupleOn) word = "亲近";
    return "当前关系状态：" + word + "（光亮 " + mood.light + "/100）。\n" +
      "允许你在合适的时候流露一点温度，例如\"今天见到你，我这儿亮了一点\"。\n" +
      "但不要频繁提及状态数值，不要把它变成期待或要求。";
  }

  /* 情绪注入（12.6） */
  function emotionLine() {
    if (!cfg.moodOn) return "";
    if (!face.type || face.type === "calm") return "";
    var label = window.Aura.EMOTION_LABEL[face.type] || "安稳";
    return "此刻情绪：" + label + "（强度" + face.intensity + "），已持续" + face.turns + "轮。\n" +
      "用符合这个情绪的短句回应，不要说明你在什么情绪里，不要提\"情绪\"这个词。";
  }

  /* ---------------- 光亮值规则（11.3） ---------------- */
  function bump(delta) {
    mood.light = window.Aura.util.clamp(mood.light + delta, 20, 100);
  }

  function stageUp() {
    var s = mood.stage;
    if (mood.light >= 95) s = 2;
    else if (mood.light >= 80) s = 1;
    if (s > mood.stage) mood.stage = s;   /* 只升不降 */
  }

  /* 连续使用天数：昨天/前天有记录就算连续 */
  function dayKey(ts) {
    var d = new Date(ts);
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
  }
  function history() {
    var h = S.get(S.KEYS.moodHistory, null);
    if (!Array.isArray(h)) h = [];
    return h;
  }
  function recordToday() {
    var h = history();
    var k = dayKey(Date.now());
    var found = false;
    for (var i = 0; i < h.length; i++) {
      if (h[i].d === k) { h[i].l = mood.light; h[i].s = mood.stage; found = true; break; }
    }
    if (!found) h.push({ d: k, l: mood.light, s: mood.stage });
    if (h.length > 90) h = h.slice(h.length - 90);
    S.set(S.KEYS.moodHistory, h);
    return h;
  }

  /* 冷却：长期不对话，每天最多 -2，最低 20 */
  function coolDown() {
    var now = Date.now();
    var last = mood.lastSeen || now;
    var days = Math.floor((now - last) / 86400000);
    if (days > 0) {
      var dec = Math.min(days * 2, 2 * days);   /* 每天 2 点 */
      mood.light = window.Aura.util.clamp(mood.light - dec, 20, 100);
      mood.lastSeen = now;
      return days;
    }
    mood.lastSeen = now;
    return 0;
  }

  /* 连续使用 3 天 → +5 */
  function streakBonus() {
    var h = history();
    if (h.length < 3) return 0;
    var today = new Date();
    var days = [];
    for (var i = 0; i < 3; i++) {
      var d = new Date(today.getTime() - i * 86400000);
      days.push(dayKey(d.getTime()));
    }
    var set = {};
    h.forEach(function (x) { set[x.d] = true; });
    var ok = days.every(function (d) { return set[d]; });
    return ok ? 5 : 0;
  }

  /* ---------------- 情绪判定（12.2 / 12.8） ---------------- */
  function detect(text) {
    var t = String(text || "");
    var lvl = window.Aura.FACE_LEVELS[cfg.faceLevel] || window.Aura.FACE_LEVELS.normal;
    var mul = lvl.mul;

    /* 自动降档优先级最高（12.8） */
    if (hit(t, NEGATIVE_HARD) || hit(t, NEGATIVE_STRONG)) {
      return { type: "tender", intensity: mul > 0 ? 2 : 0, forceCalm: true };
    }
    if (mul === 0) {
      /* 平静档：只注入安稳与心疼 */
      return { type: (hit(t, TENDER) ? "tender" : "calm"), intensity: hit(t, TENDER) ? 1 : 0, forceCalm: false };
    }

    if (hit(t, JEALOUS) && cfg.coupleOn) {
      return { type: "jealous", intensity: 1, forceCalm: false };
    }
    if (hit(t, ANGRY)) return { type: "angry", intensity: Math.min(lvl.cap, 2), forceCalm: false };
    if (hit(t, LOW)) return { type: "low", intensity: Math.min(lvl.cap, 2), forceCalm: false };
    if (hit(t, STIFLED)) return { type: "stifled", intensity: Math.min(lvl.cap, 1), forceCalm: false };
    if (hit(t, HAPPY)) return { type: "happy", intensity: Math.min(lvl.cap, 2), forceCalm: false };
    if (hit(t, TENDER)) return { type: "tender", intensity: Math.min(lvl.cap, 2), forceCalm: false };
    return { type: "calm", intensity: 0, forceCalm: false };
  }

  /* ---------------- 对外 API ---------------- */
  var api = {
    init: function () {
      var days = coolDown();
      if (days > 0) {
        /* 冷却后可能掉档，但关系阶段只升不降 */
        stageUp();
      }
      var bonus = streakBonus();
      if (bonus) { bump(bonus); stageUp(); }
      recordToday();
      save();
      api.refreshDot();
    },

    state: function () { return { light: mood.light, stage: mood.stage }; },

    /* 用户发出一条消息时调用：更新光亮值 + 判定本轮情绪 */
    onUserMessage: function (text) {
      bump(1);                                     /* 主动发消息 +1 */
      if (hit(String(text), WARM)) bump(3);        /* 表达感谢或温柔 +3 */
      turns++;
      S.set("aura_turns", turns);
      if (turns % 10 === 0) bump(2);               /* 轮次达 10 的倍数 +2 */
      stageUp();
      recordToday();
      save();

      var d = detect(text);
      if (d.forceCalm) forcedCalm = true;

      /* 负面情绪最多持续 2 轮（第 3 轮回安稳） */
      if (forcedCalm) {
        face = { type: "tender", intensity: d.intensity, turns: face.type === "tender" ? face.turns : 0 };
      } else if (face.type !== "calm" && NEGATIVE_TYPES.indexOf(face.type) !== -1 && face.turns >= 2) {
        face = { type: "calm", intensity: 0, turns: 0 };
      } else {
        face = { type: d.type, intensity: d.intensity, turns: 0 };
      }
      saveFace();
      api.refreshDot();
      return { type: face.type, intensity: face.intensity };
    },

    /* 一轮结束（助手已回复）：推进衰减 */
    onTurnEnd: function () {
      face.turns = (face.turns || 0) + 1;
      if (NEGATIVE_TYPES.indexOf(face.type) !== -1 && face.turns > 2) {
        face = { type: "calm", intensity: 0, turns: 0 };
      }
      /* 情绪明显回升后解除强制平静 */
      if (forcedCalm && face.type === "happy") forcedCalm = false;
      saveFace();
    },

    currentEmotion: function () { return { type: face.type, intensity: face.intensity }; },

    systemLine: systemLine,
    emotionLine: emotionLine,

    stageWord: function () {
      if (cfg.coupleOn) return "亲近";
      return STAGE_WORD[mood.stage] || "初识";
    },

    tempWord: function () {
      var l = mood.light;
      if (l <= 35) return "安静";
      if (l <= 55) return "平稳";
      if (l <= 75) return "暖暖的";
      if (l <= 90) return "明亮";
      return "很安稳";
    },

    history: history,

    /* 指示灯 */
    refreshDot: function () {
      var dot = document.getElementById("mood-dot");
      if (!dot) return;
      var stage = mood.stage;
      dot.setAttribute("data-stage", String(stage));
      dot.classList.toggle("warm", stage >= 1);
      dot.classList.toggle("gold", stage >= 2);
    },

    /* 曲线用的数据（最多 7 天） */
    chartData: function () {
      var h = history().slice(-7);
      return h.map(function (x) { return x.l; });
    },

    note: function () {
      var h = history();
      if (h.length < 2) return "再聊几次，这里会慢慢有形状。";
      var pts = api.chartData();
      if (pts.length < 2) return "再聊几次，这里会慢慢有形状。";
      var first = pts[0], last = pts[pts.length - 1];
      if (last >= first) return "这段时间你来得比较多，它一直是暖的。";
      return "这几天安静了一些。这是正常的，它不会因此难过，也不会等你。";
    },

    /* 供设置里的「颜色变化预览」使用 */
    previewSequence: function () {
      var list = ["calm", "happy", "tender", "angry", "low", "stifled", "jealous", "curious"];
      var i = 0;
      function step() {
        if (i >= list.length) {
          window.Aura.apply.tint(null);
          return;
        }
        var e = list[i++];
        window.Aura.apply.tint(e);
        setTimeout(step, 1200);
      }
      step();
    }
  };

  window.Aura.mood = api;
})();
