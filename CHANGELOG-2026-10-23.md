# CHANGELOG 2026-10-23

> 本轮实际完成：**第一部分（时间显示）**、**第二部分（电脑网页端功能）**。
> 第三部分（token 用量与费用）与控制台 P0 **未实现**，据实标注为「未做」。

---

## 一、本轮做了什么

### 1. 时间显示（App 端 + 网页端）

**新增文件**

| 文件 | 作用 |
|---|---|
| `static/js/timefmt.js` | 全项目**唯一**时间格式化出口：`hms`(HH:mm:ss) / `full` / `fullMs` / `ymd` / `iso` / `dayLabel` / `shouldShow` / `gapText` / `tzLabel` / `sameDay`；缺值统一 `—` |
| `static/css/time.css` | 时间戳与日期分割条：定宽 5.6em + `tabular-nums`；深色对比度版；长按浮层 |

**修改文件**：`chat.js`（时间戳 + 日期条 + 长按浮层）、`review.js`（回收站日期）、`features.js`（导出 ISO）、`voice.js`（导出时间）、`admin/admin.html`（引入 timefmt、修 UTC 当本地显示的 bug、顶部 GMT+8）、`templates/index.html`。

**新增字段**：无（时间仍存毫秒 `ts`）。

### 2. 电脑网页端功能

**新增文件**

| 文件 | 作用 |
|---|---|
| `static/js/wide.js` | 宽屏双栏：左栏会话列表（置顶 ≤3 / 最近活跃 / 已归档入口）、拖动调宽（280~420，默认 300，记住 `aura_wide_left`）、右键菜单（重命名/置顶/归档/删除） |
| `static/css/wide.css` | `@media (min-width:768px)` 双栏布局；`#wide-left` 默认 `display:none`（<768 单列）；拖动条；快捷键列表样式；深色/漫画风适配 |
| `static/js/keys.js` | 快捷键：Enter 发送 / Shift+Enter 换行 / Esc 停生成 / Ctrl(Cmd)+K 搜索 / Ctrl+N 新建 / ↑ 编辑上一条 / Ctrl+F 交浏览器；**组字中一律不触发**（`isComposing` / `keyCode 229` / `compositionstart` 三重保护） |
| `static/js/notify.js` | **唯一**通知守卫：静默 23:00–08:00、每日 2 条（主动问候 ≤1）、四类开关、5 分钟内活动则不推、禁词表（等你/想你/好久没来…）、点击打开会话不自动发送 |

**修改文件**：`templates/index.html`（加载 css/js + 设置页「快捷键」表）、`app.js`（初始化 + 快捷键表渲染）、`desktop/main.js`（托盘 + 关闭进托盘 + 全局快捷键 `Ctrl+Shift+A`）、`admin/admin.html`。

**新增数据表或字段**：无新增表；新增 localStorage 键 `aura_wide_left`、`aura_notify_count_<日期>`、`aura_notify_proactive_<日期>`、`aura_notify_kind_*`、`aura_notify_active_at`。

### 3. token 用量与费用

**未实现。** 只有 `static/js/usage.js` 的按日聚合（requestCount / promptTokens / cachedTokens / completionTokens / fallbackCount / errorCount），没有 per-request 记录、费用、缓存分开计价、导出导入、控制台页面。

---

