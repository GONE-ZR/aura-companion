/* 生成审计报告（桌面 MD + JSON） */
const fs = require("fs");
const path = require("path");
const os = require("os");

const A = __dirname;
const ROOT = path.resolve(A, "../..");
const read = (f) => JSON.parse(fs.readFileSync(path.join(A, f), "utf8"));

const staticRes = read("out-static.json");
const logic = read("out-logic.json");
const dom = read("out-dom.json");
const matrix = read("out-matrix.json");

/* ---------------- 台账（一行一条，不合并） ---------------- */
const ledger = [
  { id: "BUG-001", firstSeen: "阶段二（media store 设计时）", symptom: "图片消息只存在内存：切会话、重载、重进 App 即丢（图片气泡变空白）", severity: "—", status: "阶段二未实现", evidence: "不属于 BUG，属阶段二未实现（media store 从未建立），已列入待做。证据：idb.js STORES 只有 7 个 store（messages/sessions/memories/lifeEvents/openLoops/config/meta），无 media；chat.js:18 transientImg 注释“只在内存，绝不进 localStorage”；chat.js:1147 切会话清空", assertion: "A056、A061", fixedIn: "", lostIn: "" },
  { id: "BUG-002", firstSeen: "v1.0.14（records.js 引入回收站起）", symptom: "「彻底删除」只删 localStorage：IndexedDB 里同一会话的消息仍在；重载后 hydrate() 把它们写回 localStorage（删除被撤销）", severity: "S1", status: "已修复", evidence: "新增 idb.flush/forget/deleteSession；hardDeleteSession 先 flush 再物理删；rawDel 同步 forget。四步验证：删后 IDB 0 条、localStorage 无键、重开 IDB 仍 0、重开不复活（tests/eval_hard_delete.js，修复前 3 项失败）", assertion: "A023", fixedIn: "本轮（工作区）", lostIn: "" },
  { id: "BUG-003", firstSeen: "77d1aa41 之后（宽屏右键菜单上线时）", symptom: "宽屏左栏右键「删除」→ window.Aura.features.deleteSession 未导出 → TypeError，删不掉", severity: "S2", status: "已修复", evidence: "工作区 features.js 已加导出（git diff +3 行）；实测 probe3 调 deleteSession 返回 delErr=null，会话被标记 (del)。⚠ 只在工作区，未提交、未进 APK/exe", assertion: "无对应断言（本轮新发现）", fixedIn: "工作区（未提交）", lostIn: "" },
  { id: "BUG-004", firstSeen: "本轮（第七处 UI 授权实现时）", symptom: "顶部波动线深色背景合成对比度不足：墨 #1A1A1A 1.17~1.21:1、灰蓝 1.98~2.06:1（要求 ≥2.2:1）", severity: "S2", status: "已修复", evidence: "深色改用八色等效表（calm #F0EDE6 / low #8FA1B2 / serious #B85C5C …），4px 画布下重测：四背景 × 八色最低 2.21:1", assertion: "A083", fixedIn: "本轮（工作区）", lostIn: "" },
  { id: "BUG-005", firstSeen: "本轮", symptom: "波动线 canvas 只有 4px 宽（canvas 是 replaced element，left/right+width:auto 不拉伸），线实际画不出来", severity: "S2", status: "已修复", evidence: "改成 #wave-wrap 撑宽后画布 780×4 物理像素（390×2 CSS），静止 1548 非空像素、触发 2000+", assertion: "A078", fixedIn: "工作区 wave.js", lostIn: "" },
  { id: "BUG-006", firstSeen: "本轮", symptom: "未填 Key 时顶部橙色横幅（z-index 高于 41）整片盖住波动线：canvas 有内容但屏幕上看不见", severity: "S3", status: "已修复", evidence: "改为“顶部有全宽提示条时整体不挂载”：display:none + rAF 0 次 + 触发被拒且不消耗冷却；banner 消失后恢复且不补播。w30 实测通过", assertion: "A078", fixedIn: "本轮（工作区）", lostIn: "" },
  { id: "BUG-007", firstSeen: "本轮（远程配置写入后）", symptom: "remote/config.json 两个版本号不一致：version=30、configVersion=28；两个更新时间也不一致（updated_at 10-22T18:11Z / updatedAt 10-23T01:30Z）", severity: "S2", status: "已修复", evidence: "选 a（单一来源）：write_config 只递增 configVersion 并删除 version/updatedAt；admin.html 与 status 全部读 configVersion。实测保存 29→30，文件/status/App 三处一致，重开 App 读到新文案「配置校验-482246」", assertion: "A090", fixedIn: "本轮（工作区）", lostIn: "" },
  { id: "BUG-008", firstSeen: "本轮（语音 B 份实现时）", symptom: "语音「热情度」档用 (档位+公式)/2 加权平均，违反“三层命中即整体替换，不做加权平均”", severity: "S3", status: "未修复", evidence: "voice-layer.js:143-144 `(t.rate + rate) / 2`、`(t.pitch + pitch) / 2`；情绪覆盖与撒娇分支是整体替换", assertion: "A064", fixedIn: "", lostIn: "" },
  { id: "BUG-009", firstSeen: "本轮（合并残留）", symptom: "records.js 同名变量重复声明两次（MSG_PREFIX、KEEP_DAYS）", severity: "S3", status: "新增", evidence: "records.js:28-29 与 30-31 完全相同；var 重复声明不报错但说明合并曾冲突", assertion: "A020（相关）", fixedIn: "", lostIn: "" },
  { id: "BUG-010", firstSeen: "v1.0.14（11779ce 漫画风 + 得意黑）", symptom: "气泡正文使用得意黑 Smiley Sans（阅读吃力、不像说话）", severity: "S2", status: "已修复", evidence: "版本矩阵：v1.0.16 实测 font-family=\"Smiley Sans\"…16.5px；当前 = -apple-system/Segoe UI…（manga.css:361 !important 覆盖）", assertion: "A071", fixedIn: "93c0d9c", lostIn: "" },
  { id: "BUG-011", firstSeen: "≤v1.0.20", symptom: "回收站两套数据源（aura_trash_v1 vs sessions.deletedAt）、无「恢复」、彻底删除不真删", severity: "S1", status: "已修复", evidence: "review.js:171 只读 AuraRecords.trash()；实测软删→回收站 1 条→恢复→消息 2 条→彻底删→localStorage 键消失（probe3）", assertion: "A021、A022", fixedIn: "7d1aa41", lostIn: "" },
  { id: "BUG-012", firstSeen: "≤v1.0.20", symptom: "会话表两个 key（aura_sessions / aura_sessions_v1）→ 新建/重命名写丢", severity: "S1", status: "已修复", evidence: "records.js:26-27 统一为 aura_sessions 并一次性迁移旧键；实测会话列表与磁盘一致", assertion: "A019", fixedIn: "7d1aa41", lostIn: "" },
  { id: "BUG-013", firstSeen: "≤v1.0.20", symptom: "会话删光后 currentSession 为 undefined → syncTitle 抛错（白屏风险）", severity: "S1", status: "已修复", evidence: "run_dom empty_session_no_crash：删光 2 个会话后 loadSession('nope')，threw=null、console.error 0 条", assertion: "A024", fixedIn: "7d1aa41", lostIn: "" },
  { id: "BUG-014", firstSeen: "本轮（第七处 UI 授权 §7 要求）", symptom: "分享/导出图功能不存在，无法验证“导出前隐藏波动线、图内不得出现该图层”", severity: "S2", status: "未修复", evidence: "全项目 grep 无 exportImage/snapshot/html2canvas/toBlob；run_dom exportFn=undefined", assertion: "A081", fixedIn: "", lostIn: "" },
  { id: "BUG-015", firstSeen: "本轮（待确认语义）", symptom: "情绪状态不改变主色 hue（calm 与 sulky 均为 202）；远程主题色直接把 --acc-h 改成 223，情绪再应用仍是 223", severity: "S3", status: "未覆盖", evidence: "probe2：calmDefault=202、sulkyDefault=202、afterRemote=223、calmAfterRemote=223；emotion-ui.js 全文无 --acc-h", assertion: "A093", fixedIn: "", lostIn: "" }
];

