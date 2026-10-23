/* 只测 §7 开关（w15） */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9375;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6sw");
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
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text), desc: String((r.result.exceptionDetails.exception||{}).description||'').slice(0,200) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?sw=" + Date.now() });
  await sleep(3400);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1'); localStorage.removeItem('aura_wave_log'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'sw',title:'开关',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_sw',JSON.stringify([{id:'a',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4500);
  await ev(`try{window.Aura.chat.loadSession('sw');}catch(e){} 1`);
  await sleep(700);

  console.log('hasSwitch:', await ev(`!!document.getElementById('in-wave')`));
  const r = await ev(`(async () => {
    try {
      const sw = document.getElementById('in-wave');
      const before = { aria: sw.getAttribute('aria-checked'), enabled: window.AuraWave.state().enabled };
      sw.click();
      await new Promise(r=>setTimeout(r,300));
      const offState = window.AuraWave.state();
      const t = window.AuraWave.maybe({ delta:-0.5,newResidue:0.5,intent:'conceal',state:'sulky',valence:-0.8,arousal:0.8,residueId:'x',layerId:'X'+Date.now(),first:false,offline:false,safety:false });
      const c = document.getElementById('wave-line');
      const dd = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
      let colored = 0, nonEmpty = 0, maxA = 0;
      for (let i=3;i<dd.length;i+=4){ const A=dd[i]; if(A>0){ nonEmpty++; if(A>maxA)maxA=A; const rr=dd[i-3],gg=dd[i-2],bb=dd[i-1]; if(A>=40 && Math.max(rr,gg,bb)-Math.min(rr,gg,bb)>=25) colored++; } }
      sw.click();
      await new Promise(r=>setTimeout(r,200));
      return { before, ariaOff: sw.getAttribute('aria-checked'), enabled: offState.enabled, fired: t, colored, nonEmpty, maxA, restored: window.AuraWave.state().enabled };
    } catch (e) { return { caught: String(e && e.stack).slice(0,300) }; }
  })()`);
  console.log(JSON.stringify(r, null, 1));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
