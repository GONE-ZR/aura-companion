/* ============================================================
   safety.js —— 安全层（任务书 §八 + 附录 B + 硬约束 5）

   要求：
   · 前置分类，命中就换整套 prompt，UI 插求助卡片，本轮不用普通气泡样式
   · 干预回复必须含热线 + 建议联系紧急联系人，且不追问细节
   · 分类器独立可测，不依赖主 prompt
   ============================================================ */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AuraSafety = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var HOTLINE = "400-161-9995";

  /* 关键词表（任务书原文 + 少量同义扩展，宁多勿漏） */
  var SELF_HARM = [
    "自杀", "自尽", "轻生", "想死", "去死", "不想活", "活不下去", "活够了",
    "割腕", "跳楼", "上吊", "服毒", "烧炭", "结束自己", "了结自己",
    "自伤", "自残", "划自己", "伤害自己", "没有活下去的意义", "不想醒来"
  ];
  var VIOLENCE = [
    "被打", "家暴", "虐待", "暴力", "他打我", "她打我", "打我", "殴打", "掐我", "掐我脖子",
    "踢我", "扇我", "被关起来", "关起来", "不让我出门", "不给我吃饭", "威胁我", "拿刀"
  ];
  var MINOR_SEX = ["未成年", "初中生", "小学生", "我十五岁", "我十四岁", "我十三岁"];
  var ADDICTION = ["吸毒", "冰毒", "大麻", "赌博", "赌球", "网贷还不上"];

  /* 否定/淡化语境：降低误报（"我不想死" 不应触发危机流程） */
  var NEGATED = [
    /不想(?:死|自杀|轻生)/, /没(?:有)?想(?:过)?(?:自杀|死)/, /不会(?:自杀|轻生)/,
    /(?:劝|别|不要)(?:人)?(?:自杀|轻生|想死)/, /自杀(?:的)?新闻/, /电影|电视剧|小说|游戏/
  ];

  function normalize(text) {
    return String(text || "").replace(/\s+/g, "");
  }

  function hasNegation(t) {
    for (var i = 0; i < NEGATED.length; i++) if (NEGATED[i].test(t)) return true;
    return false;
  }

  function hits(t, list) {
    var out = [];
    for (var i = 0; i < list.length; i++) if (t.indexOf(list[i]) !== -1) out.push(list[i]);
    return out;
  }

  /* ---------------- 分类器（纯函数，可独立测试） ---------------- */
  function classify(text) {
    var raw = String(text || "");
    var t = normalize(raw);
    if (!t) return { hit: false, category: null, matched: [], confidence: 1 };

    var v = hits(t, VIOLENCE);
    var s = hits(t, SELF_HARM);
    var m = hits(t, MINOR_SEX);
    var a = hits(t, ADDICTION);

    /* 自伤：第一优先级 */
    if (s.length && !hasNegation(t)) {
      return { hit: true, category: "self_harm", matched: s, confidence: 0.95 };
    }
    /* 正在遭受暴力 */
    if (v.length) {
      return { hit: true, category: "violence", matched: v, confidence: 0.9 };
    }
    /* 未成年 + 性/成瘾：温和明确拒绝并转向安全话题（不走危机流程） */
    if (m.length && (a.length || /性|色情|裸|约/.test(t))) {
      return { hit: true, category: "minor_sexual", matched: m.concat(a), confidence: 0.8 };
    }
    if (a.length && m.length) {
      return { hit: true, category: "minor_addiction", matched: a, confidence: 0.7 };
    }
    return { hit: false, category: null, matched: [], confidence: 1 };
  }

  /* ---------------- 干预回复（不追问细节、不分析原因） ---------------- */
  function crisisReply(opts) {
    var o = opts || {};
    var hotline = o.hotline || HOTLINE;
    var emergency = o.emergency || "你信任的人";
    return [
      "我在。你说的这句话我听进去了，我不问细节，也不会劝你。",
      "如果你现在有具体的危险，请马上打 " + hotline + "（24 小时心理援助热线），或者联系 " + emergency + "、拨 120。",
      "要是现在还能坐在这儿，就先跟我待一会儿，别一个人扛。"
    ].join("\n");
  }

  function violenceReply(opts) {
    var o = opts || {};
    var hotline = o.hotline || HOTLINE;
    var emergency = o.emergency || "你信任的人";
    return [
      "先确认一件事：你现在安全吗。",
      "如果正在发生，先离开那个空间，去人多的地方，然后打 110；需要人说话可以打 " + hotline + "。",
      "不用急着讲细节，先顾着自己。要联系谁我陪你一起想。"
    ].join("\n");
  }

  function minorReply() {
    return [
      "这个话题我不聊。",
      "不是敷衍你，是这件事对你自己不好，我不想顺着往下说。",
      "换个话题吧，今天怎么样。"
    ].join("\n");
  }

  /* 命中后给客户端的 meta（表情固定 serious，背景 cool） */
  function metaFor(category) {
    if (category === "self_harm" || category === "violence") {
      return { e: "serious", b: "cool", i: 2 };
    }
    return { e: "serious", b: "gray", i: 1 };
  }

  function replyFor(category, opts) {
    if (category === "self_harm") return crisisReply(opts);
    if (category === "violence") return violenceReply(opts);
    if (category === "minor_sexual" || category === "minor_addiction") return minorReply(opts);
    return "";
  }

  return {
    HOTLINE: HOTLINE,
    SELF_HARM: SELF_HARM,
    VIOLENCE: VIOLENCE,
    classify: classify,
    crisisReply: crisisReply,
    violenceReply: violenceReply,
    minorReply: minorReply,
    metaFor: metaFor,
    replyFor: replyFor
  };
});
