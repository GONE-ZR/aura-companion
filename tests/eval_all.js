/* 一键跑全部验收（任务书 §十一 12 条）
   跑法：node tests/eval_all.js            （含真模型，约 13 次调用）
        node tests/eval_all.js --offline    （只跑不依赖模型的 6 组）
*/
const { spawnSync } = require("child_process");
const path = require("path");

const offline = process.argv.includes("--offline");
const suites = [
  ["eval_engine", "第 6/7/12 条（忍耐值/客气/状态延续）"],
  ["eval_prompt", "提示词装配顺序与预算"],
  ["eval_safety", "第 10 条（危机干预）"],
  ["eval_memory", "第 9 条（0.5 置信度不当事实）"],
  ["eval_meta", "第 11 条（首行标签 + 降级）"],
  ["eval_second", "第二篇：四处调整 / 三条新约束 / 命名 / 提示词小节"]
];
if (!offline) suites.push(["eval_live", "第 1/2/3/4/5/8 条（需真模型）"]);

let bad = 0;
for (const [name, desc] of suites) {
  const r = spawnSync(process.execPath, [path.join(__dirname, name + ".js")], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/通过\s*(\d+)\s*项，失败\s*(\d+)\s*项/);
  const pass = m ? m[1] : "?";
  const fail = m ? Number(m[2]) : (r.status === 0 ? 0 : 1);
  bad += fail;
  console.log((fail === 0 ? "  ✅ " : "  ❌ ") + name.padEnd(14) + " 通过 " + pass + " 项  " + desc);
  if (fail !== 0) console.log(out.split("\n").filter((l) => l.includes("FAIL")).join("\n"));
}
console.log("\n" + (bad === 0 ? "全部通过 ✅" : "有 " + bad + " 项失败 ❌"));
process.exit(bad === 0 ? 0 : 1);
