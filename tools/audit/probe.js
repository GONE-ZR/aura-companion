/* 快速探针：页面结构 / comic 状态 / font-scale / remote API 名 / 波动线静止两帧差异 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9362;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "probe-audit");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { await sleep(250); } }
  const tab = await new Promise((res, rej) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b))); });
    req.on("error", rej); req.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?probe=" + Date.now() });
  await sleep(3800);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.removeItem('aura_comic'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'p1',title:'探针',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_p1',JSON.stringify([{id:'a',role:'me',content:'累',ts:now-9e5,deletedAt:null},{id:'b',role:'ai',content:'那就歇会儿。',ts:now-8e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4200);
  await ev(`window.Aura.chat.loadSession('p1'); 1`);
  await sleep(1200);

  const r = await ev(`(() => {
    const b = document.querySelector('#log .msg.ai .bubble');
    const txt = document.querySelector('#log .msg.ai .bubble .bubble-text');
    const cs = (e) => e ? getComputedStyle(e) : null;
    const c = document.getElementById('wave-line');
    const keys = Object.keys(window).filter(k => /remote|Remote|Aura/.test(k));
    const auraKeys = Object.keys(window.Aura || {});
    return {
      bodyClass: document.body.className,
      hasBubbleText: !!txt,
      bubbleHTML: b ? b.outerHTML.slice(0, 220) : null,
      bubbleFont: cs(b) && cs(b).fontFamily, bubbleSize: cs(b) && cs(b).fontSize,
      txtFont: cs(txt) && cs(txt).fontFamily, txtSize: cs(txt) && cs(txt).fontSize,
      canvas: c ? { w: c.width, h: c.height, box: c.getBoundingClientRect().toJSON() } : null,
      auraKeys: auraKeys,
      remoteKeys: keys,
      scale: getComputedStyle(document.documentElement).getPropertyValue('--font-scale'),
      night: document.body.getAttribute('data-night'),
      bg: document.body.getAttribute('data-bg'),
      st: document.body.getAttribute('data-st')
    };
  })()`);
  console.log(JSON.stringify(r, null, 1));

  /* 波动线两帧差异：先冻结主题，再连拍 3 帧 */
  const w = await ev(`(async () => {
    document.body.setAttribute('data-night','0'); document.body.setAttribute('data-bg','warm');
    window.AuraWave.drawStatic();
    await new Promise(r=>setTimeout(r,600));
    const c = document.getElementById('wave-line'); if (!c) return { none: true };
    const ctx = c.getContext('2d');
    const g = () => Array.from(ctx.getImageData(0,0,c.width,c.height).data);
    const a = g(); await new Promise(r=>setTimeout(r,500)); const b = g(); await new Promise(r=>setTimeout(r,500)); const d = g();
    const diff = (x,y) => { let n=0, mx=0; for(let i=0;i<x.length;i++){ const dv=Math.abs(x[i]-y[i]); if(dv){n++; mx=Math.max(mx,dv);} } return {n,mx}; };
    return { ab: diff(a,b), ad: diff(a,d), w: c.width, h: c.height };
  })()`);
  console.log('wave frames:', JSON.stringify(w));

  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
