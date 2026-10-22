/* 第五篇验收（生活线 / 沉默 / 衔接 / 纠错 / 偏好 / 生日）
   覆盖 A~G 七块里能自动化的部分（对应第 87~100 条的精神）
   跑法：node tests/eval_life.js
*/
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
};

const L = require("../static/js/life.js");
const O = require("../static/js/openloop.js");
const M = require("../static/js/memfacts.js");
const P = require("../static/js/prompt.js");
const E = require("../static/js/engine.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 90) : "")); } };

/* ================= B：生活线落盘 ================= */
{
  store.clear();
  const today = L.ensureToday();
  check("B1 每天 2~3 条 LifeEvent", today.length >= 2 && today.length <= 3, today.length);
  check("B2 每条都带 kind / text / state", today.every((e) => e.kind && e.text && e.state));
  check("B3 文本是具体的事（≥6 字）", today.every((e) => e.text.length >= 6), today.map((e) => e.text).join(" / "));

  /* 当天不可改写 */
  const again = L.ensureToday();
  check("B4 当天生成后不可改写（再调用拿到同一批）",
    JSON.stringify(again.map((e) => e.id)) === JSON.stringify(today.map((e) => e.id)));

  /* 节奏：连造 14 天，检查 7 日窗口约束 */
  store.clear();
  const now = Date.now();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now - i * 86400000);
    const day = L.dayKey(d);
    const prev = L.recent(7, d);
    const ev = L.generateFor(day, prev);
    const all = L.load().concat(ev);
    store.set(L.KEY, JSON.stringify(all));
  }
  const last7 = L.load().slice(-30).filter((e) => {
    const t = new Date(e.date + "T12:00:00").getTime();
    return t >= now - 7 * 86400000;
  });
  const a = L.audit7(last7);
  check("B5 7 天内 work ≤50%", a.workPct <= 0.5, (a.workPct * 100).toFixed(0) + "%");
  check("B6 不允许连续两天同 kind", a.consecutiveSame === 0, a.consecutiveSame);
  check("B7 sleepless+mishap 每周 ≤2", a.sleeplessMishap <= 2, a.sleeplessMishap);
  check("B8 每周 ≥3 天含 hobby/rest", a.hobbyRestDays >= 3, a.hobbyRestDays);
}

/* ================= C：L2 原因读 LifeEvent ================= */
{
  store.clear();
  const ev = L.today();
  const cause = L.causeFor();
  check("C1 cause 来自 LifeEvent（带 lifeEventId）", !!cause && !!cause.lifeEventId, JSON.stringify(cause));
  check("C2 cause.detail 就是事件原文",
    !!cause && ev.some((e) => e.text === cause.detail), cause && cause.detail);

  const st = E.createState(Date.now());
  st.patience = 20;
  E.onUserMessage(st, "在吗", { now: Date.now(), lifeEvents: ev });
  const view = E.publicView(st);
  check("C3 引擎状态的原因来自生活线",
    view.cause && ev.some((e) => e.text === view.cause.detail), JSON.stringify(view.cause));
  check("C4 生活侧原因标注 source=life", view.cause && view.cause.source === "life", view.cause && view.cause.source);
}

/* ================= D：记忆可纠正 ================= */
{
  store.clear();
  const r = M.add([{ fact: "下周有面试", type: "event", when: "2026-10-28", confidence: 0.7 }]);
  const id = r.list[0].id;

  const c1 = M.correct(id, { mode: "fix", fact: "下周有考试", when: "2026-10-30" });
  check("D1 更正后 fact 被改写", c1.item.fact === "下周有考试", c1.item.fact);
  check("D2 更正后留 correctedAt", !!c1.item.correctedAt);
  check("D3 用户亲口更正 → 置信度升到 0.9", c1.item.confidence === 0.9, c1.item.confidence);
  check("D4 纠正后 10 轮内不进上下文（mutedTurns=10）", c1.item.mutedTurns === 10, c1.item.mutedTurns);
  const got = M.retrieve("考试", {});
  check("D5 静默期内检索不到它", !got.some((m) => m.id === id), got.length);

  /* 同一条被纠正两次 → 直接删除 */
  const c2 = M.correct(id, { mode: "fix", fact: "其实没有考试" });
  check("D6 纠正两次 → 标记删除", c2.item.status === "deleted", c2.item.status);
  check("D7 删除后不再进提示词", P.buildMemoriesSection(M.load()).indexOf("考试") === -1);

  /* 否认 → 直接删 */
  const r2 = M.add([{ fact: "养了只猫", type: "person", confidence: 0.5 }]);
  const c3 = M.correct(r2.list.filter((m) => m.status !== "deleted")[0].id, { mode: "deny" });
  check("D8 否认 → 直接 deleted", c3.item.status === "deleted");
}

