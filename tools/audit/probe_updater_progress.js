/* f8：限速下载，抓“下载中 NN%” */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9407;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "upd3");
const EVID = path.join(__dirname, "ui-evidence");
const BASE = "http://127.0.0.1:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
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
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); if (r.result && r.result.data) fs.writeFileSync(path.join(EVID, n), Buffer.from(r.result.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: BASE + "/?u3=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_update_url','${BASE}/remote/latest-test.json'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'u3',title:'更新',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_u3','[]'); location.reload(); })()`);
  await sleep(4200);

  await ev(`window.Aura.updater.startCheck()`);
  /* 限速 60KB/s：1MB 文件约 17 秒，够抓中间百分比 */
  await send("Network.emulateNetworkConditions", { offline: false, latency: 20, downloadThroughput: 60 * 1024, uploadThroughput: 60 * 1024 });
  await ev(`window.Aura.updater.onPrimaryClick()`);

  const samples = [];
  for (let i = 0; i < 12; i++) {
    const s = await ev(`({ state: window.Aura.updater._state().state, p: window.Aura.updater._state().progress, btn: document.getElementById('ub-update').textContent, txt: document.querySelector('#update-bar .ub-text').textContent, barHidden: document.getElementById('update-bar').hidden })`);
    samples.push(s);
    if (i === 4) await shot("updF-progress.png");
    if (s && s.state !== "downloading") break;
    await sleep(700);
  }
  console.log(JSON.stringify(samples, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-updater-progress.json"), JSON.stringify(samples, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
