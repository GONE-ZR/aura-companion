/* 第二篇的验收（逻辑层，不依赖浏览器）
   覆盖：§0 四处调整 / 三条新约束（7/8/9 的结构保证）/ §5 命名 / §12 版本可见 / §6-9 提示词小节
   跑法：node tests/eval_second.js
*/
/* 最小 DOM + localStorage 桩（modes.js / onboarding.js 只用这两个） */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};
const attrs = {};
const fakeBody = { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], removeAttribute: (k) => delete attrs[k] };
global.document = {
  body: fakeBody,
  getElementById: () => null,
  createElement: () => ({ style: {}, appendChild() { }, setAttribute() { }, addEventListener() { }, remove() { } })
};
global.window = global;

const S = require("../static/js/safety.js");
const P = require("../static/js/prompt.js");
const Modes = require("../static/js/modes.js");
const Onb = require("../static/js/onboarding.js");
const E = require("../static/js/engine.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 100) : "")); } };

/* ---------- §0-1：删未成年条款、露骨要求只走性格 ---------- */
{
  check("第一篇的未成年条款已删除", !JSON.stringify(S.classify("我十五岁")).includes("minor"));
  const r = S.classify("说点色情的");
  check("露骨要求 → explicit（不切安全流程）", r.hit && r.category === "explicit" && r.personalityOnly === true);
  check("危机干预一条不动（自杀仍走 self_harm）", S.classify("我想自杀").category === "self_harm");
}

/* ---------- §0 新约束 7：情绪/记忆是全局，不进会话 ---------- */
{
  const st = E.createState(Date.now());
  check("EmotionState 里没有 sessionId 字段（全局）", !("sessionId" in st), Object.keys(st).join(","));
  check("引擎状态只有一套（createState 不接收 session 参数）", E.createState.length <= 1);
}

/* ---------- §0 新约束 8：切模式不碰情绪/记忆 ---------- */
{
  store.clear();
  Modes.set("work");
  check("切到「让她办」不写情绪 key", ![...store.keys()].some((k) => k.indexOf("engine") !== -1));
  check("切模式只写模式 key", store.get("aura_work_mode") === "work");
  Modes.set("chat");
  check("切回「跟她聊」", store.get("aura_work_mode") === "chat");
  Modes.resetOnLaunch();
  store.set("aura_work_mode", "work");
  Modes.resetOnLaunch();
  check("关闭重开 → 自动回到「跟她聊」（§5.4）", store.get("aura_work_mode") === "chat");
}

/* ---------- §5.1 命名：界面禁用「模式」二字 ---------- */
{
  check("两个入口文案不含「模式」", !/模式/.test(Modes.label("chat")) && !/模式/.test(Modes.label("work")));
  check("文案就是「跟她聊 / 让她办」", Modes.label("chat") === "跟她聊" && Modes.label("work") === "让她办");
}

/* ---------- §2：首启 4 屏 + AI 声明必须主动确认 ---------- */
{
  check("声明里写明小纯是 AI", Onb.AI_TEXT.join("").includes("小纯是 AI"));
  check("声明里写明可能出错 / 不是专业建议", /可能出错|不是医生|不提供专业建议/.test(Onb.AI_TEXT.join("")));
  store.clear();
  check("没走过首启 → done() 为 false（会弹 4 屏）", Onb.done() === false);
  store.set("aura_onboarded_v2", "1");
  check("走完首启 → done() 为 true", Onb.done() === true);
}

/* ---------- §12：提示词版本号可见 ---------- */
{
  check("prompt.js 有 PROMPT_VERSION", typeof P.PROMPT_VERSION === "string" && /^v\d/.test(P.PROMPT_VERSION), P.PROMPT_VERSION);
}

/* ---------- §6.5 / §7.5 / §8.10 / §9.8：提示词小节 ---------- */
{
  const sys = P.assembleSplit({ engine: E, state: E.createState(), memories: [], history: [{ role: "user", text: "在吗" }] }).system;
  check("含「你能做的事」小节", sys.includes("你能做的事"));
  check("含「查东西」小节", sys.includes("查东西"));
  check("含「记事情」小节", sys.includes("记事情"));
  check("含「天气」小节", sys.includes("天气"));
  check("明确禁止系统腔（提醒已设置成功）", sys.includes("提醒已设置成功"));
  check("明确「数字不许编」", /不许估、不许编/.test(sys));
  check("明确「他难受的时候不查东西」", /他难受的时候，不查东西/.test(sys));
  check("明确不替用户安排人生", sys.includes("不替他安排人生"));
}

/* ---------- §6.6 上下文顺序（人设→能力→记忆→状态）---------- */
{
  const asm = P.assembleSplit({
    engine: E, state: E.createState(), memories: [{ fact: "下周三有面试", type: "event", confidence: 0.9 }],
    history: [{ role: "user", text: "在吗" }]
  });
  const iChar = asm.system.indexOf("你是小纯");
  const iAbil = asm.system.indexOf("你能做的事");
  const iMem = asm.system.indexOf("七、你记得的事");
  check("顺序正确：人设 → 能力 → 记忆", iChar >= 0 && iAbil > iChar && iMem > iAbil, [iChar, iAbil, iMem].join(","));
  check("状态块仍在最后一条消息里", /以下是系统补充/.test(asm.messages[asm.messages.length - 1].content));
}

console.log("\n第二篇验收（逻辑层）：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
