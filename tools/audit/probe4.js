/* 验证：彻底删除后 IndexedDB 是否残留 / 重新加载是否"复活" */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9366;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "probe4");
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
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?p4=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','sk-dummy'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'z1',title:'IDB残留',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_z1',JSON.stringify([{id:'zz1',role:'me',sessionId:'z1',content:'这句应该被彻底删掉',ts:now-9e5},{id:'zz2',role:'ai',sessionId:'z1',content:'嗯。',ts:now-8e5}])); location.reload(); })()`);
  await sleep(4500);
  await ev(`window.Aura.chat.loadSession('z1'); 1`);
  await sleep(1200);

  const before = await ev(`window.AuraDB.count('messages').then(n => ({ idbMessages: n, ls: localStorage.getItem('aura_msgs_z1') != null }))`);
  const del = await ev(`(() => {
    const R = window.AuraRecords;
    R.softDeleteSession('z1');
    const r = R.hardDeleteSession('z1');
    return { hard: r, lsAfter: localStorage.getItem('aura_msgs_z1') != null };
  })()`);
  await sleep(800);
  const idbAfter = await ev(`window.AuraDB.getAll('messages').then(a => a.filter(m => m.sessionId === 'z1').map(m => ({ id: m.id, text: (m.text||m.content||'').slice(0,18) })))`);

  await send("Page.reload"); await sleep(5000);
  const revived = await ev(`({ lsKey: localStorage.getItem('aura_msgs_z1') != null, sessions: JSON.parse(localStorage.getItem('aura_sessions')||'[]').map(s => s.id + (s.deletedAt?'(del)':'')) })`);

  console.log(JSON.stringify({ before, del, idbAfter, revived }, null, 1));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
