/* ============================================================
   desktop/main.js —— 桌面 App 主进程
   · 内部起一个本地 HTTP 服务，把前端 bundle 喂给渲染进程
   · /api/chat 与 /api/chat/stream 由主进程直连 DeepSeek（不依赖服务器在线）
   · API Key 用 safeStorage 加密后存在 userData/config.json
   ============================================================ */
const { app, BrowserWindow, ipcMain, safeStorage, dialog, session } = require("electron");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const ROOT = app.isPackaged
  ? path.join(process.resourcesPath, "aura")   /* 打包后：resources/aura/ */
  : path.resolve(__dirname, "..");             /* 开发时：项目根 */
const PORT = 8731;
let win = null;

/* ---------------- 密钥存取（safeStorage 加密） ---------------- */
function configPath() {
  return path.join(app.getPath("userData"), "config.json");
}
function readConfig() {
  try {
    const raw = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}
function writeConfig(obj) {
  try {
    fs.mkdirSync(path.dirname(configPath()), { recursive: true });
    fs.writeFileSync(configPath(), JSON.stringify(obj), "utf8");
    return true;
  } catch (e) {
    return false;
  }
}
function getApiKey() {
  const cfg = readConfig();
  if (cfg.encKey && safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(cfg.encKey, "base64"));
    } catch (e) {
      return "";
    }
  }
  return "";
}
function setApiKey(plain) {
  const cfg = readConfig();
  if (!plain) {
    delete cfg.encKey;
  } else if (safeStorage.isEncryptionAvailable()) {
    cfg.encKey = safeStorage.encryptString(plain).toString("base64");
  } else {
    cfg.plainKey = plain; /* 兜底：无系统加密时也要能用 */
  }
  writeConfig(cfg);
}

/* ---------------- 静态资源 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml"
};

function serveFile(res, filePath, noCache) {
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if (noCache) headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
    res.writeHead(200, headers);
    res.end(buf);
  });
}

function resolveWebPath(urlPath) {
  let p = decodeURIComponent(urlPath.split("?")[0]);
  if (p === "/" || p === "") return path.join(ROOT, "templates", "index.html");
  if (p === "/service-worker.js") return path.join(ROOT, "service-worker.js");
  if (p === "/manifest.json") return path.join(ROOT, "manifest.json");
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) return null;          /* 防路径穿越 */
  return full;
}

/* ---------------- 直连 DeepSeek ---------------- */
function apiKeyFrom(req) {
  const header = req.headers["x-aura-key"];
  if (header && String(header).trim()) return String(header).trim();
  return getApiKey();
}

function buildUpstreamBody(body) {
  const system = (body.system_prompt || "").trim();
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  (body.messages || []).forEach((m) => {
    if (m && m.content) messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: m.content });
  });
  const images = body.images || [];
  if (images.length && messages.length && messages[messages.length - 1].role === "user") {
    const blocks = [{ type: "text", text: messages[messages.length - 1].content || "给你看一张图" }];
    images.forEach((img) => {
      if (typeof img === "string" && img.startsWith("data:image")) {
        blocks.push({ type: "image_url", image_url: { url: img } });
      }
    });
    messages[messages.length - 1] = { role: "user", content: blocks };
  }
  return {
    model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
    messages,
    temperature: body.temperature === undefined ? 0.7 : body.temperature,
    max_tokens: body.max_tokens || 600,
    stream: false
  };
}

function handleChat(req, res) {
  let raw = "";
  req.on("data", (c) => {
    raw += c;
    if (raw.length > 40 * 1024 * 1024) req.destroy();
  });
  req.on("end", async () => {
    const key = apiKeyFrom(req);
    if (!key) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "missing_key", message: "还没设置 API 密钥。" }));
      return;
    }
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
    try {
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify(buildUpstreamBody(body))
      });
      const text = await r.text();
      /* ⚠️ 必须和 Flask 的返回结构一致：{"reply": "...", "model": "..."}
         —— 前端（chat.js / memory.js / voice.js）按这个契约取内容。
         直接把上游原始 JSON 透传出去，前端会拿到一个没有 reply 字段的对象。 */
      if (r.status === 200) {
        let out;
        try { out = JSON.parse(text); } catch (e) { out = null; }
        const reply = out && out.choices && out.choices[0] && out.choices[0].message
          ? (out.choices[0].message.content || "") : "";
        if (!reply) {
          res.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: "empty", message: "模型没返回内容。" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ reply: reply, model: out.model || body.model || "deepseek-flash" }));
        return;
      }
      let errObj = { error: "upstream", message: "模型服务出错了。" };
      if (r.status === 401) errObj = { error: "unauthorized", message: "密钥无效。" };
      else if (r.status === 429) errObj = { error: "rate_limited", message: "额度或频率限制。" };
      res.writeHead(r.status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(errObj));
    } catch (e) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "network", message: "连不上模型服务。" }));
    }
  });
}

