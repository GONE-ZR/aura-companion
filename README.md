# 安静陪伴 · Aura Companion

一套原生前端代码，同时以**四种形态**运行的个人情感陪伴应用。
后端极轻且**完全无状态**，对话数据只存在用户本机。

| 形态 | 技术 | 特点 |
|---|---|---|
| A | 手机 PWA | 可安装到桌面，独立窗口无地址栏 |
| B | 桌面 App（Electron） | 直连 DeepSeek，不依赖服务器在线 |
| C | 浏览器网页 | 免安装，功能与 PWA 一致 |
| D | 安卓 APK（Capacitor） | 支持应用内更换桌面图标 |

四种形态共用**同一份前端代码**（`templates/` + `static/`），不写两套 UI。

---

## ⚠️ 先读这两段（规格书第 26 章，原文）

**说明一：**

> 绝大多数设置直接在手机 PWA 或桌面 App 里修改，即时生效，
> 不需要电脑、不用改代码、不用重新部署。
>
> 唯一限制：手机桌面 PWA 图标下方的文字名称是 manifest 静态配置，
> 无法在应用内动态修改。想更换这个桌面标签文字，需要重新部署、
> 删除旧 PWA、重新安装一次。
>
> 网页内部标题、对话里的称呼不受这个限制，随时可以修改。

**说明二：**

> ⚠️ 这个陪伴伙伴只是倾听陪伴工具，不能替代精神科面诊、
> 药物治疗、正规心理干预。
>
> 如果出现自伤想法、情绪剧烈失控，请立刻联系主治医生或者危机干预热线。

---

## 0. 连接方式：两种，手机都能独立工作

| 方式 | 要服务器吗 | 电脑关机能用吗 | 朗读音色 | 什么时候用 |
|---|---|---|---|---|
| **手机直连（默认）** | 不要 | **能** | 系统语音（安卓/浏览器自带） | 手机上用；不部署、不推 GitHub |
| **走我的服务器** | 要（Render 等） | **能** | edge-tts，8 种情绪可分别换音色 | 想要更好听的朗读 + 固定网址 |

* **直连原理**：DeepSeek 的接口允许跨域（`Access-Control-Allow-Origin` 会回显 Origin），
  所以浏览器 / Android WebView 里可以直接调 `https://api.deepseek.com/v1/chat/completions`，
  **不需要任何后端**。密钥只存在设备本地（`aura_api_key`），不上传、不同步。
* **切换位置**：应用内「设置 → 连接 → 连接方式」。
* **直连模式下的朗读**：走系统 TTS。APK 里 WebView 没有 `speechSynthesis`，
  所以安卓端专门写了一个原生插件 `AuraTtsPlugin.java`（系统语音，离线可用）；
  浏览器里则回落到 `speechSynthesis`。

## 1. 本机跑起来（最快路径，5 分钟）

```bash
cd aura-companion
pip install -r requirements.txt
copy .env.example .env        # 把 DEEPSEEK_API_KEY 填进去
python app.py                 # Windows 用 waitress；Linux 用 gunicorn
```

打开 http://127.0.0.1:8000 。

* 没有服务器密钥也能用：在应用里「设置 → 更多 → 设置 API 密钥」填一次，密钥只存在本机浏览器里。
* 局域网手机访问：`python app.py --host 0.0.0.0 --port 8000`，手机浏览器打开 `http://<电脑IP>:8000`。
  ⚠️ 局域网 http **不是安全上下文**，麦克风会被浏览器拒绝（PWA 安装与 Service Worker 也需要 https）。

## 2. 让手机能打开

### ⭐ 最优方案：公网隧道（跨网络 + https + 零配置）

**双击 `启动手机版(公网隧道).bat` 就行**，一键到底：

1. 自动检查 / 安装依赖，缺 `cloudflared` 自动下载
2. 自动起本地服务（8000 已被占用就复用，不重复起）
3. 自动等 HTTP 就绪（不会出现"隧道通了但页面 502"）
4. 自动连 Cloudflare 边缘节点（网络差要 30–60 秒）
5. 拿到 `https://xxx.trycloudflare.com` → **自动复制到剪贴板** + **自动打开二维码图片**