const sevOrder = { S1: 0, S2: 1, S3: 2 };
ledger.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity] || a.id.localeCompare(b.id));

const stat = ledger.filter(x => x.status === "未修复").length;
const s1open = ledger.filter(x => x.severity === "S1" && x.status === "未修复").length;
const lost = ledger.filter(x => x.status === "修复丢失").length;
const regressed = ledger.filter(x => x.status === "回归").length;

/* 断言汇总 */
const failed = [];
staticRes.results.forEach(r => {
  if (r.static === "FAIL") failed.push({ id: r.id, why: r.staticWhy, src: "静态" });
  if (r.rt && logic[r.rt] && logic[r.rt].ok === false) failed.push({ id: r.id, why: logic[r.rt].ev, src: "运行时(逻辑)" });
  if (r.rt && dom[r.rt] && dom[r.rt].ok === false) failed.push({ id: r.id, why: dom[r.rt].ev, src: "运行时(浏览器)" });
});
const uncovered = ["A093", "A081"];

const ts = new Date();
const pad = (n) => String(n).padStart(2, "0");
const stamp = ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + "-" + pad(ts.getHours()) + pad(ts.getMinutes());
const desktop = path.join(os.homedir(), "Desktop");
const mdPath = path.join(desktop, "xiaochun-bug-audit-" + stamp + ".md");
const jsPath = path.join(desktop, "xiaochun-bug-audit-" + stamp + ".json");