function handleChatStream(req, res) {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", async () => {
    const key = apiKeyFrom(req);
    if (!key) {
      res.writeHead(401, { "Content-Type": "text/event-stream" });
      res.end('data: {"error":"missing_key"}\n\n');
      return;
    }
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
    const payload = buildUpstreamBody(body);
    payload.stream = true;

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Connection": "keep-alive"
    });

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    try {
      const r = await fetch("https://api.deepseek.com/v1/chat/completions", {
        method: "POST",
        headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal
      });
      if (!r.ok || !r.body) {
        res.write('data: {"error":"upstream"}\n\n');
        res.end();
        return;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder("utf-8");
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const raw2 = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (raw2.trim()) res.write(raw2 + "\n\n");
        }
      }
      if (buf.trim()) res.write(buf + "\n\n");
      res.write("data: [DONE]\n\n");
    } catch (e) {
      if (!controller.signal.aborted) res.write('data: {"error":"network"}\n\n');
    } finally {
      res.end();
    }
  });
}

/* ---------------- 语音合成（桌面版三级回落） ----------------
   1) 远程服务器有 edge-tts（用户在应用里填了服务器地址时，前端会直接转发过去）
   2) 本机装了 Python + edge-tts → 这里调用它（与网页版同一套音色）
   3) 都没有 → 返回 501，前端回落到浏览器 speechSynthesis（规格 13.12）
   --------------------------------------------------- */
const { spawn } = require("child_process");
const os = require("os");
let pythonCmd = null;
let pythonChecked = false;

function findPython() {
  if (pythonChecked) return pythonCmd;
  pythonChecked = true;
  const cands = process.platform === "win32"
    ? [["py", ["-3"]], ["python", []]]
    : [["python3", []], ["python", []]];
  for (const [bin, pre] of cands) {
    try {
      /* 逐个候选真跑一次「能不能 import edge_tts」，不信任启动器本身 */
      const r = require("child_process").spawnSync(bin, pre.concat(["-c", "import edge_tts, sys; print(sys.executable)"]),
        { encoding: "utf8", timeout: 15000 });
      if (r.status === 0 && r.stdout && r.stdout.trim()) {
        const exe = r.stdout.trim();
        /* 再用这个解释器本身复核一次（py 启动器可能指向别的环境） */
        const v = require("child_process").spawnSync(exe, ["-c", "import edge_tts; print('ok')"],
          { encoding: "utf8", timeout: 15000 });
        if (v.status === 0 && (v.stdout || "").trim() === "ok") {
          pythonCmd = { bin, pre, exe };
          break;
        }
      }
    } catch (e) { /* ignore */ }
  }
  return pythonCmd;
}

/* 直接调 edge_tts 的 Python API，不走命令行入口
   （CLI 的 argparse / print 在无控制台环境里容易出岔子） */
const PY_TTS_SCRIPT = [
  "import asyncio,sys,edge_tts,os,json,base64",
  "text=base64.b64decode(sys.argv[1]).decode('utf-8')",
  "open(sys.argv[7],'w',encoding='utf-8').write(json.dumps({'text':text,'cwd':os.getcwd(),'exe':sys.executable},ensure_ascii=False))",
  "async def m():",
  "    c=edge_tts.Communicate(text,sys.argv[2],rate=sys.argv[3],pitch=sys.argv[4],volume=sys.argv[5])",
  "    b=bytearray()",
  "    async for ch in c.stream():",
  "        if ch.get('type')=='audio': b.extend(ch['data'])",
  "    open(sys.argv[6],'wb').write(bytes(b))",
  "asyncio.run(m())"
].join("\n");