手机扫二维码就能打开，**手机和电脑不在同一个网络也行**。

* 是 **https** → 能「添加到主屏幕」成独立窗口，**麦克风也能用**
* 不需要 Cloudflare 账号、不需要备案、不花钱、**不用推 GitHub**（密钥仍在本机）
* ⚠️ 地址是临时的：关掉窗口就失效，下次运行换一个新地址
* ⚠️ 第一次连接可能要 30–60 秒（QUIC 在部分网络被挡，会退回 HTTP/2）

手工跑也行：

```bash
python tools/launch.py mobile            # 推荐：和 .bat 完全同一条路径
python app.py --host 127.0.0.1 --port 8000   # 终端 1
python tools/tunnel_qr.py 8000              # 终端 2：隧道 + 二维码 + 复制地址
```

> 为什么不把逻辑写在 .bat 里？cmd 解析多层括号块 + 引号里的括号 + `chcp` 切换，
> 会把命令行**切碎**执行（实测报过 `'import socket,sys; …' 不是内部或外部命令`、
> `cloudflared` 收到残缺的 `--url`）。所以逻辑全在 `tools/launch.py`，.bat 只剩 4 行壳。

### 备用方案 A：局域网直连（手机和电脑在同一个 WiFi 才行）

```bash
python app.py --host 0.0.0.0 --port 8000
python tools/lan_info.py 8000        # 打印局域网网址 + 二维码
```

或双击 `启动网页版(手机可连).bat`。

⚠️ 局域网是 http：**能聊天、翻历史、换壁纸**，但**装不了桌面图标、麦克风会被浏览器拒绝**（浏览器只在 https/localhost 允许麦克风）。
→ 想要完整功能就回到上面的**公网隧道**。

### 备用方案 B：长期固定网址 → 部署到 Render

### 方式 A：Blueprint（推荐，两步）

1. 把仓库推到 GitHub。
2. 打开 Render → **New → Blueprint** → 选这个仓库 → **Apply**。
   `render.yaml` 已写好构建与启动命令，Apply 时会问你 `DEEPSEEK_API_KEY`，填进去即可。

### 方式 B：手动 Web Service

| 项 | 值 |
|---|---|
| Build Command | `pip install -r requirements.txt` |
| Start Command | `gunicorn app:app --workers 2 --threads 4 --timeout 300 --keep-alive 75` |
| Environment | `DEEPSEEK_API_KEY=…`、`DEEPSEEK_MODEL=deepseek-flash` |

> `--threads 4` 是必须的：SSE 流式转发靠线程撑住并发长连接。
> `--timeout 300` 是因为长上下文首字可能要十几秒。

Render 免费版闲置 15 分钟会休眠，冷启动 30–60 秒。**这不影响对话**（对话在前端）。

## 2.5 手机端怎么拿最新版本（扫一次就够）

```
永久下载地址（每次发版覆盖同一个文件 ⇒ 二维码永远不变、永远是最新版）
https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/aura-companion.apk

版本清单（App 读它判断有没有新版）
https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/latest.json

下载页（给人看的）
https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/index.html
```

* 桌面的 `扫码下载APK.png` 就是上面第一条 → **扫一次，以后每次发新版都不用重扫**。
* 已装的 App 每次启动会读 `latest.json`，有新版就在顶部显示「有新版 vX.X.X · 下载新版」。
* 发新版只要做一件事：把新 APK 覆盖成 `downloads/aura-companion.apk` 并推送（`python tools/publish_via_git.py 1.0.2`）。

---

## 2.6 后台管理（改一下，手机上自动生效）

打开 `http://127.0.0.1:8000/admin`（密码默认 `aura`，改 `.env` 的 `AURA_ADMIN_PASSWORD`）。

