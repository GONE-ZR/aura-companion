/* f1/f2/f3/f9 收尾验收 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9408;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "upd4");
const EVID = path.join(__dirname, "ui-evidence");
const BASE = "http://127.0.0.1:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

function req(method, p, body, cookie) {
  return new Promise((res, rej) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request({ host: "127.0.0.1", port: 8000, path: p, method, headers: Object.assign({ "Content-Type": "application/json" }, data ? { "Content-Length": Buffer.byteLength(data) } : {}, cookie ? { Cookie: cookie } : {}) }, (resp) => {
      let b = ""; resp.on("data", (c) => (b += c)); resp.on("end", () => res({ status: resp.statusCode, headers: resp.headers, body: b }));
    });
    r.on("error", rej); if (data) r.write(data); r.end();
  });
}

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  /* f2 用的“双字段配置” */
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "../../remote/config.json"), "utf8"));
  cfg.version = 99;
  fs.writeFileSync(path.join(__dirname, "../../remote/config-conflict.json"), JSON.stringify(cfg, null, 2), "utf8");

  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { await sleep(250); } }
  const tab = await new Promise((res, rej) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (resp) => { let b = ""; resp.on("data", (c) => (b += c)); resp.on("end", () => res(JSON.parse(b))); });
    r.on("error", rej); r.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const logs = []; const reqs = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Log.entryAdded") logs.push(d.params.entry.level + ":" + d.params.entry.text.slice(0, 160));
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push("console.error:" + (d.params.args[0] || {}).value);
    if (d.method === "Network.requestWillBeSent") reqs.push(d.params.request.url);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); if (r.result && r.result.data) fs.writeFileSync(path.join(EVID, n), Buffer.from(r.result.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

  const out = {};

  /* f2：双字段配置 → console.error + 拒绝应用 */
  await send("Page.navigate", { url: BASE + "/?u4=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_remote_cfg','${BASE}/remote/config-conflict.json'); localStorage.removeItem('aura_text_empty'); location.reload(); })()`);
  await sleep(6000);
  out.f2 = {
    logs: logs.filter((l) => /版本|configVersion|version/.test(l)).slice(0, 4),
    applied: await ev(`window.__cfgApplied || null`),
    textEmpty: await ev(`localStorage.getItem('aura_text_empty')`)
  };

  /* f9：连点两次 → 只发一个下载请求 */
  await ev(`localStorage.setItem('aura_update_url','${BASE}/remote/latest-test.json')`);
  await ev(`window.Aura.updater.startCheck()`);
  reqs.length = 0;
  await ev(`window.Aura.updater.onPrimaryClick(); window.Aura.updater.onPrimaryClick();`);
  await sleep(1500);
  out.f9 = { apkRequests: reqs.filter((u) => /8123\/apk/.test(u)).length, states: await ev(`window.Aura.updater._state().state`) };

  /* f3：改配置 → 完全重开 → 读到新值 */
  const login = await req("POST", "/admin/api/login", { password: "aura" });
  const cookie = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
  const got = JSON.parse((await req("GET", "/admin/api/config", null, cookie)).body);
  const marker = "重启校验-" + Date.now().toString().slice(-6);
  got.copy = Object.assign({}, got.copy, { emptyState: marker });
  const saved = JSON.parse((await req("POST", "/admin/api/config", { config: got }, cookie)).body);
  await ev(`localStorage.setItem('aura_remote_cfg','${BASE}/remote/config.json')`);
  await send("Page.navigate", { url: BASE + "/?u4b=" + Date.now() });
  await sleep(6500);
  out.f3 = {
    savedVersion: saved.config && saved.config.configVersion,
    appVersion: await ev(`(window.__cfgApplied || {}).ver`),
    appliedText: await ev(`localStorage.getItem('aura_text_empty')`),
    marker,
    ok: false
  };
  out.f3.ok = out.f3.appliedText === marker;
  await shot("updF3-restarted.png");

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-updater3.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
