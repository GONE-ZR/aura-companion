/* 专项探针：w14（2.5s 后归零）/ w15（关闭后无色）/ w24（弹层）到底卡在哪 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9372;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6probe");
const KEY = process.env.AURA_TEST_KEY || "sk-dummy";
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?probe6=" + Date.now() });
  await sleep(3400);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','${KEY}'); localStorage.setItem('aura_wave','1'); localStorage.removeItem('aura_wave_log'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'pr',title:'探针',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_pr',JSON.stringify([{id:'x1',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4500);
  await ev(`try{window.Aura.chat.loadSession('pr');}catch(e){} 1`);
  await sleep(800);

  const stat = () => ev(`(() => {
    const c = document.getElementById('wave-line');
    if (!c) return { none:true };
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxA=0, hist={}, nonEmpty=0;
    for (let i=0;i<d.length;i+=4){ const A=d[i+3]; if(A){nonEmpty++; hist[A]=(hist[A]||0)+1; if(A>maxA)maxA=A;} }
    return { w:c.width, h:c.height, maxA, nonEmpty, hist, display:getComputedStyle(c).display,
             lite: document.getElementById('wave-wrap').classList.contains('wave-lite'),
             st: window.AuraWave.state() };
  })()`);

  console.log('BEFORE:', JSON.stringify(await stat()));

  await ev(`(() => { localStorage.removeItem('aura_wave_log'); window.AuraWave.maybe({ delta:-0.3,newResidue:0.3,intent:'express',state:'sulky',valence:-0.5,arousal:0.7,residueId:'t',layerId:'T'+Date.now(),first:false,offline:false,safety:false }); return 1; })()`);
  await sleep(600);
  console.log('AT 600ms:', JSON.stringify(await stat()));
  await sleep(2100);
  console.log('AT 2700ms:', JSON.stringify(await stat()));

  /* w15：关开关 */
  const off = await ev(`(async () => {
    const sw = document.getElementById('in-wave');
    sw.click();
    await new Promise(r=>setTimeout(r,300));
    const c = document.getElementById('wave-line');
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let colored = 0, sample = [];
    for (let i=0;i<d.length;i+=4){ if(d[i+3]>0){ const r=d[i],g=d[i+1],b=d[i+2]; if(Math.max(r,g,b)-Math.min(r,g,b)>12){ colored++; if(sample.length<4) sample.push([r,g,b,d[i+3]]); } } }
    sw.click();
    return { colored, sample, lite: document.getElementById('wave-wrap').classList.contains('wave-lite') };
  })()`);
  console.log('W15 off:', JSON.stringify(off));

  /* w24：逐个弹层，含 350ms 等待 */
  const ov = await ev(`(async () => {
    const res = {};
    const W = window.AuraWave;
    async function chk(name, open, close) {
      open(); await new Promise(r=>setTimeout(r,350)); W.sync();
      const c = document.getElementById('wave-line');
      res[name] = { display: c?getComputedStyle(c).display:'none', off: c?document.getElementById('wave-wrap').getAttribute('data-off'):'' };
      close(); await new Promise(r=>setTimeout(r,250)); W.sync();
    }
    const drawer=document.getElementById('drawer'), scrim=document.getElementById('scrim');
    await chk('settings', ()=>{drawer.setAttribute('aria-hidden','false'); scrim.hidden=false;}, ()=>{drawer.setAttribute('aria-hidden','true'); scrim.hidden=true;});
    const sheet=document.getElementById('sheet');
    await chk('sheet', ()=>{sheet.setAttribute('aria-hidden','false');}, ()=>{sheet.setAttribute('aria-hidden','true');});
    const modal=document.getElementById('modal');
    await chk('modal', ()=>{modal.hidden=false;}, ()=>{modal.hidden=true;});
    const kg=document.getElementById('keygate');
    await chk('keygate', ()=>{kg.hidden=false;}, ()=>{kg.hidden=true;});
    return res;
  })()`);
  console.log('W24:', JSON.stringify(ov));

  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
