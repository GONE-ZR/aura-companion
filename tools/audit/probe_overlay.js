/* 弹层/密钥层/抽屉在 comic × 明暗 下的实测对比度 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9404;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "overlay");
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?ov=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_comic','1'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'o1',title:'弹层',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_o1','[]'); location.reload(); })()`);
  await sleep(4200);

  const probe = async (night) => ev(`(async () => {
    document.body.setAttribute('data-night', '${night}');
    const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const rgb = s => { const m=String(s).match(/\\d+/g); return m?m.slice(0,3).map(Number):[0,0,0]; };
    const ratio = (a,b) => { const A=lum(rgb(a)), B=lum(rgb(b)); return +(((Math.max(A,B)+0.05)/(Math.min(A,B)+0.05))).toFixed(2); };
    const res = { night: '${night}' };
    /* modal */
    window.Aura.ui.openModal('要不要留一个紧急联系人？只在状态不对时用得上，也只存在本机。', { okText:'去填', cancelText:'取消' });
    await new Promise(r=>setTimeout(r,300));
    const m = document.getElementById('modal'), mt = document.getElementById('modal-text');
    res.modal = { bg: getComputedStyle(m).backgroundColor, color: getComputedStyle(mt).color, ratio: ratio(getComputedStyle(mt).color, getComputedStyle(m).backgroundColor) };
    window.Aura.ui.closeModal && window.Aura.ui.closeModal();
    document.getElementById('modal').hidden = true; document.getElementById('modal-scrim').hidden = true;
    /* keygate */
    const kg = document.getElementById('keygate');
    if (kg) { kg.hidden = false; const tt = kg.querySelector('.keygate-title, h3, h2, p'); res.keygate = tt ? { bg: getComputedStyle(kg).backgroundColor, color: getComputedStyle(tt).color, ratio: ratio(getComputedStyle(tt).color, getComputedStyle(kg).backgroundColor) } : null; kg.hidden = true; }
    /* drawer */
    const dr = document.getElementById('drawer'), sc = document.getElementById('scrim');
    dr.setAttribute('aria-hidden','false'); sc.hidden = false;
    await new Promise(r=>setTimeout(r,300));
    const row = dr.querySelector('.row span');
    res.drawer = { bg: getComputedStyle(dr).backgroundColor, color: getComputedStyle(row || dr).color, ratio: ratio(getComputedStyle(row || dr).color, getComputedStyle(dr).backgroundColor) };
    dr.setAttribute('aria-hidden','true'); sc.hidden = true;
    return res;
  })()`);

  const out = { light: await probe("0") };
  await sleep(300); await shot("overlay-light.png");
  out.dark = await probe("1");
  await sleep(300); await shot("overlay-dark.png");
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-overlay.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
