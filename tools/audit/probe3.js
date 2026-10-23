/* 当前版本：回收站链（软删→恢复→彻底删）+ features.deleteSession 实调 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9365;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "probe3");
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
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?p3=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'t1',title:'回收站测试',created:now-1e6,updated:now,deletedAt:null},{id:'t2',title:'待删',created:now-2e6,updated:now-1e5,deletedAt:null}])); localStorage.setItem('aura_msgs_t1',JSON.stringify([{id:'g1',role:'me',content:'一',ts:now-9e5,deletedAt:null},{id:'g2',role:'ai',content:'二',ts:now-8e5,deletedAt:null}])); localStorage.setItem('aura_msgs_t2',JSON.stringify([{id:'h1',role:'ai',content:'三',ts:now-7e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4200);

  const r = await ev(`(() => {
    const R = window.AuraRecords;
    const out = {};
    out.trash0 = R.trash().length;
    out.soft = R.softDeleteSession('t1');
    out.trash1 = R.trash().length;
    out.trashNames = R.trash().map(x => x.title);
    out.restore = R.restoreSession('t1');
    out.trash2 = R.trash().length;
    out.msgsAfterRestore = R.messages ? R.messages('t1').length : null;
    out.hardBefore = localStorage.getItem('aura_msgs_t2') != null;
    out.soft2 = R.softDeleteSession('t2');
    out.hard = R.hardDeleteSession('t2');
    out.hardAfter = localStorage.getItem('aura_msgs_t2') != null;
    out.sessionsLeft = JSON.parse(localStorage.getItem('aura_sessions') || '[]').map(s => s.id + (s.deletedAt ? '(del)' : ''));
    /* features.deleteSession 实调（右键菜单入口） */
    const oldConfirm = window.confirm; window.confirm = () => true;
    let delErr = null;
    try { window.Aura.features.deleteSession('t1'); } catch (e) { delErr = String(e && e.message); }
    window.confirm = oldConfirm;
    out.delErr = delErr;
    out.afterFeatureDelete = JSON.parse(localStorage.getItem('aura_sessions') || '[]').map(s => s.id + (s.deletedAt ? '(del)' : ''));
    return out;
  })()`);
  console.log(JSON.stringify(r, null, 1));

  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
