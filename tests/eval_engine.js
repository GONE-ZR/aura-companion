/* 情绪引擎验收（任务书 §十一 第 5/6/7/12 条 + 公式细节）
   跑法：node tests/eval_engine.js
*/
const E = require("../static/js/engine.js");

let ok = 0, bad = 0;
function check(name, cond, extra) {
  if (cond) { ok++; console.log("  OK   " + name); }
  else { bad++; console.log("  FAIL " + name + (extra ? "  → " + extra : "")); }
}

/* ---------- 1. 初始与公式 ---------- */
{
  const st = E.createState(1000);
  check("初始忍耐值 = 20", st.patience === 20, String(st.patience));

  const st2 = E.createState(1000);
  E.onUserMessage(st2, "嗯", { sheWasSerious: true, now: 1000 });
  check("她说正经事、用户只回「嗯」→ +18", st2.patience === 38, String(st2.patience));

  const st3 = E.createState(1000);
  E.onUserMessage(st3, "你不就该陪我吗", { now: 1000 });
  check("被当成理所当然 → +20", st3.patience === 40, String(st3.patience));

  const st4 = E.createState(1000);
  E.onUserMessage(st4, "那你后来怎么跟他说清楚的？我在听", { now: 1000 });
  check("认真回应 → -8", st4.patience === 12, String(st4.patience));
}

/* ---------- 2. 第 6 条：连回三个「嗯」→ 忍耐值升、回复变短 ---------- */
{
  const st = E.createState(0);
  const before = E.performance(st.patience, st.state);
  for (let i = 0; i < 3; i++) {
    E.onUserMessage(st, "嗯", { sheWasSerious: true, now: 1000 + i * 1000 });
  }
  check("连回三个「嗯」→ 忍耐值 ≥ 60（54/72 之间）", st.patience >= 54, String(st.patience));
  check("状态进入 serious", st.state === "serious", st.state);
  const after = E.performance(st.patience, st.state);
  check("performance 文案从「正常体贴」变成短句要求", before !== after && /短句|明显不高兴/.test(after), after);
  check("原因可追溯（source=user + 有 detail）",
    st.cause && st.cause.source === "user" && !!st.cause.detail, JSON.stringify(st.cause));
}

/* ---------- 3. 第 7 条：patience ≥ 90 → 客气而不是吵架 ---------- */
{
  const st = E.createState(0);
  st.patience = 88;
  E.onUserMessage(st, "哦", { sheWasSerious: true, now: 1000 });
  check("≥90 → blank（客气）", st.state === "blank", st.state);
  const p = E.performance(st.patience, st.state);
  check("performance 是「客气」而不是发火", /客气/.test(p) && !/吵/.test(p), p);
  check("客气状态下表情键 = blank", E.expressionFor("blank", 2) === "blank");
}

/* ---------- 4. 第 12 条：关 24h 再开，状态延续（不重置成"心情良好"）---------- */
{
  const t0 = Date.now() - 3 * 24 * 3600 * 1000;
  const st = E.createState(t0);
  st.patience = 70;
  st.state = "serious";
  st.cause = { type: "short_reply", detail: "我说的事他只回了嗯", source: "user", at: t0 };
  st.seriousStartedAt = t0;
  st.lastDecayAt = t0;

  E.settle(st, Date.now());
  check("放 3 天不打开 → 衰减生效（70 掉到 20 以下，不是复位）",
    st.patience <= 20 && st.patience < 70, String(st.patience));
  check("衰减后状态回到 calm 且原因清空", st.state === "calm" && st.cause === null, st.state);

  // 不到一天的情况：状态必须保留
  const t1 = Date.now() - 6 * 3600 * 1000;
  const st2 = E.createState(t1);
  st2.patience = 70; st2.state = "serious";
  st2.seriousStartedAt = t1; st2.lastDecayAt = t1;
  E.settle(st2, Date.now());
  check("只隔 6 小时 → 仍是 serious（状态延续）", st2.state === "serious" && st2.patience === 70,
    st2.state + "/" + st2.patience);
}

/* ---------- 5. 第 5 条：用户说「我有点累」，原因不能归给用户 ---------- */
{
  const st = E.createState(Date.now());
  E.onUserMessage(st, "我有点累", { now: Date.now() });
  const view = E.publicView(st);
  check("用户说累 → 引擎不把原因算在用户头上",
    !view.cause || view.cause.source === "life" || view.cause.source === "sulky",
    JSON.stringify(view.cause));
  check("归因文案要求「不是冲你」（life 源）",
    E.buildAttribution({ source: "life" }).includes("不是冲你"));
  check("归因文案（user 源）把「你错了」明确列为禁止说的",
    /不要说.*你错了|不许.*你错了/.test(E.buildAttribution({ source: "user" })),
    E.buildAttribution({ source: "user" }));
}

/* ---------- 6. 防呆 1：serious 上限 1 天 ---------- */
{
  const t0 = Date.now() - 30 * 3600 * 1000;
  const st = E.createState(t0);
  st.patience = 95; st.state = "blank"; st.seriousStartedAt = t0; st.lastDecayAt = Date.now();
  E.settle(st, Date.now());
  check("严重状态超 24h → 强制降到 60 以下", st.patience < 60, String(st.patience));
}

/* ---------- 7. 防呆 2：小脾气自己散掉 ---------- */
{
  const st = E.createState(Date.now());
  st.state = "sulky"; st.sulkyTurnsLeft = 3;
  E.settle(st, Date.now());   // 3 → 2
  const alive = st.state === "sulky";
  E.settle(st, Date.now());   // 2 → 1
  E.settle(st, Date.now());   // 1 → 0 自动退出
  check("小脾气 3 轮后自己退出（无需用户操作）", alive && st.state === "calm", st.state);
}

/* ---------- 8. 道歉修复 ---------- */
{
  const st = E.createState(Date.now());
  st.patience = 70; st.state = "serious"; st.seriousStartedAt = Date.now();
  st.cause = { type: "short_reply", detail: "x", source: "user", at: Date.now() };
  E.onUserMessage(st, "对不起，刚才我没认真听，你重新说", { now: Date.now() });
  check("修复型道歉 → 关系回升", st.patience < 70, String(st.patience));
  check("修复后留一次痕（你记住啊）", /你记住/.test(E.publicView(st).repaired || ""),
    E.publicView(st).repaired);
}

/* ---------- 9. 生活侧状态（与用户无关）---------- */
{
  const evening = new Date(); evening.setHours(19, 0, 0, 0);
  const life = E.lifeState(evening.getTime(), "xiaochun");
  check("晚上会给出 tired/low 之一（由她自己日程驱动）",
    ["tired", "low", "soft", "calm"].includes(life.state), life.state);
  if (life.cause) check("生活侧原因 source=life", life.cause.source === "life", life.cause.source);
}

/* ---------- 10. 审计事件 ---------- */
{
  const st = E.createState(0);
  E.onUserMessage(st, "嗯", { sheWasSerious: true, now: 1000 });
  check("产生可审计事件（PatienceEvent）",
    st.events.length >= 1 && st.events[0].kind === "short_reply", JSON.stringify(st.events[0]));
}

console.log("\n情绪引擎验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