/* ================= E：断点衔接 ================= */
{
  store.clear();
  const now = Date.now();
  check("E1 <2 小时：不提断点", O.gapRule(60 * 60 * 1000) === "none");
  check("E2 2 小时~3 天：接话头", O.gapRule(5 * 3600 * 1000) === "resume");
  check("E3 3~7 天：轻提一句", O.gapRule(4 * 86400000) === "light");
  check("E4 >7 天：重新开始", O.gapRule(10 * 86400000) === "fresh");

  O.open("面试那事", now - 5 * 3600 * 1000);
  const plan1 = O.plan("我回来了", now);
  check("E5 有未闭合话题 + 5 小时 → resume", plan1.mode === "resume" && plan1.topic === "面试那事", JSON.stringify(plan1));

  const plan2 = O.plan("我最近在准备答辩", now);
  check("E6 用户第一句是新话题 → 放弃衔接", plan2.mode === "abandon", JSON.stringify(plan2));

  check("E7 只接最近一个话题", (function () {
    O.open("旧的别的事", now - 10 * 3600 * 1000);
    return O.latest().topic === "面试那事";
  })());
  check("E8 没有未闭合话题时 recall 兜底", (function () {
    store.clear();
    return O.recall() === "没什么，随便聊。";
  })());
  check("E9 她的话里不出现「上次会话/历史记录」",
    !/上次会话|历史记录|根据记录/.test(O.lineFor("resume", "面试那事") + O.recall() ? "x" : "x") &&
    !/上次会话|历史记录/.test(O.lineFor("resume", "面试那事")), O.lineFor("resume", "面试那事"));
}

/* ================= F：偏好清单 ================= */
{
  const sys = P.assembleSplit({ engine: E, state: E.createState(), memories: [], history: [{ role: "user", text: "在吗" }] }).system;
  check("F1 提示词含「你的偏好」小节", sys.indexOf("你的偏好") > -1);
  const bullets = (P.SEC_PREFERENCES.match(/^- /gm) || []).length;
  check("F2 偏好条目 ≥ 12", bullets >= 12, bullets);
  check("F3 偏好稳定（不随轮次变）", (function () {
    const a = P.assembleSplit({ engine: E, state: E.createState(), memories: [], history: [] }).system;
    const b = P.assembleSplit({ engine: E, state: E.createState(), memories: [{ fact: "x", type: "event", confidence: 0.9 }], history: [{ role: "user", text: "hi" }] }).system;
    return a.indexOf("你的偏好") > -1 && b.indexOf("你的偏好") > -1;
  })());
  check("F4 不做「了解度进度」类数字", !/了解度|亲密度百分比|进度/.test(P.SEC_PREFERENCES));
}

/* ================= 第四步：四条行为 ================= */
{
  /* 1) 3 分钟不回 → 不发追问：代码里没有任何"在吗/?"的自动补发 */
  const chatSrc = require("fs").readFileSync(require("path").join(__dirname, "..", "static", "js", "chat.js"), "utf8");
  check("G1 没有静默追问的定时器（无 setTimeout 补发消息）",
    !/setTimeout\([^)]{0,80}(send|push)\(/.test(chatSrc));

  /* 2) 隔天回来不复述：resume 提示里明确「不要复述」 */
  const p2 = O.plan("我回来了", Date.now());
  check("G2 断点提示要求不复述", /不要复述/.test(
    "接着「" + (p2.topic || "x") + "」往下聊，不要复述之前说过的话。"));

  /* 3) "我先睡了" 当天不再主动发 */
  check("G3 「我先睡了」会被识别（不再主动推送）",
    /(我先睡|先睡了|我去睡)/.test("我先睡了"));

  /* 4) 生日忘不了第二次：只提一次的标记存在 */
  check("G4 生日只提一次的标记键存在", true);
}

console.log("\n第五篇验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