## 二、验收结果（本轮 1~40）

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | HH:mm:ss 含秒 | **通过** | 渲染出 `14:30:27` / `01:05:37` / `02:35:37` |
| 2 | 秒数变化不抖 | **通过** | 宽度三次均 `64.39583587646484px`；字符长度恒 8 |
| 3 | 同小时 5 条不显示 | **通过** | 5 条中只 1 个 `.msg-time` |
| 4 | 间隔 90 分钟显示 | **通过** | 出现 `02:35:37` |
| 5 | 跨天/跨年分割条 | **通过** | `["2025年10月20日","昨天","今天"]` |
| 6 | 长按看完整时间 | **通过** | `2025-10-20 14:30:27`，点外部关闭 |
| 7 | 多气泡只一次时间戳 | **通过** | 3 个气泡：`.msg-time` 1 → 1 |
| 8 | 深色对比度 ≥4.5:1 | **通过** | 4.95:1 / 5.63:1 |
| 9 | 网页端列表到秒、列宽固定 | **部分通过** | 控制台 KPI `2026-10-22 23:43:44` + `tabular-nums` + `GMT+8`；左栏时间列定宽 5.6em；**记录库表格页未建** |
| 10 | 详情显示毫秒与间隔 | **未通过** | 页面不存在；`fullMs()`/`gapText()` 已实现并单测 |
| 11 | 导出 ISO 含毫秒与时区 | **通过** | `2026-10-23T02:07:20.309+08:00` |
| 12 | 全项目只一处格式化 | **通过** | 定义只在 `timefmt.js` |
| 13 | 无相对时间文案 | **通过（保留提示词内）** | 界面 0 命中；`prompt.js` 内保留（不上屏） |
| 14 | ≥768 双栏 / <768 单列 / 可拖拽记住 | **通过** | 视口 823px：`body.wide=true`、左栏 300px；设 360 → 记住 `360`；越界夹紧到 **420 / 280**；CSS 里 `#wide-left{display:none}` 为默认，`@media (min-width:768px)` 才显示 |
| 15 | 双栏切会话不换人 | **通过** | 切会话前后：忍耐值 `20→20`、状态 `tired→tired`、立绘 `未重载`（src 相同） |
| 16 | Enter 发送 / Shift+Enter 换行 / 组字不发 | **通过** | Enter → 发送 1 次；Shift+Enter → 仍 1 次；`isComposing:true` 的 Enter → 仍 1 次且 `defaultPrevented=false`（交给输入法） |
| 17 | Esc 停止、保留已输出 | **通过** | Esc 触发 `stopStreaming` 1 次（按钮存在时走按钮） |
| 18 | Ctrl/Cmd+K 搜索切换 | **通过** | 抽屉 `aria-hidden` 从 `true` → `false` |
| 19 | 设置里有快捷键页 | **通过** | 8 行：Enter / Shift+Enter / Esc / Ctrl+K / Ctrl+N / ↑ / Ctrl+F / 组字说明 |
| 20 | Electron 托盘 / 全局快捷键 / 可关 | **代码完成 · 需真机验证** | `main.js` 已加 `Tray`、关闭进托盘（`closeToTray` 可关）、托盘菜单（打开/新建话题/退出）、`globalShortcut` 默认 `Control+Shift+A`；exe 已重打 1.0.21；**托盘图标是否出现需启动 exe 目视** |
| 21 | 浏览器无托盘入口、无报错 | **通过** | 页面里无 `#tray-settings`；快捷键页只在 Electron UA 下显示托盘说明（当前测试浏览器 UA 含 Electron，正确显示） |
| 22 | 通知遵守静默与每日上限 | **通过（逻辑层）** | 23:30/03:00 → `quiet-hours`；含「想你」「等你」→ `forbidden-text`；连发 2 条后第 3 条 → `daily-cap`；主动问候第 2 条 → `daily-cap`；类别关闭 → `kind-off` |
| 23 | 两端同时在线只推最近活动端 | **部分** | 本设备 5 分钟内活动 → `recently-active` 不推；**跨设备共用计数未实现**（无上报通道，见「已知风险」） |
| 24~28 | usage 记录 / 无文本 / 计费 / 缓存分开 / 改价生效 | **未做** | 只有按日聚合 |
| 29 | 主界面/L2/L3 无费用 | **通过（因未实现）** | 全项目搜不到费用展示 |
| 30~35 | 开发者页/趋势/导入去重/来源/仅本机/上报静默 | **未做** | — |
| 36~40 | 提示词 diff / 秒级回滚 / 禁止立即生效 / 短句校验 / 无聊天接口 | **未做** | 控制台 P0 未开始 |

---

## 三、自检发现的问题

| # | 类别 | 问题 | 严重度 | 影响范围 | 建议修法 |
|---|---|---|---|---|---|
| 1 | 一致性 | 回收站**两套数据源**（`aura_trash_v1` vs `sessions.deletedAt`），无「恢复」，彻底删除不真删 | **高** | 删除/回收站 | 统一到 `records` |
| 2 | 一致性 | 会话表**两个 key**（`aura_sessions` / `aura_sessions_v1`）→ 新建/重命名写丢 | **高** | 会话 | 统一 + 兼容迁移 |
| 3 | 边界 | 会话删光后 `currentSession()` 为 undefined → `syncTitle` 抛错 | **高** | 空态 | 兜底 + 判空 |
| 4 | 死路 | `idb.js` 写入/读取失败被 catch 吞掉 | 中 | 持久化 | `warnOnce` |
| 5 | 一致性 | 导出用 `toLocaleString` | 中 | 导出 | 改 `AuraTime.full()` |
| 6 | 一致性 | `promptVersion` 两处可能漂移 | 中 | 版本追踪 | 启动对齐 |
| 7 | 死路 | 提示词无版本/回滚 | 中 | 运维风险 | 控制台 P0（未做） |
| 8 | 一致性 | 记录库 / 计费 未实现 | 中 | 功能缺失 | 下一轮 |
| 9 | 冲突 | §2.1 要求左栏显示「相对时间」，但第一部分明令「禁止相对时间」 | 中 | 左栏时间 | 已按第一部分执行（绝对时间 `HH:mm:ss` / `MM-DD`），**需你确认** |
| 10 | 限制 | 通知「跨设备共用当日计数」没有同步通道，只能每台设备各自计 | 中 | 双端推送 | 需上报名单（第三部分） |
| 11 | 性能 | 左栏每 4 秒轮询重绘一次 | 低 | CPU（极小） | 可换事件驱动 |
| 12 | 边界 | 回收站「彻底删除」文案条数用了过滤后条数 | 低 | 文案 | 已改 `rawMessages().length` |
| 13 | 其他 | `prompt.js` 内含相对时间文字 | 低 | 提示词 | 保持 |

---

## 四、修复记录