function ttsViaPython(text, voice, rate, pitch, volume) {
  const py = findPython();
  if (!py) { logTts("no python with edge_tts"); return Promise.resolve(null); }
  const stamp = Date.now();
  const out = path.join(os.tmpdir(), "aura-tts-" + stamp + ".mp3");
  const diag = path.join(os.tmpdir(), "aura-tts-" + stamp + ".diag.json");
  /* ⚠️ 必须用 findPython 解析出来的「真实解释器路径」，
     不能用 py 启动器 —— 机器上装了失效的 py -3 指向 D:\python 时，
     检测能过、真合成却直接失败。
     ⚠️ 中文必须用 base64 传 —— Electron 的 spawn 默认 windowsVerbatimArguments=true，
     非 ASCII 参数会按 ANSI 代码页丢字（中文会变成 "??,?????"）。 */
  const b64 = Buffer.from(String(text), "utf8").toString("base64");
  const args = ["-c", PY_TTS_SCRIPT, b64, voice, rate, pitch, volume, out, diag];
  return new Promise((resolve) => {
    const p = spawn(py.exe, args, { windowsHide: true, env: process.env });
    let err = "";
    p.stderr.on("data", (d) => { err += d.toString(); });
    p.on("error", (e) => { logTts("spawn error: " + e.message); resolve(null); });
    p.on("close", (code) => {
      let d = "";
      try { d = fs.readFileSync(diag, "utf8"); } catch (e2) { d = "(no diag)"; }
      if (code !== 0) {
        logTts("edge_tts exit " + code + " err=" + err.slice(0, 1200) + " diag=" + d.slice(0, 800));
        resolve(null);
        return;
      }
      fs.readFile(out, (e, buf) => {
        try { fs.unlinkSync(out); } catch (e2) { /* ignore */ }
        try { fs.unlinkSync(diag); } catch (e2) { /* ignore */ }
        if (e || !buf || !buf.length) { logTts("read audio failed: " + (e && e.message)); resolve(null); }
        else resolve(buf);
      });
    });
  });
}

/* 语音问题写日志，方便排查 */
function logTts(msg) {
  try {
    const p = path.join(app.getPath("userData"), "aura.log");
    fs.appendFileSync(p, new Date().toISOString() + " TTS " + msg + "\n", "utf8");
  } catch (e) { /* ignore */ }
}

async function handleTts(req, res) {
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 200000) req.destroy(); });
  req.on("end", async () => {
    let body = {};
    try { body = JSON.parse(raw || "{}"); } catch (e) { body = {}; }
    const text = String(body.text || "").slice(0, 2000);
    if (!text) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "empty" }));
      return;
    }
    const voice = body.voice || "zh-CN-XiaoxiaoNeural";
    const rate = body.rate || "+0%";
    const pitch = body.pitch || "+0Hz";
    const volume = body.volume || "+0%";
    const buf = await ttsViaPython(text, voice, rate, pitch, volume);
    if (!buf) {
      res.writeHead(501, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "provider", message: "桌面端使用系统语音。" }));
      return;
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" });
    res.end(buf);
  });
}

/* ---------------- 人设模板 ---------------- */
function handlePersonas(res) {
  const p = path.join(ROOT, "static", "personas.json");
  fs.readFile(p, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache" });
    res.end(buf);
  });
}

/* ---------------- 本地服务 ---------------- */
function startServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const urlPath = (req.url || "/").split("?")[0];

      if (urlPath === "/api/chat" && req.method === "POST") return handleChat(req, res);
      if (urlPath === "/api/chat/stream" && req.method === "POST") return handleChatStream(req, res);
      if (urlPath === "/api/personas") return handlePersonas(res);
      if (urlPath === "/api/version") {
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({
          version: app.getVersion(),
          date: new Date().toISOString().slice(0, 10),
          model: process.env.DEEPSEEK_MODEL || "deepseek-flash",
          has_key: !!getApiKey(),
          tts_provider: findPython() ? "edge-local" : "electron-fallback",
          desktop: true
        }));
        return;
      }
      if (urlPath === "/api/tts" && req.method === "POST") {
        return handleTts(req, res);
      }
      if (urlPath === "/api/reset") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      const file = resolveWebPath(urlPath);
      if (!file) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      /* SW 里注入版本号：浏览器靠 SW 字节变化来判断有没有新版本 */
      if (urlPath === "/service-worker.js") {
        try {
          const raw = fs.readFileSync(file, "utf8").replace(/__APP_VERSION__/g, app.getVersion());
          res.writeHead(200, {
            "Content-Type": "text/javascript; charset=utf-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Service-Worker-Allowed": "/"
          });
          res.end(raw);
        } catch (e) {
          res.writeHead(500);
          res.end("sw error");
        }
        return;
      }
      const noCache = /\.(html)$/i.test(file);
      serveFile(res, file, noCache);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

