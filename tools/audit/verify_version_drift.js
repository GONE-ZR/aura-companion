/* 修正一验证：改配置 → 重开 App → 读到新值（含截图） */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9381;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6ver");
const EVID = path.join(__dirname, "p6-evidence");
const BASE = "http://127.0.0.1:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p, body, cookie) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: 8000, path: p, method, headers: Object.assign(
      { "Content-Type": "application/json" }, data ? { "Content-Length": Buffer.byteLength(data) } : {}, cookie ? { Cookie: cookie } : {}) }, (resp) => {
      let b = ""; resp.on("data", (c) => (b += c));
      resp.on("end", () => res({ status: resp.statusCode, headers: resp.headers, body: b }));
    });
    r.on("error", rej); if (data) r.write(data); r.end();
  });
}
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  /* 管理员密码：.env 优先，否则默认 aura */
  let pwd = "aura";
  try {
    const env = fs.readFileSync(path.join(__dirname, "../../.env"), "utf8");
    const m = env.match(/^AURA_ADMIN_PASSWORD=(.+)$/m);
    if (m) pwd = m[1].trim();
  } catch (e) { }

  const login = await req("POST", "/admin/api/login", { password: pwd });
  const cookie = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  const got = await req("GET", "/admin/api/config", null, cookie);
  const gotBody = JSON.parse(got.body);
  const cfg = gotBody && gotBody.config ? gotBody.config : gotBody;   /* 接口直接返回配置本体 */
  const before = cfg.configVersion;
  const marker = "配置校验-" + Date.now().toString().slice(-6);
  cfg.copy = Object.assign({}, cfg.copy, { emptyState: marker });
  const saved = await req("POST", "/admin/api/config", { config: cfg }, cookie);
  const savedJson = JSON.parse(saved.body);
  const status = JSON.parse((await req("GET", "/admin/api/status", null, cookie)).body);
  const fileNow = JSON.parse(fs.readFileSync(path.join(__dirname, "../../remote/config.json"), "utf8"));

  const out = {
    passwordFromEnv: pwd !== "aura",
    beforeVersion: before,
    savedVersion: savedJson.config && savedJson.config.configVersion,
    statusVersion: status.configVersion,
    fileVersion: fileNow.configVersion,
    hasLegacyVersion: "version" in fileNow,
    hasLegacyUpdatedAt: "updatedAt" in fileNow,
    marker
  };

  /* 浏览器：设远程地址 → 重开（navigation）→ 读到新值 */
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { await sleep(250); } }
  const tab = await new Promise((res, rej) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (resp) => { let b = ""; resp.on("data", (c) => (b += c)); resp.on("end", () => res(JSON.parse(b))); });
    r.on("error", rej); r.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: BASE + "/?ver=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_remote_cfg','${BASE}/remote/config.json'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'v1',title:'配置',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_v1','[]'); location.reload(); })()`);
  await sleep(9000);   /* 等一轮轮询（30s 内会先立即拉一次） */

  out.app = await ev(`({
    textEmpty: localStorage.getItem('aura_text_empty'),
    domEmpty: (document.querySelector('.empty-text') || {}).textContent,
    ver: (window.__auraCfgActive && window.__auraCfgActive.config && window.__auraCfgActive.config.configVersion) || null
  })`);

  const shot = await send("Page.captureScreenshot", { format: "png", fromSurface: true });
  if (shot.result && shot.result.data) fs.writeFileSync(path.join(EVID, "p6-version-applied.png"), Buffer.from(shot.result.data, "base64"));

  console.log(JSON.stringify(out, null, 1));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
