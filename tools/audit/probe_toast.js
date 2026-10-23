/* toast 配色：comic × 明/暗 两种组合的实测对比度 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9403;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "toast");
const EVID = path.join(__dirname, "ui-evidence");
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

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?toast=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_comic','1'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'t1',title:'toast',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_t1','[]'); location.reload(); })()`);
  await sleep(4200);
  await ev(`try{window.Aura.chat.loadSession('t1');}catch(e){} 1`);
  await sleep(700);

  const measure = async (night) => ev(`(() => {
    document.body.setAttribute('data-night', '${night}');
    const t = document.getElementById('toast');
    t.textContent = '麦克风权限被拒绝，请在系统设置里打开后重试';
    t.hidden = false; t.classList.add('show');
    const cs = getComputedStyle(t);
    const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const rgb = s => { const m=String(s).match(/\\d+/g); return m?m.slice(0,3).map(Number):[0,0,0]; };
    const fg = rgb(cs.color), bg = rgb(cs.backgroundColor);
    const r = (Math.max(lum(fg),lum(bg))+0.05)/(Math.min(lum(fg),lum(bg))+0.05);
    return { night: '${night}', color: cs.color, background: cs.backgroundColor, fontSize: cs.fontSize, lineHeight: cs.lineHeight, ratio: +r.toFixed(2), border: cs.borderTopWidth, radius: cs.borderRadius };
  })()`);

  const out = { light: await measure("0") };
  await sleep(200); await shot("toast-light.png");
  out.dark = await measure("1");
  await sleep(200); await shot("toast-dark.png");

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-toast.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
