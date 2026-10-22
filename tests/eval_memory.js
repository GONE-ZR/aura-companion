/* 记忆系统验收（任务书 §三 + §十一 第 9 条）
   跑法：node tests/eval_memory.js
*/
/* 给 Node 一个最小 localStorage 桩 */
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const M = require("../static/js/memfacts.js");
const P = require("../static/js/prompt.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + x : "")); } };

/* 1. 置信度只三档 */
{
  check("0.95 → 0.9", M.normConfidence(0.95) === 0.9);
  check("0.8 → 0.7", M.normConfidence(0.8) === 0.7);
  check("0.55 → 0.5", M.normConfidence(0.55) === 0.5);
  check("乱填 → 0.5（往低取）", M.normConfidence("abc") === 0.5);
}

/* 2. 增 / 去重 */
{
  store.clear();
  const r1 = M.add([
    { fact: "下周三有面试", type: "event", when: "2026-10-28", confidence: 0.9 },
    { fact: "不太吃香菜", type: "preference", confidence: 0.7 }
  ]);
  check("新增两条", r1.list.length === 2, String(r1.list.length));
  const r2 = M.add([{ fact: "下周三有面试", type: "event", confidence: 0.7 }]);
  check("重复的不会再存一条", r2.list.length === 2, String(r2.list.length));
  check("重复时保留更高置信度", r2.list.find((m) => m.fact.includes("面试")).confidence === 0.9);
}

/* 3. 删除后永不进上下文 */
{
  const list = M.load();
  const target = list.find((m) => m.fact.includes("香菜"));
  M.remove(target.id);
  const after = M.load();
  check("删除后 status=deleted", after.find((m) => m.id === target.id).status === "deleted");
  check("forPrompt 里没有它", !M.forPrompt().some((m) => m.id === target.id));
  const got = M.retrieve("香菜", { list: after });
  check("检索也检不到它", !got.some((m) => m.id === target.id));
  const block = P.buildMemoriesSection(after);
  check("提示词里也没有它", block.indexOf("香菜") === -1, block);
}

/* 4. 检索 top-8 + 相关度 */
{
  store.clear();
  const batch = [];
  for (let i = 0; i < 12; i++) batch.push({ fact: "无关的事" + i, type: "event", confidence: 0.9 });
  batch.push({ fact: "下周三有面试要准备自我介绍", type: "event", when: "2026-10-28", confidence: 0.9 });
  M.add(batch);
  const top = M.retrieve("面试要准备什么", {});
  check("检索最多 8 条", top.length <= 8, String(top.length));
  check("相关的那条排第一", top[0].fact.indexOf("面试") > -1, top[0].fact);
}

/* 5. 抽取解析 */
{
  const good = M.parseExtraction('```json\n[{"fact":"养了只猫","type":"person","confidence":0.7}]\n```');
  check("容忍 ```json 包裹", good.length === 1 && good[0].fact === "养了只猫");
  check("type 非法的条目被丢弃", M.parseExtraction('[{"fact":"x","type":"emotion","confidence":0.9}]').length === 0);
  check("非 JSON 输出 → 空数组", M.parseExtraction("我觉得他挺好的").length === 0);
  check("空输出 → 空数组", M.parseExtraction("").length === 0);
  check("越界置信度被归一", M.parseExtraction('[{"fact":"y","type":"event","confidence":0.99}]')[0].confidence === 0.9);
  check("每 7 轮抽一次", M.shouldExtract(7) && !M.shouldExtract(6));
}

/* 6. 第 9 条：0.5 置信度不被当事实复述 */
{
  store.clear();
  M.add([
    { fact: "可能养了只猫", type: "person", confidence: 0.5 },
    { fact: "下周三有面试", type: "event", when: "2026-10-28", confidence: 0.9 }
  ]);
  const block = P.buildMemoriesSection(M.load());
  check("0.5 置信度在提示词里标「不太确定」", /可能养了只猫（不太确定）/.test(block), block);
  check("0.9 置信度标「确定」", /下周三有面试（2026-10-28，确定）/.test(block), block);
  check("提示词里明确写了「只当猜测，不要当事实复述」",
    /不太确定.*只当猜测|只当猜测/.test(P.SEC_MEMORIES));
}

/* 7. 统计（L3 回顾页用） */
{
  const s = M.stats();
  check("统计含 active / deleted / 三类型计数",
    typeof s.active === "number" && typeof s.deleted === "number" && !!s.byType,
    JSON.stringify(s));
}

console.log("\n记忆系统验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
