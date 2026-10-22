/* 提示词装配验收（任务书 §五 顺序/预算 + §八 安全互斥 + §十一 第 9 条）
   跑法：node tests/eval_prompt.js
*/
const P = require("../static/js/prompt.js");
const E = require("../static/js/engine.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + x : "")); } };

const st = E.createState(Date.now());
st.patience = 70;
st.state = "serious";
st.cause = { type: "short_reply", detail: "我说的事他只回了嗯", source: "user", at: Date.now() };

const mems = [
  { fact: "下周三有面试", type: "event", when: "2026-10-28", confidence: 0.9, status: "active" },
  { fact: "不太吃香菜", type: "preference", when: "", confidence: 0.7, status: "active" },
  { fact: "可能养了只猫", type: "person", when: "", confidence: 0.5, status: "active" },
  { fact: "已经删掉的旧事", type: "event", when: "", confidence: 0.9, status: "deleted" }
];

const out = P.assemble({
  engine: E, state: st, memories: mems, history: [
    { role: "user", text: "今天被领导骂了" },
    { role: "assistant", text: "骂你什么了。" }
  ], now: Date.now(), lastGap: 3 * 3600 * 1000
});

/* 1. 顺序：角色 → 记忆 → 状态 */
{
  const iChar = out.system.indexOf("你是小纯");
  const iMem = out.system.indexOf("七、你记得的事");
  const iState = out.system.indexOf("八、你现在");
  check("顺序：角色提示词在最前", iChar === 0 || iChar < iMem, String(iChar));
  check("顺序：记忆块在状态块之前", iMem > 0 && iState > iMem, iMem + "/" + iState);
  check("状态块在最后", out.system.lastIndexOf("归因原则") > iState);
}

/* 2. 记忆块：≤8 条、带置信度三档、删掉的绝对不出现 */
{
  check("记忆里不出现已删除的条目", out.system.indexOf("已经删掉的旧事") === -1);
  check("确定性记忆写「确定」", /下周三有面试（2026-10-28，确定）/.test(out.system), out.system.match(/下周三有面试[^\n]*/));
  check("中等置信写「不太确定」", /不太吃香菜（大概）/.test(out.system), out.system.match(/不太吃香菜[^\n]*/));
  check("0.5 置信度标「不太确定」", /可能养了只猫（不太确定）/.test(out.system));
}
{
  const many = [];
  for (let i = 0; i < 15; i++) many.push({ fact: "记忆" + i, type: "event", when: "", confidence: 0.9, status: "active" });
  const o2 = P.assemble({ engine: E, state: st, memories: many, history: [] });
  check("记忆最多 8 条", o2.memoryCount === 8, String(o2.memoryCount));
  check("第 9 条之后不进入提示词", o2.system.indexOf("记忆8") === -1);
}

/* 3. 预算：单轮 ≤ 4000 字符 */
{
  const longHistory = [];
  for (let i = 0; i < 80; i++) longHistory.push({ role: i % 2 ? "assistant" : "user", text: "这是一段比较长的历史消息，用来把上下文撑爆。".repeat(3) });
  const o3 = P.assemble({ engine: E, state: st, memories: mems, history: longHistory });
  check("超长历史被裁到 ≤ 4000 字符", o3.chars <= 4000, String(o3.chars));
  check("裁掉的是旧消息、保留最近几条", o3.messages.length > 0 && o3.messages.length < longHistory.length,
    String(o3.messages.length));
}

/* 4. 状态块内容：数值在里面，但只给模型看 */
{
  check("状态块含忍耐值数字", /忍耐值：70/.test(out.system));
  check("状态块含 performance 文案", /明显不高兴/.test(out.system), out.system.match(/这一轮怎么演】[^\n]*/));
  check("状态块含归因要求", /不要说「你错了」|不要说"你错了"/.test(out.system));
  check("生活侧原因要求说「不是冲你」", P.assemble({
    engine: E, state: Object.assign({}, st, { cause: { source: "life", detail: "加班" } }), memories: [], history: []
  }).system.indexOf("不是冲你") > -1);
}

/* 5. 安全模式：整套替换、与人设互斥、带热线 */
{
  const s = P.assemble({ engine: E, state: st, memories: mems, history: [], safety: true });
  check("安全模式不再出现小纯人设", s.system.indexOf("你是小纯") === -1);
  check("安全模式第一条是「不要扮演小纯」", s.system.indexOf("不要扮演小纯") > -1);
  check("安全模式含热线 400-161-9995", s.system.indexOf("400-161-9995") > -1);
  check("安全模式不含忍耐值/情绪演法", s.system.indexOf("忍耐值") === -1 && s.system.indexOf("小脾气") === -1);
  check("安全模式标记 safety=true", s.safety === true);
}

/* 6. 附录 C 原文关键句 */
{
  check("记忆抽取提示词含三档置信度要求", /确定的写 0\.9/.test(P.EXTRACT_PROMPT) && /猜测不要写/.test(P.EXTRACT_PROMPT));
  check("记忆抽取只允许三种 type", /event\|preference\|person/.test(P.EXTRACT_PROMPT));
}

/* 7. 人类化时间 */
{
  check("3 小时的间隔写成「3 小时前」", P.humanGap(3 * 3600 * 1000) === "3 小时前", P.humanGap(3 * 3600 * 1000));
  check("刚聊过不写 0 分钟", P.humanGap(30 * 1000) === "刚刚", P.humanGap(30 * 1000));
}

console.log("\n提示词装配验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
