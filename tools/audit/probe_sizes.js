/* w4：360×800 / 390×844 / 430×932 三尺寸几何与截图 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9374;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6sizes");
const EVID = path.join(__dirname, "p6-evidence");
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?sizes=" + Date.now() });
  await sleep(3400);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'sz',title:'尺寸',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_sz',JSON.stringify([{id:'a',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4400);

  const out = {};
  for (const [w, h] of [[360, 800], [390, 844], [430, 932]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenWidth: w, screenHeight: h });
    await sleep(600);
    out[w + "x" + h] = await ev(`(() => {
      window.AuraWave.sync();
      const c = document.getElementById('wave-line'), tp = document.getElementById('top');
      const r = c ? c.getBoundingClientRect() : null, tr = tp ? tp.getBoundingClientRect() : null;
      /* 顶部栏里第一个文字元素的位置，判断 2px 带是否压到它 */
      const firstText = tp ? [...tp.querySelectorAll('*')].map(e => e.getBoundingClientRect()).filter(b => b.height > 0).sort((a,b)=>a.top-b.top)[0] : null;
      return {
        canvas: r ? { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) } : null,
        topbar: tr ? { y: +tr.y.toFixed(1), h: +tr.height.toFixed(1) } : null,
        firstTopbarText: firstText ? +firstText.top.toFixed(1) : null,
        overlapText: firstText ? firstText.top < 2 : null,
        overflowX: document.documentElement.scrollWidth - window.innerWidth,
        safeTop: getComputedStyle(document.documentElement).getPropertyValue('--sat') || 'env=0'
      };
    })()`);
    const s = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: 60, scale: 2 }, fromSurface: true });
    if (s.result && s.result.data) fs.writeFileSync(path.join(EVID, "p6-size-" + w + "x" + h + ".png"), Buffer.from(s.result.data, "base64"));
  }
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-p6-sizes.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
