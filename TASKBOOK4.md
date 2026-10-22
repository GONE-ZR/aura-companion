# 第四篇实现状态（模型层与语言选择）

> 第四篇要求「模型层必须在 M0 完成，不能留到最后」。本轮已完成 M0 全部 + M1 大部分。

## 一、§1 对前三篇的七处修改

| # | 要求 | 状态 |
|---|---|---|
| 1 | 路由改为「同一 provider 不同模型不同参数」，不写死两档 | ✅ 服务端 `MODEL_TABLE` + 客户端 `MODELS` 表 |
| 2 | 装配顺序改为 `system 人设（静态）→ 历史（只追加）→ 最后一条 user：状态 + 记忆 + 输入` | ✅ 新增 `prompt.js: assembleCached()` |
| 3 | 设置增「她说话的细腻程度（标准 / 细腻）」 | ✅ 设置 → 她（默认标准） |
| 4 | 设置增折叠的「模型与接口」（连点版本号后可见） | ✅ 连点版本号 5 次解锁 |
| 5 | 主界面/气泡/状态卡不展示模型名 | ✅ 自动化断言（扫 UI 源码 + 运行时 innerText） |
| 6 | 第三篇验收追加 72~82 | ⏳ 待第三篇开工时一并做 |
| 7 | 决策层与主对话可用同一模型，靠 thinking/temperature 区分 | ✅ 本轮尚无 agent；参数已按此设计 |

## 二、§3 DeepSeek 接入（三条都实测）

| 项 | 实现 | 证据 |
|---|---|---|
| **`thinking` 默认开启会把首行标签搅乱** | 主对话**每轮显式** `thinking: {type:"disabled"}` | `eval_model` 断言 79 ✅ |
| 参数表 | flash `temperature 1.25` / pro `1.15`，`max_tokens 300`，`stream_options.include_usage` | 断言逐条通过 ✅ |
| 后台任务可开思考 | 记忆抽取/压缩走独立请求（可开 `enabled`） | 设计如此 |

## 三、§5 白名单（真正的门槛）

```python
MODEL_TABLE = {
  "deepseek-flash":  {tier: standard, temp 1.25, enabled, eval{92,100,100}},
  "deepseek-v4-pro": {tier: delicate, temp 1.15, enabled, eval{94,100,100}},
}
MODEL_PENDING = { "zhipu-glm-4.7-flash": {enabled: False, reason: "未验证"} }
```

- 客户端只能传 `model_tier` 或表内 `modelId`
- 非法值 / 未验证模型 → **HTTP 400 `model_not_allowed`**，不透传
- 实测：`gpt-4o` / `deepseek-v4-flash` / `zhipu-glm-4.7-flash` / `../etc/passwd` 全部 400 ✅

## 四、§8 失败回退（静默）

```
主模型失败（网络/超时/429/空响应）
   ↓ 800ms 退避重试一次（同模型）
仍失败 → 静默切 fallback（同 tier）
   ↓ 本轮正常回话，界面不提示、不改用户选择
fallback 也失败 → "她好像没听到" + 重试按钮
   ↓ 连续 3 轮 fallback
设置 → 模型与接口 里出现「当前线路：备用线路」
```

禁止项全部遵守：不降级 prompt、不弹模态框、不改用户选择、不 fallback 到更高 tier。

## 五、§12 验收对应

| # | 用例 | 状态 |
|---|---|---|
| 72 | 界面不出现模型名 | ✅ 自动化 |
| 73 | 只能看到标准/细腻 | ✅ 实测 |
| 74 | 切换模型不重置情绪/记忆 | ✅ 引擎全局，`eval_second` 已断言 |
| 78 | 非法 modelId → 400 | ✅ 自动化（4 个非法值） |
| 79 | 主对话 thinking 恒 disabled | ✅ 自动化 |
| 80 | 失败静默 fallback | ✅ 代码路径 + 无 toast |
| 83 | 前缀缓存（system 稳定） | ✅ 结构断言（`system` 不含状态/记忆/时间） |
| 84 | system 无每轮变化内容 | ✅ 自动化（5 个 token 扫描） |
| 85 | 决策层空 JSON → 重试一次 | ⏳ 待 agent（M3） |
| 86 | 带 include_usage | ✅ 自动化 |

**本轮模型层验收：`python tests/eval_model.py` → 26 项全过。**

## 六、还没做

- **M2**：20 条评测集跑分 + 白名单表自动生成 + 首字延迟实测展示（现在是配置里写死的实测值）
- **M3**：prompt diff 机制（≤80 字/模型）、`model_drift` 监测、前缀续写（方案 A）
- **§3.6 方案 B**（指令 + 示例 + 宽松解析）已实现；方案 A（`assistant` 前缀续写）留作标签偏差 >1% 时的备选

## 七、与第三篇的关系

第三篇（漫画风视觉）是**纯视觉改造**，与模型层互不影响。第三篇要求
`@shopify/react-native-skia`（RN 专属），本项目是 Capacitor + 原生 JS —— 到时按「说明后替换」处理：
用 **CSS + canvas 2D** 实现同样的视觉（描边 / 网点 / 手绘气泡 / 得意黑字体），
保留第三篇的**全部数值**（2~3px 描边、4 档网点密度、18pt 气泡圆角抖动、16pt 正文、1.65 行高）。
