/* f3 诊断：为什么重开后没应用 32 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9409;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "upd5");
const BASE = "http://127.0.0.1:8000";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { await sleep(250); } }
  const tab = await new Promise((res, rej) => {
    const r = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (resp) => { let b = ""; resp.on("data", (c) => (b += c)); resp.on("end", () => res(JSON.parse(b))); });
    r.on("error", rej); r.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const reqs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method === "Network.requestWillBeSent") reqs.push(d.params.request.url); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: BASE + "/?d=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_remote_cfg','${BASE}/remote/config.json'); location.reload(); })()`);
  await sleep(10000);

  const out = {
    cfgRequests: reqs.filter((u) => /config\.json/.test(u)),
    applied: await ev(`window.__cfgApplied || null`),
    active: await ev(`window.__auraCfgActive ? { ver: window.__auraCfgActive.config && window.__auraCfgActive.config.configVersion, src: window.__auraCfgActive.source } : null`),
    lsKeys: await ev(`Object.keys(localStorage).filter(k => /cfg|config/.test(k))`),
    storedCurrent: await ev(`(() => { try { const v = JSON.parse(localStorage.getItem('aura_cfg_current')||'null'); return v && (v.configVersion || (v.config && v.config.configVersion)); } catch(e) { return 'err'; } })()`),
    textEmpty: await ev(`localStorage.getItem('aura_text_empty')`),
    remoteState: await ev(`window.Aura.remote && window.Aura.remote.state ? window.Aura.remote.state() : null`)
  };
  console.log(JSON.stringify(out, null, 1));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