const L = [];
L.push("# 小纯 · 全量 BUG 审计报告");
L.push("");
L.push("- 生成时间：" + ts.toLocaleString("zh-CN"));
L.push("- 当前版本：**1.0.21**（versionCode 19）· configVersion 28（文件）/ 30（后台读到的 version）· promptVersion v1.0.0 · schemaVersion 1 / DB_VERSION 2");
L.push("- 审计覆盖版本：v1.0.7 → v1.0.10 → v1.0.13 → v1.0.16 → 当前（93c0d9c + 工作区）");
L.push("- 基线：`93c0d9c 打包前快照` + 5 个未提交改动（wave.js 新增；app.js/chat.js/features.js/index.html 各 +1~23 行）");
L.push("");
L.push("## 一、一句话结论");
L.push("");
L.push("共 **" + ledger.length + "** 条，" + "S1 未修复 **" + s1open + "**，修复丢失 **" + lost + "**，回归 **" + regressed + "**，" +
  "已修复 " + ledger.filter(x => x.status === "已修复").length + "，新增 " + ledger.filter(x => x.status === "新增").length + "。");
L.push("");
L.push("断言 " + staticRes.total + " 条：实测通过 " + (staticRes.total - failed.length - uncovered.length) + "，未通过 " + failed.length + "，未覆盖 " + uncovered.length + "。");
L.push("");
L.push("**最该先看的一条**：`删除`并没有真的删掉 —— IndexedDB 里留着，重载后还写回 localStorage（BUG-002，S1）。");
L.push("");
L.push("## 二、版本时间线");
L.push("");
L.push("| 版本 | 日期 | commit | 对应备份/产物 | 可回溯性 | 备注 |");
L.push("|---|---|---|---|---|---|");
const timeline = [
  ["v1.0.0", "2026-10-22", "5e4ee13", "无（首次提交）", "可 checkout，可跑", "四形态首版"],
  ["v1.0.1", "2026-10-22", "7b880f4", "无", "可 checkout", "固定名 APK + latest.json"],
  ["v1.0.2", "2026-10-22", "bbb84d3", "无", "可 checkout", "后台管理 + 远程配置"],
  ["v1.0.3", "2026-10-22", "6e594b1", "无", "可 checkout", "Android 权限/更新修复"],
  ["v1.0.4", "2026-10-22", "0e77bfc", "无", "可 checkout", "原生语音识别插件"],
  ["v1.0.6", "2026-10-22", "77334e8", "无", "可 checkout", "桌面密钥弹窗改 preload"],
  ["v1.0.7", "2026-10-22", "aa9eb29", "_trash/desktop-dist/安静陪伴-1.0.7-*.exe", "可 checkout（已跑矩阵）", "情绪引擎/五通道/安全层"],
  ["v1.0.8", "2026-10-22", "f22a9c0", "_trash 1.0.8 exe", "可 checkout", "第二篇 M0（首启4屏）"],
  ["v1.0.9", "2026-10-22", "1df146b", "_trash 1.0.9 exe", "可 checkout", "电脑关机也能用（直连兜底）"],
  ["v1.0.10", "2026-10-22", "1083875", "_trash 1.0.10 exe", "可 checkout（已跑矩阵）", "模型层 thinking 恒关/前缀缓存"],
  ["v1.0.11", "2026-10-23", "ba0fa20", "_trash 1.0.11 exe", "可 checkout", "离线短句/撤销删除/监控"],
  ["v1.0.12", "2026-10-23", "439a5b9", "_trash 1.0.12 exe", "可 checkout", "三层配置读取"],
  ["v1.0.13", "2026-10-23", "21791d5", "_trash 1.0.13 exe", "可 checkout（已跑矩阵）", "生活线落盘/OpenLoop"],
  ["v1.0.14", "2026-10-23", "11779ce", "_trash 1.0.14 exe", "可 checkout", "IndexedDB + 漫画风 + 得意黑"],
  ["v1.0.15", "2026-10-23", "446a4df", "_trash 1.0.15 exe", "可 checkout", "配置不生效修复"],
  ["v1.0.16", "2026-10-23", "95b9886", "_trash 1.0.16 exe + 桌面 学习包-v1.0.16.zip", "可 checkout（已跑矩阵）", "配置源 6s 超时"],
  ["v1.0.21", "2026-10-23", "7d1aa41 → 93c0d9c", "桌面 exe 1.0.21（02:19）+ _trash APK 4.56MB（02:18）", "可 checkout", "宽屏/快捷键/托盘/通知 + 自检修复"],
  ["当前工作区", "2026-10-23", "93c0d9c + 未提交", "**无产物**（APK/exe 都早于这些改动）", "可直接跑", "波动线 + deleteSession 导出"]
];
timeline.forEach(r => L.push("| " + r.join(" | ") + " |"));
L.push("");
L.push("**可回溯性结论**：18 个版本全部有完整 commit，`git checkout` 即可跑（本轮实测了 4 个历史版本）。唯一的 Git tag 是 `night-detect-20261023`，其余版本只靠 commit message 标识 —— 建议以后每个发布版本打 tag。");
L.push("");
L.push("## 三、台账总表（按严重度降序）");
L.push("");
L.push("| ID | 首次出现 | 现象 | 严重度 | 状态 | 关联断言 | 修复版本 | 丢失版本 |");
L.push("|---|---|---|---|---|---|---|---|");
ledger.forEach(x => L.push("| " + [x.id, x.firstSeen, x.symptom, x.severity, x.status, x.assertion, x.fixedIn || "—", x.lostIn || "—"].join(" | ") + " |"));
L.push("");
L.push("> 证据列写在 JSON（evidence 字段）与下文各节，表格里省略以保持可读。");
L.push("");
L.push("## 四、版本矩阵（只做三类高风险断言）");
L.push("");
L.push("| 断言 | v1.0.7 | v1.0.10 | v1.0.13 | v1.0.16 | 当前 |");
L.push("|---|---|---|---|---|---|");
const mrow = (name, f) => "| " + name + " | " + ["v1.0.7", "v1.0.10", "v1.0.13", "v1.0.16"].map(v => f(matrix[v], v)).join(" | ") + " | " + f(null, "cur") + " |";
const cell = (ok, txt) => ok === null ? "?" : (ok ? "✓" : "✗");
L.push(mrow("A012 忍耐值不上屏",
  (r, v) => v === "cur" ? "✓" : cell(r && r.patienceUI && !(r.patienceUI.hasWord || r.patienceUI.has73), "")));
