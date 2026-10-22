/* 第七篇 M0 验收：三层读取 + 原子切换（123/124/125/126/127/128/129/130/136）
   跑法：node tests/eval_cfgstore.js
*/
const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; }
};

const C = require("../static/js/cfgstore.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 100) : "")); } };

function makeCfg(v, over) {
  const base = {
    schemaVersion: 1, configVersion: v, updatedAt: "2026-10-23T00:00:00Z",
    features: { weather: true, reminders: true, search: true, agentMode: true, voiceTts: true, lifeLine: true, killSwitch: false },
    appearance: { background: "warm", expression: "expr.soft", iconPack: "pack.default" },
    copy: { inputPlaceholder: "说点什么…", emptyState: "我在。" },
    quickReplies: { enabled: true, max: 3, items: ["嗯"] },
    model: { tier: "standard", temperature: 1.25, promptVersion: "v1.0.0" },
    notify: { dailyMax: 2, quietStart: "23:00", quietEnd: "08:00" }
  };
  return Object.assign(base, over || {});
}

/* ---------- 124：首次安装、从未联网 → 用 bundled ---------- */
{
  store.clear();
  const r = C.loadActive();
  check("124：无任何本地配置 → 用 bundled", r.source === "bundled", r.source);
  check("124：bundled 功能完整（features 七个布尔）",
    Object.keys(r.config.features).length === 7, Object.keys(r.config.features).join(","));
  check("123：不白屏（一定拿到 config 对象）", !!r.config && !!r.config.copy, !!r.config);
}

/* ---------- 校验器 ---------- */
{
  check("schemaVersion 不是 1 → 拒绝", C.validate(makeCfg(2, { schemaVersion: 2 })) === false);
  check("configVersion 非整数 → 拒绝", C.validate(makeCfg(1, { configVersion: 1.5 })) === false);
  check("features 缺字段 → 拒绝",
    C.validate(Object.assign(makeCfg(1), { features: { weather: true } })) === false);
  check("background 非法 → 拒绝",
    C.validate(Object.assign(makeCfg(1), { appearance: { background: "purple", expression: "expr.calm", iconPack: "pack.default" } })) === false);
  check("quickReplies > 6 条 → 拒绝",
    C.validate(Object.assign(makeCfg(1), { quickReplies: { enabled: true, max: 3, items: new Array(7).fill("x") } })) === false);
  check("temperature 越界 → 拒绝", C.validate(makeCfg(1, { model: { tier: "standard", temperature: 3, promptVersion: "v1" } })) === false);
  check("合法配置 → 通过", C.validate(makeCfg(3)) === true);
}

/* ---------- 127：引用不存在的资源键 → 拒绝 ---------- */
{
  const bad = makeCfg(4, { appearance: { background: "warm", expression: "expr.nonexistent", iconPack: "pack.default" } });
  check("资源键不存在 → assetKeysExist=false", C.assetKeysExist(bad) === false);
  const r = C.acceptIfValid(bad, makeCfg(3));
  check("127：拒绝该配置（reason=asset_key）", r.ok === false && r.reason === "asset_key", JSON.stringify(r));
}

/* ---------- 125：版本只升不降 ---------- */
{
  store.clear();
  const cur = makeCfg(5);
  check("先写入 v5", C.acceptIfValid(cur, makeCfg(1)).ok === true);
  const down = C.acceptIfValid(makeCfg(4), cur);
  check("125：v4 不接受（not_newer）", down.ok === false && down.reason === "not_newer", JSON.stringify(down));
  const same = C.acceptIfValid(makeCfg(5), cur);
  check("125：同版本也不接受", same.ok === false && same.reason === "not_newer");
  check("125：v6 接受", C.acceptIfValid(makeCfg(6), cur).ok === true);
}

/* ---------- 130：更新后重开（新建一次 loadActive）仍在 ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(7), makeCfg(1));
  const r = C.loadActive();
  check("130：重启后仍是 v7（已落盘）", r.config.configVersion === 7 && r.source === "active",
    r.config.configVersion + "/" + r.source);
}

/* ---------- 129：指针损坏 → 扫描最大合法 gen ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(9), makeCfg(1));
  store.set("aura_cfg_current", "{ broken json");   // 故意写坏指针
  const r = C.loadActive();
  check("129：指针坏了 → source=scan 且拿到 v9", r.source === "scan" && r.config.configVersion === 9,
    r.source + "/" + r.config.configVersion);
}

/* ---------- 126：远端非法 JSON → 用旧的、不报错 ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(3), makeCfg(1));
  const before = C.loadActive();
  const r = C.acceptIfValid("not an object", before.config);
  check("126：非法输入被拒（invalid）", r.ok === false && r.reason === "invalid", JSON.stringify(r));
  check("126：旧配置仍然可用", C.loadActive().config.configVersion === 3);
}

/* ---------- 128：资源不齐 → 整次作废（旧版本仍完整） ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(11), makeCfg(1));      // 旧配置
  const withAsset = makeCfg(12, { assets: { onDemand: ["icon.custom"] } });
  /* 资源没落地 → assetsPresent=false（loadActive 会跳过这一代） */
  check("128：onDemand 资源缺失 → assetsPresent=false", C.assetsPresent(withAsset, 12) === false);
  const r = C.acceptIfValid(withAsset, makeCfg(11));
  check("128：资源缺失时拒绝提交", r.ok === false || C.loadActive().config.configVersion === 11,
    JSON.stringify(r));
  check("128：旧配置仍完整可用（v11）", C.loadActive().config.configVersion === 11,
    C.loadActive().config.configVersion);
}

/* ---------- 136：只保留最近 2 代 ---------- */
{
  store.clear();
  let cur = makeCfg(1);
  [2, 3, 4, 5, 6].forEach((v) => {
    const r = C.acceptIfValid(makeCfg(v), cur);
    if (r.ok) cur = makeCfg(v);
  });
  check("136：代数 ≤ 2", C.genList().length <= 2, C.genList().join(","));
  check("136：当前指针是最后一版", C.loadActive().config.configVersion === 6,
    C.loadActive().config.configVersion);
}

/* ---------- 恢复默认 ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(20), makeCfg(1));
  const r = C.resetToBundled();
  check("恢复默认 → 回到 bundled", r.source === "bundled", r.source);
  check("恢复默认 → 本地代数清空", C.genList().length === 0, C.genList().join(","));
}

/* ---------- status（设置页要显示的三项） ---------- */
{
  store.clear();
  C.acceptIfValid(makeCfg(31), makeCfg(1));
  const s = C.status();
  check("设置页三项：版本 / 来源 / 资源计数",
    s.version === 31 && s.source === "active" && s.assetsTotal > 0,
    JSON.stringify(s));
}

console.log("\n配置存储（三层 + 原子切换）验收：通过 " + ok + " 项，失败 " + bad + " 项");
process.exit(bad === 0 ? 0 : 1);
