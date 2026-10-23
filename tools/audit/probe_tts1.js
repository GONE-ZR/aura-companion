/* v1 / v13 / v10 与 u10（网页端） */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9412;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "tts1");
const EVID = path.join(__dirname, "ui-evidence");
const BASE = "http://127.0.0.1:8000";
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
  await send("Page.navigate", { url: BASE + "/?tts=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'tt',title:'tts',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_tt','[]'); location.reload(); })()`);
  await sleep(4200);

  const out = {};
  out.v1 = await ev(`({ locked: window.Aura.voice.lockedVoice(), build: window.Aura.voice.buildTag() })`);
  out.v13 = await ev(`({ fallback: window.Aura.voice.fallbackState(), noteExists: !!document.getElementById('voice-fallback-note'), noteHidden: (document.getElementById('voice-fallback-note')||{}).hidden })`);
  out.params = await ev(`(() => {
    const p = window.Aura.voice.buildTtsParams('calm');
    return { voice: p.voice, rate: p.rate, pitch: p.pitch, volume: p.volume };
  })()`);
  out.voiceSame = await ev(`(() => {
    const ems = ['calm','happy','sad','angry','low','stifled','jealous','curious'];
    const set = {};
    ems.forEach(e => { try { set[e] = window.Aura.voice.buildTtsParams(e).voice; } catch (err) { set[e] = 'ERR'; } });
    return set;
  })()`);
  await shot("tts-v1-voice.png");

  /* u10（网页端）：新文案已生效 = 首启页的“先跳过，直接进主界面” */
  await ev(`localStorage.removeItem('aura_onboarded_v2')`);
  await send("Page.navigate", { url: BASE + "/?fresh=" + Date.now() });
  await sleep(4200);
  out.u10_web = await ev(`(() => {
    const skip = [...document.querySelectorAll('#onboarding button')].find(b => /跳过/.test(b.textContent));
    return { hasSkip: !!skip, text: skip ? skip.textContent.trim() : null };
  })()`);
  await shot("u10-web-skip.png");

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-tts1.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
