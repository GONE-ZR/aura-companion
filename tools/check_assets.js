/* check_assets.js —— 构建期挡破图（第七篇 §6）
   资源键不在 ASSET_MAP 里、且不在 onDemand 清单 → exit 1，不产出包
   跑法：node tools/check_assets.js
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CFG = path.join(ROOT, "static", "config.bundled.json");
const STORE = path.join(ROOT, "static", "js", "cfgstore.js");

if (!fs.existsSync(CFG)) {
  console.error("✗ 找不到 config.bundled.json（先跑 python tools/bake.py）");
  process.exit(1);
}
const cfg = JSON.parse(fs.readFileSync(CFG, "utf8"));

/* 从 cfgstore.js 里抓 ASSET_MAP 的键（唯一真相源） */
const src = fs.readFileSync(STORE, "utf8");
const mapBlock = src.slice(src.indexOf("var ASSET_MAP"), src.indexOf("};", src.indexOf("var ASSET_MAP")));
const keys = new Set([...mapBlock.matchAll(/"([^"]+)":\s*1/g)].map((m) => m[1]));

const onDemand = new Set((cfg.assets && cfg.assets.onDemand) || []);
const need = [cfg.appearance && cfg.appearance.expression, cfg.appearance && cfg.appearance.iconPack]
  .filter(Boolean);

const missing = need.filter((k) => !keys.has(k) && !onDemand.has(k));
if (missing.length) {
  console.error("✗ 以下资源键不存在，会导致破图：");
  missing.forEach((k) => console.error("   - " + k));
  console.error("   可用键：" + [...keys].slice(0, 8).join(", ") + " …");
  process.exit(1);
}

/* 文案长度（框不下就警告，不阻断） */
const ph = (cfg.copy && cfg.copy.inputPlaceholder) || "";
if (ph.length > 12) console.warn("⚠ 输入框提示偏长（" + ph.length + " 字），手机上可能被截断");

console.log("✓ 资源检查通过：" + keys.size + " 个 key，" + need.length + " 个被引用");
console.log("  configVersion=" + cfg.configVersion + " · placeholder=“" + ph + "”");
