/* w34 state() 生产不可见 + w35 banner 白名单 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9395;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "w3435");
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
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text), desc: String((r.result.exceptionDetails.exception || {}).description || "").slice(0, 120) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  const out = {};

  /* --- w34 生产上下文（不注入 debug 标记）--- */
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?w34=" + Date.now() });
  await sleep(4200);
  out.w34 = await ev(`(() => {
    const t = typeof (window.AuraWave && window.AuraWave.state);
    let bare = null;
    try { state(); } catch (e) { bare = e.name + ': ' + e.message; }
    return { typeofState: t, bareCall: bare, keys: Object.keys(window.AuraWave || {}).join(',') };
  })()`);

  /* --- w35 白名单 --- */
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); location.reload(); })()`);
  await sleep(4200);
  out.w35 = await ev(`(async () => {
    const W = window.AuraWave;
    const mk = (safe) => {
      const d = document.createElement('div');
      d.id = safe ? 'deco-safe' : 'deco-plain';
      d.style.cssText = 'position:fixed;left:0;right:0;top:0;height:18px;z-index:99;background:#eee';
      if (safe) d.setAttribute('data-wave-safe','1');
      document.body.appendChild(d);
      return d;
    };
    const vis = () => { const c = document.getElementById('wave-line'); return c ? getComputedStyle(c).display : 'none'; };
    const a = mk(true); W.sync(); await new Promise(r=>setTimeout(r,200));
    const withSafe = vis(); a.remove(); W.sync(); await new Promise(r=>setTimeout(r,200));
    const back = vis();
    const b = mk(false); W.sync(); await new Promise(r=>setTimeout(r,200));
    const withPlain = vis(); b.remove(); W.sync(); await new Promise(r=>setTimeout(r,200));
    const back2 = vis();
    return { withSafe, back, withPlain, back2 };
  })()`);

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-w34-w35.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