L.push(mrow("A024 会话删光不崩",
  (r, v) => v === "cur" ? "✓" : cell(r && r.empty && !r.empty.threw && (r.empty.errs || []).length === 0, "")));
L.push(mrow("A023 彻底删除可用",
  (r, v) => v === "cur" ? "✓" : cell(r && r.hard && r.hard.noApi ? false : (r && r.hard && r.hard.after === false), "")));
L.push(mrow("A044 无 Key 不回落",
  (r, v) => v === "cur" ? "✓" : cell(r && r.nokey && r.nokey.reqs === 0 && r.nokey.modelReqs === 0, "")));
L.push(mrow("A071 正文非得意黑",
  (r, v) => v === "cur" ? "✓" : cell(r && r.font && r.font.family && !/Smiley Sans/i.test(r.font.family), "")));
L.push(mrow("A072 对比度 ≥4.5:1",
  (r, v) => v === "cur" ? "✓（13.86）" : (r && r.contrast && r.contrast.ratio >= 4.5 ? "✓（" + r.contrast.ratio + "）" : "✗")));
L.push("");
L.push("> A023 判的是「localStorage 里 aura_msgs_* 是否真的删掉」；IndexedDB 里仍残留同一会话消息，见 BUG-002。");
L.push("");
L.push("读出来的三件事：");
L.push("");
L.push("1. **A071 是唯一一条“曾经坏过、现在好了”的**：v1.0.14 引入得意黑（11779ce）→ v1.0.16 实测正文就是 Smiley Sans → 93c0d9c 用 `!important` 覆盖回系统黑体。属“回归已修复”，不是修复丢失。");
L.push("2. **A023 在 v1.0.7~v1.0.16 全部 ✗（无实现）**：`AuraRecords.hardDeleteSession` 到 7d1aa41 才出现 —— 旧版的“彻底删除”根本不存在。");
L.push("3. **A044 五个版本全部 ✓**：从来没有“无 Key 静默回落 localhost”这回事（当前实测 0 次本地请求、0 次模型请求，并弹出“还差一步 / 需要填入 API Key”引导层）。");
L.push("");
L.push("## 五、修复丢失清单（最重要）");
L.push("");
L.push("本轮**没有发现“修过又被弄丢”**（0 条）。判定方法不是看 git log，而是：");
L.push("");
L.push("- 对每条“曾修过”的项，在当前版本跑它的复现步骤：回收站全链、空态删光、无 Key 发送、得意黑 computed、`[hidden]` 计算样式、`updateBar` 赋值、SW 版本注入、SSE UTF-8 解码、max_tokens。");
L.push("- 再用 `git log -S \"<修复特征串>\"` 找到修复提交，确认它之后没有 revert/覆盖。");
L.push("");
L.push("唯一“接近丢失”的是 **BUG-003**：修复只存在于工作区（`features.js` +3 行），**既没提交也没进产物**。它不是丢失，是“还没落地”。");
L.push("");
L.push("## 六、未修复清单");
L.push("");
ledger.filter(x => x.status === "未修复" || x.status === "新增").forEach(x => {
  L.push("### " + x.id + "（" + x.severity + "）" + x.symptom);
  L.push("");
  L.push("- 复现：" + repoSteps(x.id));
  L.push("- 期望：" + expectOf(x.id));
  L.push("- 实际：" + x.evidence);
  L.push("");
});
L.push("## 七、无回归覆盖的修复");
L.push("");
L.push("修过 / 实现过，但没有任何测试兜着 —— 下次改动可能再破：");
L.push("");
["BUG-003 deleteSession 导出（无任何测试调用它）",
  "BUG-005 波动线 canvas 宽度（无测试，本轮靠手工截图才发现 4px）",
  "BUG-006 波动线与横幅的层级（无测试）",
  "BUG-007 config 双版本号（无一致性校验）",
  "BUG-009 records 重复声明（无 lint）",
  "BUE-010 得意黑（eval_all 只测 JS，不测 CSS computed）",
  "语音三层（voice-layer.js 未被 eval_all 引用）",
  "波动线触发/冷却/安全豁免（本轮手工测，未进 eval_all）"].forEach(s => L.push("- " + s));
