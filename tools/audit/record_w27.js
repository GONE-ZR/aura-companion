/* w27：录 8 段 2.4s 样本（2px→4px 画布，仅顶部一条线），打乱命名 + 内部映射表 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9396;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "w27");
const OUT = path.join(__dirname, "w27-samples");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?w27=" + Date.now() });
  await sleep(3400);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'w27',title:'w27',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_w27','[]'); location.reload(); })()`);
  await sleep(4400);

  const states = ["soft", "smile", "calm", "low", "tired", "blank", "sulky", "serious"];
  const order = states.slice().sort(() => Math.random() - 0.5);   /* 打乱命名 */
  const map = {};

  for (let i = 0; i < order.length; i++) {
    const st = order[i];
    const name = "v" + String(i + 1).padStart(2, "0");
    const b64 = await ev(`(async () => {
      document.body.setAttribute('data-night','0');
      document.body.setAttribute('data-bg','warm');
      const c = document.getElementById('wave-line');
      const stream = c.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
      const chunks = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise(r => { rec.onstop = r; });
      rec.start();
      localStorage.removeItem('aura_wave_log');
      window.AuraWave.maybe({ delta:-0.16,newResidue:0.55,intent:'express',state:'${st}',
        valence: 0, arousal: 0.6, residueId:'w27-${st}', layerId:'W27'+Date.now(), first:false, offline:false, safety:false });
      await new Promise(r=>setTimeout(r,2500));
      rec.stop(); await done;
      const blob = new Blob(chunks, { type:'video/webm' });
      return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
    })()`);
    if (typeof b64 === "string" && b64.length > 100) {
      fs.writeFileSync(path.join(OUT, name + ".webm"), Buffer.from(b64, "base64"));
      map[name] = st;
    } else {
      map[name] = "录制失败: " + JSON.stringify(b64).slice(0, 80);
    }
    await sleep(400);
  }

  fs.writeFileSync(path.join(OUT, "_mapping.json"), JSON.stringify(map, null, 1), "utf8");
  console.log(JSON.stringify(map, null, 1));
  const files = fs.readdirSync(OUT).filter(f => f.endsWith(".webm")).map(f => f + " " + Math.round(fs.statSync(path.join(OUT, f)).size / 1024) + "KB");
  console.log(files.join("\n"));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
