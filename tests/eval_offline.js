/* 第六篇 M1 验收：离线短句库（101/102/103/104）
   跑法：node tests/eval_offline.js
*/
global.window = global;
require("../static/js/offline-lines.js");   // 挂到 window.AuraOfflineLines
const O = require("../static/js/offline.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 90) : "")); } };

const lines = O.all();

/* 1. 规模与分桶（200~400 条、7×4、每桶 ≥6、≤14 字） */
{
  check("条数在 200~400 之间", lines.length >= 200 && lines.length <= 400, lines.length);
  const states = [...new Set(lines.map((r) => r.state))];
  const periods = [...new Set(lines.map((r) => r.period))];
  check("7 个状态齐全", states.length === 7, states.join(","));
  check("4 个时段齐全", periods.length === 4, periods.join(","));
  const buckets = {};
  lines.forEach((r) => { const k = r.state + "/" + r.period; buckets[k] = (buckets[k] || 0) + 1; });
  const thin = Object.entries(buckets).filter(([, v]) => v < 6);
  check("每桶 ≥6 条（28 个桶）", thin.length === 0 && Object.keys(buckets).length === 28,
    JSON.stringify(thin.slice(0, 3)));
  const long = lines.filter((r) => r.text.length > 14);
  check("每条 ≤14 字", long.length === 0, long.slice(0, 2).map((r) => r.text).join(","));
  check("每条都带预设 e / b（不随机）",
    lines.every((r) => /^(calm|smile|soft|tease|sulky|serious|blank|tired)$/.test(r.e) &&
      /^(warm|dusk|cool|gray)$/.test(r.b)));
}

/* 2. 101：断网发消息 → 只回一句 */
{
  O._reset();
  const r = O.reply("calm", "在吗");
  check("断网时返回一句（非空）", !!r.text && r.text.length <= 14, r.text);
  check("不含「网络异常」这类系统语", !/网络异常|请检查连接|服务器/.test(r.text), r.text);
  check("使用预设的 e/b", !!r.e && !!r.b, JSON.stringify(r));
  check("第 1 条不离线计数为 1", r.streak === 1, r.streak);
}

/* 3. 102：同一状态×时段，5 轮不重复 */
{
  O._reset();
  const seen = [];
  for (let i = 0; i < 5; i++) seen.push(O.pick("calm", "day").text);
  check("同桶 5 轮不重复", new Set(seen).size === 5, seen.join(" / "));
}

/* 4. 104：连续离线第 3 条起明显变短 */
{
  O._reset();
  const first = O.reply("calm", "在吗");
  const second = O.reply("calm", "在吗");
  const third = O.reply("calm", "在吗");
  const fourth = O.reply("calm", "在吗");
  check("第 1~2 条是正常长度", first.text.length + second.text.length >= 4,
    first.text + " / " + second.text);
  check("第 3 条起 ≤4 字（明显变短）", third.text.length <= 4 && fourth.text.length <= 4,
    third.text + " / " + fourth.text);
}

/* 5. 103：恢复网络后不补发、不道歉（只重置计数） */
{
  const before = O.streak();
  O.noteOnline();
  check("恢复网络后离线计数清零", O.streak() === 0, before + " -> " + O.streak());
  const r = O.reply("calm", "在吗");
  check("恢复后文案里没有道歉/解释", !/抱歉|对不起|刚才断网|恢复/.test(r.text), r.text);
}

/* 6. 用户问「是不是断网了」 */
{
  O._reset();
  const r = O.reply("calm", "你是不是断网了");
  check("承认但不技术化（嗯，有点卡。）", r.text === "嗯，有点卡。", r.text);
  check("不带「离线模式」字样", !/离线模式|offline/i.test(r.text));
}

/* 7. 状态回退：没有该状态桶 → 回退 calm */
{
  O._reset();
  const r = O.pick("nonexistent_state", "night", { streak: 1 });
  check("未知状态回退到 calm", !!r.text, JSON.stringify(r));
}

/* 8. 断网判定 */
{
  check("Failed to fetch → 判为断网", O.looksOffline(new TypeError("Failed to fetch")));
  check("普通 500 不判为断网", !O.looksOffline(new Error("http 500")));
}

console.log("\n离线短句库验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