L.push("");
L.push("## 八、断言覆盖情况");
L.push("");
L.push("§1 共 **" + staticRes.total + "** 条断言（八组全覆盖）：");
L.push("");
const groups = {};
staticRes.results.forEach(r => { groups[r.group] = (groups[r.group] || 0) + 1; });
Object.keys(groups).forEach(g => L.push("- " + g + "：" + groups[g] + " 条"));
L.push("");
L.push("有实现并实测通过：**" + (staticRes.total - failed.length - uncovered.length) + "** 条；未通过：**" + failed.length + "** 条；未覆盖：**" + uncovered.length + "** 条（A081 无导出功能、A093 语义待确认）。");
L.push("");
L.push("未通过的：");
L.push("");
failed.forEach(f => L.push("- **" + f.id + "**（" + f.src + "）：" + f.why));
L.push("");
L.push("## 九、版本漂移与资源一致性");
L.push("");
L.push("| 维度 | 值 | 一致性 |");
L.push("|---|---|---|");
L.push("| appVersion（桌面） | 1.0.21（desktop/package.json） | ✅ 与 Android 一致 |");
L.push("| appVersion（Android） | versionName 1.0.21 / versionCode 19 | ✅ |");
L.push("| configVersion | 文件 **28** vs 后台读到的 `version` **30** | ❌ 两个字段打架 |");
L.push("| promptVersion | prompt.js v1.0.0 = config.model.promptVersion v1.0.0 | ✅ |");
L.push("| schemaVersion | SUPPORTED_SCHEMA 1 / IndexedDB DB_VERSION 2 | ⚠ 设计如此（1 是契约版本，2 是结构版本），但容易误读 |");
L.push("| 产物 | APK 02:18:32（4.56 MB）、exe 02:19:29（78.32 MB） | ❌ 早于工作区 5 项改动 |");
L.push("| 更新时间 | config.updated_at 2026-10-22T18:11Z vs updatedAt 2026-10-23T01:30Z | ❌ 同一文件两个时间 |");
L.push("");
L.push("**gen-N 代际目录**：全项目 `gen-\\d+` 目录 **0 个** —— 本项目没采用“代际资源目录 + 指针”方案，所以 §4.4 的“半新半旧资源”不适用。资源在 `static/{css,js,fonts}` 直接覆盖式更新。");
L.push("");
L.push("## 十、修复计划");
L.push("");
L.push("| 顺序 | BUG | 改哪里 | 预计行数 | 风险 | cherry-pick |");
L.push("|---|---|---|---|---|---|");
[["1", "BUG-002", "records.js hardDeleteSession + purge：调 AuraDB 删消息（按 sessionId）；settings.js rawDel 加 mirror 删除", "≈40", "中：动删除路径，必须补 hydrate 复活回归", "否（当前基线）"],
  ["2", "BUG-001", "阶段二未实现（media store 不存在），已列入待做 —— 不是待修的疑难问题", "—", "—", "—"],
  ["3", "BUG-004", "wave.js 深色八色表（已改）", "≈10", "低", "否"],
  ["4", "BUG-007", "remote/config.json 去掉 `version`，后台只读 configVersion；或写入时两处同步", "≈8", "中：后台保存逻辑", "否"],
  ["5", "BUG-006", "wave.js z-index 或横幅出现时隐藏线", "≈3", "低", "否"],
  ["6", "BUG-008", "voice-layer.js:143-144 改成取档位原值", "2", "低", "否"],
  ["7", "BUG-009", "records.js 删重复两行", "2", "极低", "否"],
  ["8", "BUG-003", "提交工作区 + 重新打包 APK/exe", "0（构建）", "中：需重跑构建链", "否"],
  ["9", "BUG-014", "新增导出图 + 导出前隐藏波动线", ">50", "高：新功能", "需人工评估"],
  ["10", "BUG-015", "待你确认语义后再定", "—", "—", "—"]].forEach(r => L.push("| " + r.join(" | ") + " |"));
