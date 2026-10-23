/* 更新模块验收：f4~f10 / f14 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9405;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "upd");
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
  await send("Page.navigate", { url: BASE + "/?upd=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_update_url','${BASE}/remote/latest-test.json'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'up',title:'更新',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_up','[]'); location.reload(); })()`);
  await sleep(4200);

  const out = {};

  /* f4 前置：有新版的 manifest → banner 应出现 */
  out.newer = await ev(`(async () => {
    const u = window.Aura.updater;
    const m = await u.startCheck();
    return { returned: !!m, state: u._state(), barHidden: document.getElementById('update-bar').hidden,
             text: document.querySelector('#update-bar .ub-text').textContent,
             btn: document.getElementById('ub-update').textContent };
  })()`);
  await shot("upd-newer.png");

  /* f14 点击是否被遮挡 */
  out.occlusion = await ev(`(() => {
    const b = document.getElementById('ub-update');
    const r = b.getBoundingClientRect();
    const top = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2);
    return { same: top === b, topEl: top ? top.tagName + '#' + top.id + '.' + top.className : null, rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }, disabled: b.disabled };
  })()`);

  /* f9 连点两次：只允许一个 inFlight */
  out.doubleClick = await ev(`(() => {
    const b = document.getElementById('ub-update');
    const u = window.Aura.updater;
    b.click(); b.click();
    const s1 = u._state();
    return { inFlight: s1.inFlight, state: s1.state };
  })()`);
  await sleep(400);
  out.afterClickLabel = await ev(`({ state: window.Aura.updater._state().state, btn: document.getElementById('ub-update').textContent, disabled: document.getElementById('ub-update').disabled })`);
  await shot("upd-downloading.png");

  /* 等下载失败（网络不通）→ f6/f7 */
  await sleep(9000);
  out.afterFail = await ev(`({ state: window.Aura.updater._state().state, err: window.Aura.updater._state().lastError, btn: document.getElementById('ub-update').textContent, barHidden: document.getElementById('update-bar').hidden, disabled: document.getElementById('ub-update').disabled })`);
  await shot("upd-failed.png");

  /* f4：已是最新 */
  out.same = await ev(`(async () => {
    localStorage.setItem('aura_update_url', '${BASE}/remote/latest-same.json');
    const m = await window.Aura.updater.startCheck();
    return { returned: !!m, state: window.Aura.updater._state(), barHidden: document.getElementById('update-bar').hidden };
  })()`);
  await shot("upd-same.png");

  /* 404 → bad-source 文案 */
  out.badSource = await ev(`(async () => {
    localStorage.setItem('aura_update_url', '${BASE}/remote/nope.json');
    await window.Aura.updater.startCheck();
    return { state: window.Aura.updater._state().state, err: window.Aura.updater._state().lastError,
             btn: document.getElementById('ub-update').textContent, barHidden: document.getElementById('update-bar').hidden };
  })()`);

  /* 网络不可达 → 8 秒内 failed */
  out.offline = await ev(`(async () => {
    localStorage.setItem('aura_update_url', 'http://127.0.0.1:9/none.json');
    const t0 = performance.now();
    await window.Aura.updater.startCheck();
    return { ms: Math.round(performance.now() - t0), state: window.Aura.updater._state().state, err: window.Aura.updater._state().lastError, btn: document.getElementById('ub-update').textContent };
  })()`);

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-updater.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
