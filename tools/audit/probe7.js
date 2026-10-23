/* w7 / w8 / w10 / w21 专项 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9373;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6p7");
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?p7=" + Date.now() });
  await sleep(3400);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'w7',title:'w7',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_w7',JSON.stringify([{id:'a',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4400);
  await ev(`try{window.Aura.chat.loadSession('w7');}catch(e){} 1`);
  await sleep(700);

  const trig = (st, v, a, rid, intent) => ev(`(() => {
    localStorage.removeItem('aura_wave_log');
    return window.AuraWave.maybe({ delta:-0.2,newResidue:0.2,intent:'${intent||"express"}',state:'${st}',valence:${v},arousal:${a},residueId:'${rid}',layerId:'${rid}'+Date.now(),first:false,offline:false,safety:false });
  })()`);
  const grab = () => ev(`(() => { const c=document.getElementById('wave-line'); return Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data); })()`);

  const r = {};
  /* w7：同一情绪两次（不同 residueId）→ 像素不同、颜色/峰数相同 */
  const t1 = await trig("sulky", -0.5, 0.7, "seedA");
  await sleep(800); const p1 = await grab();
  await sleep(2000);
  const t2 = await trig("sulky", -0.5, 0.7, "seedB");
  await sleep(800); const p2 = await grab();
  let diff = 0; for (let i = 0; i < p1.length; i++) if (p1[i] !== p2[i]) diff++;
  r.w7 = { t1, t2, pixelDiff: diff, sameColor: t1.color === t2.color, samePeaks: t1.peaks === t2.peaks };
  await sleep(2000);

  /* w8：arousal 0.2 → 1 峰；0.7 → 2 峰 */
  const a1 = await trig("tired", -0.3, 0.2, "ar1"); await sleep(300);
  const a2 = await trig("tired", -0.3, 0.7, "ar2"); await sleep(300);
  r.w8 = { low: a1.peaks, high: a2.peaks };
  await sleep(2600);

  /* w10：valence -0.5 微凹 / +0.5 微凸 → 用像素质心 y 对比基线 */
  const centroid = async () => ev(`(() => {
    const c=document.getElementById('wave-line'); const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let sum=0, wsum=0;
    for (let y=0;y<c.height;y++) for (let x=0;x<c.width;x++){ const A=d[(y*c.width+x)*4+3]; if(A>0){ sum += y*A; wsum += A; } }
    return +( (sum/wsum) / 2 ).toFixed(3);   /* 转 CSS px（dpr2） */
  })()`);
  await trig("low", -0.5, 0.5, "neg"); await sleep(700); const cNeg = await centroid();
  await sleep(2600);
  await trig("smile", 0.5, 0.5, "pos"); await sleep(700); const cPos = await centroid();
  await sleep(2600);
  await trig("calm", 0, 0.7, "zero"); await sleep(700); const cZero = await centroid();
  r.w10 = { neg: cNeg, pos: cPos, zero: cZero };

  /* w21：注入文本里不得含本功能任何字样 */
  r.w21 = await ev(`(() => {
    try {
      const st = window.Aura.chat.engineState();
      const one = window.AuraPrompt.buildStateBlock({ state: st, patience: st.patience, now: Date.now() }, window.AuraEngine);
      const ok = !/波动|wave|心电|振幅|波动线/i.test(one);
      return { ok, sample: one.slice(0, 80) };
    } catch (e) { return { err: String(e && e.message) }; }
  })()`);

  console.log(JSON.stringify(r, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-p6-extra.json"), JSON.stringify(r, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