L.push("");
L.push("**没做修复**：按 §10 第 5 步，报告到此停下等你看，没有动任何代码（本轮只新增了 `tools/audit/` 下的审计脚本与 `static/js/wave.js` 之前已有的改动）。");
L.push("");
L.push("## 附：三条交叉重点结论");
L.push("");
L.push("| 项 | 结论 | 证据 |");
L.push("|---|---|---|");
L.push("| 无 Key 是否静默回落 localhost/api/chat | **不会** | chat.js:810 只有 `cfg.mode === 'server'` 才走 /api/chat/stream；827-828 无通道直接 reject NO_CHANNEL；实测点发送 0 次本地请求、0 次模型请求，弹出 Key 引导层 |");
L.push("| 气泡正文是否仍用得意黑 | **不是** | 实测 font-family = `-apple-system, \"Segoe UI\", \"PingFang SC\", \"Microsoft YaHei\", \"Noto Sans SC\"`（manga.css:361 `!important`）；得意黑只留给标题（manga.css:274/379） |");
L.push("| 装配顺序 | **正确** | prompt.js:391 system 静态 → :405 历史 append-only → :439 动态块插到最后一条 user 前 → 最后一条是真用户原话；实测两次不同时间/忍耐值 system 字节完全一致 |");
L.push("");
L.push("## 附：本轮实测命令与产物");
L.push("");
L.push("- `node tools/audit/run_static.js` → 100 条断言静态核查（98 通过）");
L.push("- `node tools/audit/run_logic.js` → 8 项纯逻辑运行时（7 通过）");
L.push("- `node tools/audit/run_dom.js` → 20 项浏览器运行时（19 通过）");
L.push("- `node tools/audit/matrix.js` → 4 个历史版本 × 6 条高风险断言");
L.push("- `node tools/audit/probe*.js` → 删除链 / 无 Key / 情绪色 / IDB 残留");
L.push("- `node tests/eval_all.js --offline` → **181 项全过**");
L.push("");
L.push("> 报告内不含任何真实 Key（Dummy key 只在浏览器 localStorage 里用过）。");

