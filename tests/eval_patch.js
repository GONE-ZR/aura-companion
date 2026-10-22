/* 第六篇 M2 验收：撤销/回收站（105/106/107）+ 成本监控（121）
   跑法：node tests/eval_patch.js
*/
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k)
};
global.document = undefined;   // 只测数据层（UI 由浏览器实测）

const R = require("../static/js/recycle.js");
const U = require("../static/js/usage.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 90) : "")); } };

/* ---------- 105：删除 → 5 秒撤销 → 完整恢复 ---------- */
{
  store.clear();
  let restored = false;
  const rec = R.removeWithUndo({ kind: "message", label: "面试的事", restore: () => { restored = true; } });
  check("删除后进入 5 秒撤销窗口（未入库）", R.list().length === 0 && R.pending() !== null);
  check("撤销窗口时长为 5 秒", R.UNDO_MS === 5000, R.UNDO_MS);
  const okUndo = R.undo(rec.id);
  check("点撤销 → 完整恢复（回调被调用）", okUndo && restored);
  check("撤销后不进回收站", R.list().length === 0, R.list().length);
}

/* ---------- 106：回收站只存名称与时间，无内容预览 ---------- */
{
  store.clear();
  const rec = R.removeWithUndo({ kind: "session", label: "加班", restore: () => { } });
  R.commit(rec);
  const l = R.list();
  check("撤销窗口过后进回收站", l.length === 1, l.length);
  const item = l[0];
  check("回收站条目只有 kind/label/deletedAt/expiresAt",
    Object.keys(item).sort().join(",") === "deletedAt,expiresAt,id,kind,label",
    Object.keys(item).join(","));
  check("label 只有名字（不含消息内容）", item.label === "加班", item.label);
}

/* ---------- 107：30 天保留 + 到期自动清 ---------- */
{
  store.clear();
  const rec = R.removeWithUndo({ kind: "memory", label: "不吃香菜", restore: () => { } });
  check("保留 30 天", Math.round((rec.expiresAt - rec.deletedAt) / 86400000) === 30,
    Math.round((rec.expiresAt - rec.deletedAt) / 86400000));
  // 手动塞一条过期记录
  store.set("aura_trash_v1", JSON.stringify([
    { id: "old", kind: "memory", label: "过期", deletedAt: Date.now() - 40 * 86400000, expiresAt: Date.now() - 10 * 86400000 }
  ]));
  check("过期条目读取时自动清除", R.list().length === 0, R.list().length);
  // 彻底删除
  const rec2 = R.removeWithUndo({ kind: "message", label: "彻底删", restore: () => { } });
  R.commit(rec2);
  R.purge(rec2.id);
  check("彻底删除后不在回收站", R.list().length === 0);
}

/* ---------- 121：成本监控能算缓存命中率 ---------- */
{
  store.clear();
  U.recordUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 800, completion_tokens: 100 }, { model: "deepseek-flash" });
  U.recordUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 600, completion_tokens: 200 }, { model: "deepseek-flash", fallback: true });
  const s = U.summary();
  check("请求数 = 2", s.requests === 2, s.requests);
  check("缓存命中率 = 1400/2000 = 70%", Math.abs(s.hitRate - 0.7) < 1e-6, s.hitRate);
  check("fallback 率 = 1/2 = 50%", Math.abs(s.fallbackRate - 0.5) < 1e-6, s.fallbackRate);
  check("按模型分开记", !!s.byModel["deepseek-flash"], JSON.stringify(s.byModel));
  const alarms = U.alarms();
  check("fallback >5% 触发报警", alarms.some((a) => a.indexOf("fallback") > -1), alarms.join(" | "));
  check("命中率 70% 不报警", !alarms.some((a) => a.indexOf("缓存命中率") > -1), alarms.join(" | "));
}

/* ---------- 121b：命中率 <50% 要报警 ---------- */
{
  store.clear();
  U.recordUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 100, completion_tokens: 50 }, { model: "deepseek-flash" });
  const a = U.alarms();
  check("命中率 10% → 报警", a.some((x) => x.indexOf("缓存命中率") > -1), a.join(" | "));
}

/* ---------- 还能撑几天 ---------- */
{
  store.clear();
  U.recordUsage({ prompt_tokens: 1000, completion_tokens: 1000 }, { model: "deepseek-flash" });
  check("按日均能估算剩余天数", U.daysLeft(22000) === 11, U.daysLeft(22000));
}

console.log("\n补丁（撤销/回收站/成本）验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