| # | 问题 | 严重度 | 修法 | 改了哪个文件 | 回归结果 |
|---|---|---|---|---|---|
| 1 | 回收站两套源 / 无恢复 / 删不掉 | 高 | 列表读 `records.trash()`；加「恢复」；「彻底删除」调新 `hardDeleteSession()` | `review.js`、`records.js` | 删后回收站出现「周末 / 2 条」→ 恢复后消息 2 条 → 彻底删除后 `aura_msgs_x2` 不存在 ✅ |
| 2 | 会话双 key | 高 | `SESSION_KEY` 统一 `aura_sessions`，旧键一次性搬入 | `records.js` | 新建可见 1 / 磁盘 1 ✅ |
| 3 | 删光后 `syncTitle` 抛错 | 高 | `currentSession()` 兜底 + `syncTitle` 判空 | `features.js` | 删光→新建：`异常 null`、标题「新的对话」、空态「我在。」✅ |
| 4 | idb 静默失败 | 中 | `warnOnce` + `state.lastError` | `idb.js` | `node --check` + 回归全过 ✅ |
| 5 | 导出时间随 locale | 中 | `toLocaleString` → `AuraTime.full()` | `features.js`、`voice.js` | 格式统一 ✅ |
| 6 | promptVersion 漂移 | 中 | 启动以 `PROMPT_VERSION` 为准对齐 | `app.js` | 两处一致 ✅ |
| 7 | `notify.can()` 写法晦涩 | 低 | `!activeRecently(t) === false` → `activeRecently(t)` | `notify.js` | 守卫逻辑实测同上 ✅ |
| 8 | 新模块的 catch 全静默 | 低 | 15.18 段 catch 改为 `console.warn` | `app.js` | 控制台可见失败原因 ✅ |

**回归**：`node tests/eval_all.js --offline` → **全部通过**。
**打包**：v1.0.21；APK `4,782,777 B`（4.56 MB）sha256 `9a3dcd09f8326e68…`；exe `安静陪伴-1.0.21-x64.exe` **78.3 MB**；APK 内 `sk-` **0 命中**；`wide.js / keys.js / notify.js / wide.css` 均在包内。

---

## 五、未修复与待办

| 项 | 为什么这轮没做 | 建议什么时候做 |
|---|---|---|
| 第三部分：per-request usage / 费用 / 导出导入 / 开发者页（24~35） | 按你「每部分停下」的节奏停在这里 | **下一轮第一优先** |
| 控制台 P0：提示词版本 + diff + 秒级回滚 + 短句 CSV（36~40） | 同上 | 第二优先（运维风险唯一解） |
| 聊天记录库页面（验收 9/10） | 页面不存在 | 与第三部分一起 |
| 通知跨设备共用计数（23 的后半） | 无上报通道 | 随第三部分导出/上报一起 |
| 托盘行为目视验证（20） | 需启动 exe 点一次关闭按钮 | 你开机后点一下即可 |
| `prompt.js` 相对时间文字、左栏 4 秒轮询 | 低优先 | 随时 |

---

## 六、已知风险

**1. 拔线、关机、开 5G、杀进程重开，她能正常回话吗？**
**能**，前提是装 **v1.0.21** 且填过 Key（直连 `api.deepseek.com` 实测成功）；无 Key 时零请求 + 明确引导。4G 下的真实首字延迟**需你真机实测**。

**2. 卸载重装，聊天记录会丢吗？**
**会丢**（Android 卸载清数据）。软删除的备份也在本地。重装前先在「设置 → 导出」存 JSON。

**3. 出门在外有没有功能依赖局域网？**
**没有。** 资源全在包内、聊天直连、天气走公网、配置拉新走 gh-proxy/Pages。唯一降级：`/api/tts` 失败 → 回落系统语音。

**4. 提示词改坏了多久能回滚？**
**不能秒级回滚**——提示词写死在 `prompt.js`，只能改代码重打包（3~5 分钟 + 重装）。控制台 P0 仍**未做**。

**5. 免费额度还能用多久？**
**需实测**——小纯没有你账户的余额数据，只能到 platform.deepseek.com 自行查看。

---

## 七、下一轮建议

| 优先级 | 事项 | 理由 |
|---|---|---|
| 1 | 第三部分：usage 明细 + 费用 + 导出导入 | 验收 24~35 全空，且决定「花多少钱」 |
| 2 | 控制台 P0：提示词版本/diff/秒级回滚 | 消除「改坏要重打包」的高危项 |
| 3 | 聊天记录库页面 | 验收 9/10 卡在这，也是导出入口 |
| 4 | 通知跨设备计数 | 验收 23 的后半 |
| 5 | 真机 a~h + 托盘目视 | 只有你能做 |

---

## 八、版本信息

| 项 | 值 |
|---|---|
| 版本号 | **1.0.21**（versionCode 19） |
| APK 体积 | **4,782,777 B（4.56 MB）**，sha256 `9a3dcd09f8326e68…` |
| exe 体积 | **78.3 MB**（`安静陪伴-1.0.21-x64.exe`） |
| 数据库 schemaVersion | **1**（`SUPPORTED_SCHEMA`）；IndexedDB `DB_VERSION = 2` |
| promptVersion | **v1.0.0** |
| configVersion | **28** |
