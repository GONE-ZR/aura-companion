/* 复现用户截图：尺寸 / 溢出 / 立绘颜色 / 侧栏 / 控制台错误 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9401;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "ui-diag");
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
  let id = 0; const pend = new Map(); const errs = []; const failed = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method === "Runtime.exceptionThrown") errs.push(String((d.params.exceptionDetails.exception || {}).description || d.params.exceptionDetails.text).slice(0, 200));
    if (d.method === "Log.entryAdded" && d.params.entry.level === "error") errs.push(d.params.entry.text.slice(0, 200));
    if (d.method === "Network.loadingFailed") failed.push(d.params.errorText + " " + (d.params.requestId || ""));
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };
  const shot = async (n) => { const r = await send("Page.captureScreenshot", { format: "png", fromSurface: true }); if (r.result && r.result.data) fs.writeFileSync(path.join(EVID, n), Buffer.from(r.result.data, "base64")); };

  await send("Page.enable"); await send("Runtime.enable"); await send("Log.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__AURA_WAVE_DEBUG__ = true;" });

  for (const [w, h, tag] of [[390, 844, "phone"], [720, 900, "narrow"], [1280, 900, "desktop"]]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 800, screenWidth: w, screenHeight: h });
    await send("Page.navigate", { url: "http://127.0.0.1:8000/?ui=" + Date.now() });
    await sleep(3600);
    if (tag === "phone") {
      await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_comic','1'); localStorage.setItem('aura_theme','light'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'u1',title:'界面检查',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_u1',JSON.stringify([{id:'m1',role:'me',content:'今天有点累',ts:now-9e5,deletedAt:null},{id:'m2',role:'ai',content:'那就先歇一会儿，不急。',ts:now-8e5,deletedAt:null}])); location.reload(); })()`);
      await sleep(4200);
      await ev(`try{window.Aura.chat.loadSession('u1');}catch(e){} 1`);
      await sleep(900);
    }
    const info = await ev(`(() => {
      const g = (id) => document.getElementById(id);
      const fig = document.querySelector('.art-figure');
      const head = document.querySelector('.fig-head');
      const body = document.querySelector('.fig-body');
      const hair = document.querySelector('.fig-hair');
      const cs = (e) => e ? getComputedStyle(e) : null;
      const wide = g('wide-left');
      const stage = g('stage');
      return {
        vw: innerWidth, vh: innerHeight,
        scrollW: document.documentElement.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        overflowX: document.documentElement.scrollWidth - innerWidth,
        bodyClass: document.body.className,
        dataTheme: document.body.getAttribute('data-theme'),
        dataNight: document.body.getAttribute('data-night'),
        dataBg: document.body.getAttribute('data-bg'),
        comic: document.body.classList.contains('comic'),
        bodyBg: cs(document.body).backgroundColor,
        wideLeft: wide ? { display: cs(wide).display, w: wide.getBoundingClientRect().width } : null,
        stage: stage ? { w: stage.getBoundingClientRect().width, x: stage.getBoundingClientRect().x } : null,
        fig: fig ? { w: fig.getBoundingClientRect().width, h: fig.getBoundingClientRect().height } : null,
        headBg: cs(head) && cs(head).backgroundColor,
        bodyBg2: cs(body) && cs(body).backgroundColor,
        hairBg: cs(hair) && cs(hair).backgroundColor,
        filter: fig ? cs(fig).filter : null,
        bodyFilter: cs(document.body).filter,
        inkVar: getComputedStyle(document.documentElement).getPropertyValue('--ink'),
        sfx: document.querySelector('.art-sfx') ? document.querySelector('.art-sfx').textContent : null
      };
    })()`);
    console.log(tag, JSON.stringify(info, null, 1));
    await shot("ui-" + tag + ".png");
  }
  console.log("errors:", errs.slice(0, 6));
  console.log("failed:", failed.slice(0, 6));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
