/* 首启页：勾选是否生效 / 跳过是否可用 / §0 三行 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9402;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "onb");
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?onb=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.clear(); location.reload(); })()`);
  await sleep(4200);

  const out = {};
  out.origin = await ev(`location.origin`);
  out.isSecureContext = await ev(`window.isSecureContext`);
  out.getUserMedia = await ev(`typeof (navigator.mediaDevices && navigator.mediaDevices.getUserMedia)`);
  out.onboardingShown = await ev(`!!document.getElementById('onboarding')`);
  out.skipExists = await ev(`!!([...document.querySelectorAll('#onboarding button')].find(b => /跳过/.test(b.textContent)))`);
  await shot("onb-1.png");

  /* 勾选是否启用继续 */
  out.checkboxFlow = await ev(`(() => {
    const cb = document.querySelector('#onboarding input[type=checkbox]');
    const btn = [...document.querySelectorAll('#onboarding button')].find(b => b.textContent.trim() === '继续');
    if (!cb || !btn) return { err: 'not found' };
    const before = btn.disabled;
    cb.click();
    const afterClick = { checked: cb.checked, disabled: btn.disabled };
    return { before, afterClick };
  })()`);

  /* 点跳过 */
  out.afterSkip = await ev(`(async () => {
    const skip = [...document.querySelectorAll('#onboarding button')].find(b => /跳过/.test(b.textContent));
    if (!skip) return { err: 'no skip' };
    skip.click();
    await new Promise(r => setTimeout(r, 400));
    return {
      onboardingGone: !document.getElementById('onboarding'),
      flag: localStorage.getItem('aura_onboarded_v2'),
      decl: !!localStorage.getItem('aura_ai_declared_at'),
      logVisible: !!document.getElementById('log')
    };
  })()`);
  await shot("onb-2-after-skip.png");

  /* toast 配色（黑色方框）*/
  out.toast = await ev(`(() => {
    const t = document.getElementById('toast');
    if (!t) return { err: 'no toast' };
    toast('麦克风权限被拒绝，请在系统设置里打开后重试');
    const cs = getComputedStyle(t);
    const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const rgb = s => { const m=String(s).match(/\\d+/g); return m?m.slice(0,3).map(Number):[0,0,0]; };
    const fg = rgb(cs.color), bg = rgb(cs.backgroundColor);
    const r = (Math.max(lum(fg),lum(bg))+0.05)/(Math.min(lum(fg),lum(bg))+0.05);
    return { color: cs.color, background: cs.backgroundColor, ratio: +r.toFixed(2), fontSize: cs.fontSize, text: t.textContent };
  })()`);
  await sleep(300);
  await shot("onb-3-toast.png");

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-onb.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