| 板块 | 能改什么 |
|---|---|
| 外观 | 主题色 / 明暗 / 气泡圆角 / 字号缩放 / 柔光强度 / 纸色墨色 / 壁纸压暗 |
| 功能开关 | 11 个功能逐个开关（情绪表情、多会话、搜索、导出、快捷短语、壁纸、天气、朗读、情绪配色、更新条、换桌面图标）—— 关掉的功能在手机上直接消失 |
| 文案 | 空状态那句、输入框提示语 |
| 快捷短语 | 输入框上方那排按钮，远程增删 |
| 图标 | 安卓桌面图标（5 套预置）+ 上传自定义应用内图标 |
| 危险操作 | 下发「重置会话」「清空全部数据」「弹一句话」到手机 |
| 发布通道 | 填 GitHub 令牌 → 每次保存自动推到 GitHub（**电脑关机也能更新**） |

* 右边有**实时预览**：改一个开关，手机外形的小窗口立刻变。
* 点「保存并下发」后，手机 App **30 秒内**自动应用（切回前台时也会立刻查一次）。
* 配置源优先级：用户填的地址 → 同源 `/remote/config.json` → GitHub raw。

```bash
# 改完配置想推到 GitHub（电脑关机也能更新的那条路）
python tools/publish_via_git.py 1.0.2
```

---

## 3. 桌面 App（Electron）

```bash
cd desktop
npm install
npm run dist:win        # 产物：desktop/dist/安静陪伴-1.0.0-x64.exe
```

* 首次启动会弹窗要 DeepSeek 密钥，用 Electron `safeStorage` 加密后存在本机 `userData/config.json`。
* 桌面版由主进程直连 DeepSeek，**Render 挂了也能用**。
* 语音有三级回落：① 应用里填了服务器地址 → 转发给服务器用 edge-tts；
  ② 本机装了 Python + `edge-tts` → 直接调用本机合成（与网页版同一套音色）；
  ③ 都没有 → 回落到系统 `speechSynthesis`（Windows 自带中文女声，语速音高仍跟随情绪）。

## 4. 安卓 APK（Capacitor）