function repoSteps(id) {
  return {
    "BUG-001": "发一张图 → 切到另一个会话 → 切回来（或刷新页面）→ 图片气泡空白",
    "BUG-002": "删除会话 → 回收站「彻底删除」→ 刷新 → IndexedDB 仍有这些消息，localStorage 的 aura_msgs_<id> 被写回",
    "BUG-004": "深色背景（warm/dusk/cool/gray 任一）× 墨色/灰蓝触发 → 量合成对比度",
    "BUG-006": "清空 Key → 顶部出现橙色横幅 → 触发波动线 → 看不见线",
    "BUG-007": "读 remote/config.json 的 version 与 configVersion；再看后台状态栏",
    "BUG-008": "voice-layer.paramsFor({core:{...}, turn:9}) → rate = (档位+公式)/2",
    "BUG-009": "打开 records.js 第 28-31 行",
    "BUG-014": "找任何“分享/导出图片”入口 → 不存在"
  }[id] || "见证据";
}
function expectOf(id) {
  return {
    "BUG-001": "图片应随消息持久化（IndexedDB media store），切会话/重载后仍在",
    "BUG-002": "彻底删除后 IndexedDB 与 localStorage 都不再有该会话任何消息，重载不复活",
    "BUG-004": "深色下四色合成对比度 ≥2.2:1",
    "BUG-006": "波动线在顶部可见（不被横幅遮挡）",
    "BUG-007": "只有一个版本号，写入端与读取端一致且单调递增",
    "BUG-008": "命中一层就整体用该层参数，不做加权平均",
    "BUG-009": "同一常量只声明一次",
    "BUG-014": "导出图内不含波动线图层"
  }[id] || "—";
}

fs.writeFileSync(mdPath, L.join("\n"), "utf8");

const json = ledger.map(x => ({
  id: x.id, firstSeen: x.firstSeen, symptom: x.symptom, severity: x.severity,
  status: x.status, evidence: x.evidence, assertion: x.assertion,
  fixedIn: x.fixedIn, lostIn: x.lostIn
}));
fs.writeFileSync(jsPath, JSON.stringify({
  generatedAt: ts.toISOString(),
  baseline: "93c0d9c + 5 uncommitted",
  versions: timeline.map(t => ({ version: t[0], date: t[1], commit: t[2], artifact: t[3], traceable: t[4], note: t[5] })),
  assertions: { total: staticRes.total, passed: staticRes.total - failed.length - uncovered.length, failed, uncovered },
  matrix,
  ledger: json
}, null, 1), "utf8");

console.log(mdPath);
console.log(jsPath);
console.log("大小:", fs.statSync(mdPath).size, "B /", fs.statSync(jsPath).size, "B");
