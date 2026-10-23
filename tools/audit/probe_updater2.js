/* 更新模块验收（确定性版）：只测 updater 状态机本身 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9406;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "upd2");
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
  await send("Page.navigate", { url: BASE + "/?u2=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_update_url','${BASE}/remote/latest-test.json'); const n=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'u2',title:'更新',created:n-1e6,updated:n,deletedAt:null}])); localStorage.setItem('aura_msgs_u2','[]'); location.reload(); })()`);
  await sleep(4200);

  const out = {};

  /* A. 有新版的 manifest */
  out.A_newer = await ev(`(async () => {
    const u = window.Aura.updater;
    const m = await u.startCheck();
    return { got: !!m, ver: m && u.appVersionOf(m), st: u._state(), barHidden: document.getElementById('update-bar').hidden,
             text: document.querySelector('#update-bar .ub-text').textContent, btn: document.getElementById('ub-update').textContent };
  })()`);
  await shot("updA-newer.png");

  /* B. 连点两次 → 只发起一次下载（inFlight / state 同步可见） */
  out.B_doubleClick = await ev(`(() => {
    const u = window.Aura.updater;
    u.onPrimaryClick(); u.onPrimaryClick();
    return { st: u._state(), btn: document.getElementById('ub-update').textContent, disabled: document.getElementById('ub-update').disabled };
  })()`);
  await sleep(350);
  out.B_progress = await ev(`({ st: window.Aura.updater._state(), btn: document.getElementById('ub-update').textContent, barHidden: document.getElementById('update-bar').hidden })`);
  await shot("updB-downloading.png");

  await sleep(2500);
  out.B_done = await ev(`({ st: window.Aura.updater._state(), btn: document.getElementById('ub-update').textContent })`);

  /* C. 已是最新 */
  out.C_same = await ev(`(async () => {
    localStorage.setItem('aura_update_url', '${BASE}/remote/latest-same.json');
    await new Promise(r => setTimeout(r, 100));
    const m = await window.Aura.updater.startCheck();
    return { got: !!m, st: window.Aura.updater._state(), barHidden: document.getElementById('update-bar').hidden };
  })()`);
  await shot("updC-same.png");

  /* D. 404 → 更新源配置有误 + 重试条 */
  out.D_badSource = await ev(`(async () => {
    localStorage.setItem('aura_update_url', '${BASE}/remote/nope.json');
    await window.Aura.updater.startCheck();
    const st = window.Aura.updater._state();
    return { state: st.state, err: st.lastError, hasUpdate: st.hasUpdate,
             btn: document.getElementById('ub-update').textContent,
             barHidden: document.getElementById('update-bar').hidden,
             text: document.querySelector('#update-bar .ub-text').textContent };
  })()`);
  await shot("updD-badsource.png");

  /* E. 网络不可达 → 8 秒内 failed */
  out.E_offline = await ev(`(async () => {
    localStorage.setItem('aura_update_url', 'http://127.0.0.1:9/none.json');
    const t0 = performance.now();
    await window.Aura.updater.startCheck();
    const st = window.Aura.updater._state();
    return { ms: Math.round(performance.now() - t0), state: st.state, err: st.lastError, hasUpdate: st.hasUpdate,
             btn: document.getElementById('ub-update').textContent };
  })()`);

  /* F. failed 后按钮可点、文案"重试"，再点能重新发起 */
  out.F_retry = await ev(`(async () => {
    const u = window.Aura.updater;
    const btn = document.getElementById('ub-update');
    const labelBefore = btn.textContent, disabledBefore = btn.disabled;
    const barHiddenBefore = document.getElementById('update-bar').hidden;
    localStorage.setItem('aura_update_url', '${BASE}/remote/latest-test.json');
    u.onPrimaryClick();
    const during = u._state().state;
    await new Promise(r => setTimeout(r, 1500));
    return { labelBefore, disabledBefore, barHiddenBefore, during, after: u._state().state, barHidden: document.getElementById('update-bar').hidden };
  })()`);

  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(__dirname, "out-updater2.json"), JSON.stringify(out, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