/* ---------------- 首次启动的密钥设置页 ---------------- */
function askForKey(parent) {
  return new Promise((resolve) => {
    const w = new BrowserWindow({
      width: 460,
      height: 330,
      parent: parent || undefined,
      resizable: false,
      minimizable: false,
      maximizable: false,
      title: "设置 API 密钥",
      backgroundColor: "#16191B",
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    const html = `<!doctype html><html><head><meta charset="utf-8">
      <style>
        body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:#16191B;color:#D9DDDB;padding:26px}
        h1{font-size:16px;font-weight:600;margin:0 0 6px}
        p{font-size:13px;color:#8E9694;line-height:1.7;margin:0 0 16px}
        input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:14px;border:1px solid #2E3436;
              background:#1F2426;color:#D9DDDB;font-size:14px}
        .row{margin-top:16px;display:flex;gap:10px;justify-content:flex-end}
        button{padding:9px 18px;border-radius:14px;border:1px solid #2E3436;background:transparent;color:#D9DDDB;font-size:13px;cursor:pointer}
        button.p{background:#8CA6A0;border-color:#8CA6A0;color:#12181A}
        .err{color:#C0A0A0;font-size:12px;margin-top:10px;display:none}
      </style></head><body>
      <h1>填一个 DeepSeek API 密钥</h1>
      <p>密钥会用系统加密（safeStorage）存在本机，不进源码、不联网同步。<br>
         在 platform.deepseek.com → API keys 里创建。</p>
      <input id="k" type="password" placeholder="sk-..." autofocus>
      <div class="err" id="e"></div>
      <div class="row"><button id="c">取消</button><button id="s" class="p">保存</button></div>
      <script>
        const k=document.getElementById('k'), e=document.getElementById('e');
        document.getElementById('s').onclick=()=>{
          if(!k.value.trim()){e.style.display='block';e.textContent='密钥不能为空';return;}
          window.__save(k.value.trim());
        };
        document.getElementById('c').onclick=()=>window.__cancel();
        k.addEventListener('keydown',ev=>{if(ev.key==='Enter')document.getElementById('s').click();});
      </script></body></html>`;
    w.setMenuBarVisibility(false);
    w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
    w.webContents.on("did-finish-load", () => {
      w.webContents.executeJavaScript(
        "window.__save=(v)=>{require('electron').ipcRenderer.send('key:save',v);};" +
        "window.__cancel=()=>{require('electron').ipcRenderer.send('key:cancel');};"
      );
    });
    ipcMain.once("key:save", (_e, v) => { setApiKey(v); w.close(); resolve(true); });
    ipcMain.once("key:cancel", () => { w.close(); resolve(false); });
    w.on("closed", () => resolve(false));
  });
}

/* ---------------- 窗口 ---------------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 860,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: "#16191B",
    title: "安静陪伴",
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.loadURL("http://127.0.0.1:" + PORT + "/");
  win.on("closed", () => { win = null; });
}

/* ---------------- 生命周期 ---------------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });

  app.whenReady().then(async () => {
    /* 麦克风权限放行 */
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      if (permission === "media" || permission === "audioCapture") return callback(true);
      callback(false);
    });

    await startServer();

    if (!getApiKey()) {
      await askForKey(null);
    }
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

/* ---------------- preload 桥 ---------------- */
ipcMain.handle("aura:hasKey", () => !!getApiKey());
ipcMain.handle("aura:setKey", (_e, v) => { setApiKey(String(v || "")); return true; });
ipcMain.handle("aura:exportData", () => null);
