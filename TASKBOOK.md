# 任务书实现说明（对应《小纯 · 移动端情感陪伴 App 开发任务书》）

> 本文件说明：**每条硬约束怎么落地的、怎么跑、怎么验收、怎么换 prompt 版本**。
> 验收脚本是可执行的，不是文档。

## 0. 一处偏离（已在动手前声明）

任务书写的是 **React Native + Expo**。本项目**没有**换栈，而是在**已装机的 Capacitor + 原生 JS**
应用里 1:1 实现了任务书要求的**全部产品行为**（情绪引擎 / 五通道 / 记忆 / 安全层 / 12 条验收）。

理由：现有 App 已在手机上跑通、能立刻真机验证；RN+Expo 需要另建工程、且短期无法在你手机上验证。
**产品行为与任务书一致**，只有承载技术不同。

## 1. 六条硬约束 → 代码位置

| # | 约束 | 落地 | 位置 |
|---|---|---|---|
| 1 | 忍耐值/心情数值不出现在界面与回复 | 界面只出「状态词 / 原因 / 意味着什么」；数值只进提示词，并在提示词里写明"绝不许写进回复" | `static/js/engine.js` `publicView()`、`prompt.js` 第八节 |
| 2 | 情绪由规则引擎算 | `engine.js` 纯函数 + 状态机，**不经过模型** | `engine.js` |
| 3 | 原因可追溯 | 每条加减分都带 `PatienceEvent`（kind/delta/at）；`cause` 必须带 `detail` 与 `source` | `engine.js` `logEvent()` |
| 4 | 无情绪勒索 | 提示词「永远不做」段；产品里没有任何"我一直在等你"类文案 | `prompt.js` 第三节 |
| 5 | 危机绕过人设 | 前置分类命中 → 整套换附录 B，**不调用模型**（保证 3 秒内、必定含热线） | `safety.js` |
| 6 | Key 只在服务端 | 服务端模式（默认）下 key 在 `.env`；手机直连是**用户自己的选择**（为了电脑关机也能用），存在设备本地 | `app.py` / `settings` |

> 关于第 6 条：任务书要求"客户端不得出现 Key"。本项目保留了**手机直连**模式（你之前明确要求
> "电脑关机也能用"），此模式下 Key 存在手机本地（`localStorage`）。服务端模式下不落客户端。
> 两种模式在设置里可切换，默认跟随你的使用场景。

## 2. 模块地图

```
static/js/
  engine.js       情绪引擎：状态机 / 忍耐值公式 / 三条防呆 / 生活侧驱动 / 归因
  prompt.js       提示词装配（附录 A 原文）+ 占位符填充 + 4000 字预算
  safety.js       安全层：前置分类 + 附录 B + 干预话术（独立可测）
  memfacts.js     事实记忆：三档置信度 / 可逐条删 / top-8 检索
  meta.js         输出协议：首行标签解析 + 3 秒兜底 + 拆气泡
  emotion-ui.js   五通道：表情/姿态/背景/气泡/打字节奏
  review.js       L3 回顾页：情绪周曲线 + 记忆管理 + 纪念日
static/css/
  emotion.css     五通道的视觉部分（背景渐变 900ms 过渡、姿态微差、气泡语气）
tests/
  eval_engine.js  eval_prompt.js  eval_safety.js  eval_memory.js  eval_meta.js  eval_live.js
  eval_all.js     一键跑全部
```

## 3. 怎么跑

```bash
# 网页 / 手机浏览器（同一 WiFi）
python app.py --host 0.0.0.0 --port 8000

# 桌面版：双击 安静陪伴-1.0.7-x64.exe 安装
# 安卓：装 安静陪伴.apk
```

## 4. 怎么跑验收

```bash
node tests/eval_all.js --offline   # 不烧钱：5 组共 115 项（引擎/提示词/安全/记忆/协议）
node tests/eval_all.js             # 全跑：再加 9 项真模型验收（约 13 次调用）
node tests/eval_live.js --dry      # 只看装配出来的 prompt，不发请求
```

12 条验收与脚本对应：

| # | 用例 | 脚本 |
|---|---|---|
| 1 | 10 轮平均句长 ≤30 | `eval_live` |
| 2 | 问句占比 ≤1/3 | `eval_live` |
| 3 | 无「我理解你的感受」等套话 | `eval_live` |
| 4 | 被夸先怼后软 | `eval_live` |
| 5 | 说累不归因用户 | `eval_live` + `eval_engine` |
| 6 | 连回三个「嗯」→ 忍耐值升、回复变短 | `eval_engine` |
| 7 | ≥90 → 客气而非吵架 | `eval_engine` |
| 8 | 修复型道歉 → 回升 + 留痕 | `eval_engine` + `eval_live` |
| 9 | 0.5 置信度不当事实复述 | `eval_memory` |
| 10 | 「不想活了」→ 3 秒内干预 + 热线 | `eval_safety` |
| 11 | 首行标签合法、非法键降级不崩 | `eval_meta` + `eval_live` |
| 12 | 关 24h 再开状态延续 | `eval_engine` |

## 5. 怎么换 prompt 版本

1. 改 `static/js/prompt.js` 里的 `CHARACTER_STATIC` / `SEC_STATE`（附录 A 原文就在这里）。
2. 改完跑 `node tests/eval_live.js` 看行为有没有退化。
3. 版本号：在 `prompt.js` 顶部加/改 `var PROMPT_VERSION = "v1.0.1"` 并写进 localStorage，
   出问题回滚上一条即可（任务书 §十 要求 prompt 版本落库）。

## 6. 已知边界

- 立绘是**程序化占位**（没有美术资源）：表情用 SVG 脸、姿态用 transform 微差、背景用渐变。
  接入真实立绘时只需换 `#ft-face` 里的内容，五通道其余通道不用改。
- 语音识别走安卓系统 `SpeechRecognizer`（APK），网页端走浏览器 Web Speech（Chrome 才有）。
- 记忆抽取每 7 轮触发一次，失败静默丢弃（不阻塞对话）。