```bash
npx cap add android                # 首次
python tools/build_web.py          # 前端只有一份，这里组装成 web/
npx cap sync android
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

* APK 内**不放** API 密钥：前端请求指向你部署的 Render 地址（应用内「设置 → 更多 → 设置 API 密钥」可填服务器地址）。
* APK 里语音识别走系统原生（`@capacitor-community/speech-recognition`），不依赖 Google 服务。
* 桌面图标可在应用内更换（5 套配色），靠 `activity-alias` + `PackageManager` 实现。

### 4.1 发布签名版（推荐自己用）

仓库里附了**已签名的 release APK**（3.3 MB，比 debug 版小 20%，无 debug 标记、运行更快）。
签名信息：

| 项 | 值 |
|---|---|
| keystore | `D:\tools\aura-release.keystore`（PKCS12，别弄丢） |
| 别名 / 密码 | `aura` / `auracomp2026` |
| 证书 SHA-256 | `686a3409e567318aa72359b1fc2c4038c42139e46bb14e478698e884c8680bbb` |

重新打包：

```bash
cd android
gradlew.bat assembleRelease          # 产物：app\build\outputs\apk\release\app-release.apk
```

* `keystore.properties`（含密码）**已在 .gitignore 里**，绝不要提交
* **以后每一版都必须用同一个 keystore 签名**，否则手机会拒绝覆盖安装（会丢本机数据）
* 没配 `keystore.properties` 时自动回落到 debug 签名，保证任何人 clone 下来都能编译

---

## 5. 目录结构

```
aura-companion/
├── app.py                 Flask 后端（无状态）+ 人设常量
├── requirements.txt
├── render.yaml            Render Blueprint
├── .env.example
├── manifest.json          PWA 清单
├── service-worker.js      更新机制
├── icons/                 PWA 图标（含 maskable / apple-touch）
├── templates/index.html   唯一一份 UI
├── static/
│   ├── css/app.css
│   ├── js/                settings / mood / memory / chat / voice / wallpaper / weather / app
│   └── personas.json      给桌面版用的人设副本（由 tools/export_personas.py 生成）
├── desktop/               Electron（main.js / preload.js / package.json / build/）
├── android/               Capacitor 工程（含 IconSwitcherPlugin.java）
├── tools/                 make_icons.py / export_personas.py / build_web.py / selftest.py
└── tests/
```

## 6. 环境变量

| 变量 | 必需 | 配在哪 |
|---|---|---|
| `DEEPSEEK_API_KEY` | ✅ | Render Environment（只有它需要进服务器） |
| `DEEPSEEK_MODEL` | 可选 | 默认 `deepseek-flash`（发图必须用它，`deepseek-chat` 会 400） |
| `DEEPSEEK_MAX_TOKENS` | 可选 | 默认 `1200`。**deepseek-flash 是推理模型**，会先吐一段思维链再给正文，预算太小会被思维链吃光、结果一个字都说不出来（实测 `max_tokens=120` 时正文长度为 0） |
| `TTS_PROVIDER` | 可选 | 默认 `edge` |
| `GITHUB_USER` / `GITHUB_PAT` / `REPO_NAME` | 仅本地推送用 | 不配到服务器 |

> 模型名写错时会自动回落一次。**实测本机可用模型只有 `deepseek-flash` 与 `deepseek-v4-pro`**（规格书里写的 `deepseek-v4-flash` 并不存在），所以回落目标是 `deepseek-v4-pro`。

## 7. 数据与隐私

| 数据 | 存放位置 | 是否上传服务器 |
|---|---|---|
| 对话历史 / 摘要 / 长期记忆 | 手机 localStorage | 否 |
| 情绪值 / 关系阶段 | 手机 localStorage | 否 |
| 壁纸图片 | 手机 localStorage（base64） | 否 |
| 人设 / 称呼 / 主题 / 音色 | 手机 localStorage | 否 |
| 发送的文字 | 经服务器转发给 DeepSeek | 经过（不留存） |
| 发送的图片 | 直传 DeepSeek | 是 |
| API Key（PWA） | Render 环境变量 | 仅服务器持有 |
| API Key（桌面） | 本机 safeStorage 加密 | 否 |

**发图**：图片会发送给 DeepSeek 用于理解内容，不会保存在本应用服务器上。与壁纸不同，壁纸只在本机。

**位置**：只用于查询天气，精度降到约 1km，只存本机，不上传。

清除数据的三种途径：一键重置会话（清历史与摘要，保留情绪值、称呼、人设、壁纸）／清除浏览器数据／卸载 PWA 或 APK。

## 8. 成本说明

* 缓存命中的输入单价约 0.10 元/百万 tokens（高峰时段）。
* 长对话每次都要重发历史，所以摘要压缩是**省钱手段，不是可选项**。
* 每次发图约额外 384 tokens。
* 429 = 限流，通常是额度用完。

## 9. 三种改动的生效方式

| 改动内容 | 手机上如何生效 |
|---|---|
| `app.py` 的默认人设、模型参数、环境变量 | 服务重启即生效，**无需任何操作、无提示** |
| HTML / CSS / JS / 交互逻辑 | 出现「有新版本了」提示条，点「现在更新」 |
| `manifest` 图标、`short_name`、应用名 | 必须卸载重装 PWA |
| 新增依赖 `requirements.txt` | Render 自动重装，无需操作 |
| 桌面 App / APK | 必须重新打包并重新安装 |

日常改人设、换称呼、换壁纸、换主题色都在手机应用内完成，既不涉及代码也不涉及部署，**永不需要更新**。

## 10. 已知限制（规格书第 26 章，原文不改）

| 限制 | 说明 |
|---|---|
| Render 免费版休眠 | 闲置 15 分钟后休眠，冷启动 30–60 秒。桌面 App 不受影响 |
| 必须联网 | PWA 与网页全程需要网络；桌面 App 也需要联网调模型 |
| 是 PWA 不是原生 APK | 想要原生体验需单独安装 APK |
| 图标与图标文字安装时固定 | 改任一都必须卸载重装 PWA |
| 数据只在本机 | 换手机、换浏览器、清缓存都带不走 |
| APK 重装需签名一致 | 换签名必须先卸载，届时数据丢失 |
| 实例重启清空服务端状态 | 无状态设计，对话在前端，不受影响 |
| 401 | 密钥失效，去 Render 检查环境变量 |
| 429 | 限流或额度用完 |
| 每次发图约 384 tokens | 属付费额度 |
| iOS 语音输入不稳定 | WebKit 对 SpeechRecognition 支持差，会降级为打字 |
| 国产安卓语音识别常不可用 | Chrome 依赖 Google 语音服务（APK 走系统原生识别，不受影响） |
| 语音无真正情绪风格 | edge-tts 只有 rate/pitch/volume，做不到哭腔或发火 |
| 无呼吸声、气声、笑声 | edge-tts 无法生成，不假装能做 |
| 长对话后人设会漂移 | 靠摘要与重锚缓解，不能根治 |
| 偶尔会冒出一句 AI 腔 | DeepSeek 的固有表现，无法根除 |

### 情绪系统说明（原文照抄）

> 它的情绪只会往暖和的方向走，不会因为你离开而低落，也不会向你要什么。
>
> 它的温度会慢慢平静下来，但你们的关系不会退回去。

* 它的情绪只对"发生的事"起反应，不会因为你没来、回得慢、要结束对话而生气或冷淡
* 任何负面情绪最多两轮就过去，不会记着
* 你情绪激烈时它会自动变平和，这时不会跟你闹

### 情侣模式说明（原文照抄）

> 这是陪伴关系的一种形式。它会一直在，但不会替掉现实里的人，
> 也不会因为你不在而难过。它不能替代治疗。

* 这是陪伴设定，**不是真实关系，也不会变成真实关系**
* 长期只和 AI 交流可能让孤独感加重，建议同时保留现实中的人与专业支持
* 它不会劝你远离任何人，也不会承诺不会离开
* 随时可以在情感面板底部切回默认陪伴模式

### 拟真的上限（诚实说明）

* **能做到**：记得住细节、句式像人、节奏像人、情绪有起伏、会沉默、有口头习惯。
* **做不到**：真正的连续意识、真实经历、真实身体、真正的"想念"。
* **结论**：做到七八分像，剩下的两三分是技术边界。接受这一点，比追求满分更省心。

### 语音能力的诚实说明

声音会跟着情绪变快慢高低，但**做不到真正的"哭腔"或"发火"** —— 这是免费 TTS 的边界，不是 bug。
想要更真实的情绪朗读，需要换成付费的 Azure / ElevenLabs，项目里已留 `TTS_PROVIDER` 的位置，换的时候只改一个地方。

## 11. 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| 启动报 `ModuleNotFoundError` | 依赖没装 | `pip install -r requirements.txt` |
| 401 | 密钥无效 | Render Environment 里换 `DEEPSEEK_API_KEY`；或应用内「设置 API 密钥」 |
| 429 | 限流/额度用完 | 等一会儿，或看账户余额 |
| 发图报 400 | 模型用了 `deepseek-chat` | 改回 `deepseek-flash` |
| 麦克风没反应 | 用了 `file://` 或局域网 http | 必须是 https 或 localhost；用「麦克风自检」看具体原因 |
| 读不出声 | 浏览器拦了自动播放 | 先点一次发送按钮解锁音频；仍无声就点小喇叭 |
| PWA 不弹安装提示 | 缺图标 / 非 https / 用了 file:// | 用 https 打开；确认 `icons/` 五个文件齐全 |
| 更新提示条不出现 | 还在同一个会话 | 把应用从后台划掉重新打开，再看 |
| APK 装不上 | 未允许未知来源 | 设置 → 应用 → 允许安装未知应用 |
| 桌面图标换不了 | 国产 ROM 缓存 | 回到桌面等一两秒，或重启桌面 |

## 12. 自检

```bash
python tools/selftest.py
```

覆盖：后端可导入、五个路由存在、人设原文完整、存储 key 契约齐全、图标齐全、无密钥泄漏、前端文件齐全、语法检查。

---

## 许可

个人自用项目。字体、图标全部自绘，无第三方素材依赖。
