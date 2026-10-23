/* w33：振幅 2.0 峰值帧的描边是否被裁切 / 是否溢出画布 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9392;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "w33");
const EVID = path.join(__dirname, "p6-evidence");
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
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__AURA_WAVE_DEBUG__ = true;" });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?w33=" + Date.now() });
  await sleep(3400);
  await ev(`(() => {
    localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct');
    localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1');
    localStorage.setItem('aura_remote_cfg','');
    const now=Date.now();
    localStorage.setItem('aura_sessions',JSON.stringify([{id:'w33',title:'w33',created:now-1e6,updated:now,deletedAt:null}]));
    localStorage.setItem('aura_msgs_w33',JSON.stringify([{id:'a',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}]));
    localStorage.setItem('aura_engine_v1', JSON.stringify({trait:'warm-tsundere',state:'calm',cause:null,patience:20,sulkyTurnsLeft:0,seriousStartedAt:null,lastDecayAt:now,lastSulkyAt:0,lastNoReplyMarkAt:0,updatedAt:now,events:[],core:{valence:0,arousal:0.6,bond:0.5,target:'self',intent:'express',residue:[],updatedAt:now}}));
    location.reload();
  })()`);
  await sleep(4500);

  const info = await ev(`(async () => {
    document.body.setAttribute('data-night','0');
    document.body.setAttribute('data-bg','warm');
    localStorage.removeItem('aura_wave_log');
    const r = window.AuraWave.maybe({ delta:-0.15,newResidue:0.3,intent:'express',state:'sulky',
      valence:-0.5,arousal:0.7,residueId:'w33',layerId:'W33'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(x=>setTimeout(x,760));           /* 生长完成、保持段 */
    const c = document.getElementById('wave-line');
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    const rows = [];
    for (let y=0;y<c.height;y++){
      let n=0, hi=0, mx=0;
      for (let x=0;x<c.width;x++){ const a=d[(y*c.width+x)*4+3]; if(a>0){n++; if(a>=200)hi++; if(a>mx)mx=a;} }
      rows.push({ y, nonEmpty:n, saturated:hi, maxAlpha:mx });
    }
    /* 顶行最大连续饱和游程（判断是否被切平） */
    let best=0, run=0;
    for (let x=0;x<c.width;x++){ const a=d[x*4+3]; if(a>=200){run++; if(run>best)best=run;} else run=0; }
    return {
      trigger: r,
      canvas: { w:c.width, h:c.height },
      rows,
      topRowSaturatedRun: best,
      dataURL: c.toDataURL('image/png')
    };
  })()`);

  if (info && info.dataURL) {
    const b64 = info.dataURL.split(",")[1];
    fs.writeFileSync(path.join(EVID, "w33-peak-canvas.png"), Buffer.from(b64, "base64"));
    delete info.dataURL;
  }
  const shot = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: 10, scale: 4 }, fromSurface: true });
  if (shot.result && shot.result.data) fs.writeFileSync(path.join(EVID, "w33-outside-3px.png"), Buffer.from(shot.result.data, "base64"));

  console.log(JSON.stringify(info, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-w33.json"), JSON.stringify(info, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
