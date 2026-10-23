/* 回归测试：彻底删除必须四步全过（BUG-002）
   修复前：第 1 步就失败（IndexedDB 仍有消息）
   修复后：四步全过
   跑法：node tests/eval_hard_delete.js     需要 127.0.0.1:8000 正在跑
*/
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9391;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "eval-hard-delete");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

let fails = 0;
function check(name, ok, detail) {
  console.log((ok ? "  ✅ " : "  ❌ ") + name + (detail === undefined ? "" : "  → " + detail));
  if (!ok) fails++;
}

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "about:blank"], { stdio: "ignore" });
  let up = false;
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); up = true; break; } catch (e) { await sleep(250); } }
  if (!up) { console.error("Chrome 未启动"); process.exit(2); }
  const tab = await new Promise((res, rej) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
    });
    req.on("error", rej); req.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) + " " + String((r.result.exceptionDetails.exception || {}).description || "").slice(0, 160) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?hd=" + Date.now() });
  await sleep(3600);
  await ev(`(() => {
    localStorage.setItem('aura_onboarded_v2','1');
    localStorage.setItem('aura_mode','direct');
    localStorage.setItem('aura_api_key','sk-dummy-test-only');
    localStorage.setItem('aura_sessions', JSON.stringify([{id:'hd1',title:'删除测试',created:Date.now()-9e5,updated:Date.now(),deletedAt:null}]));
    localStorage.setItem('aura_msgs_hd1','[]');
    location.reload();
  })()`);
  await sleep(4200);

  /* 造 3 条消息：走 records.saveMessages（真实写入路径，会触发 mirror） */
  const seeded = await ev(`(async () => {
    const arr = [
      { id:'hd-a', role:'me', content:'这句必须被彻底删掉', ts: Date.now()-3000 },
      { id:'hd-b', role:'ai', content:'嗯。', ts: Date.now()-2000 },
      { id:'hd-c', role:'me', content:'还有这句', ts: Date.now()-1000 }
    ];
    window.AuraRecords.saveMessages('hd1', arr);
    await (window.AuraDB.flush ? window.AuraDB.flush() : Promise.resolve()).catch(()=>{});
    await new Promise(r=>setTimeout(r,700));
    const all = await window.AuraDB.getAll('messages');
    return { inLs: JSON.parse(localStorage.getItem('aura_msgs_hd1')||'[]').length, inIdb: all.filter(m=>m.sessionId==='hd1').length };
  })()`);
  check("准备：localStorage 3 条、IndexedDB 3 条", seeded && seeded.inLs === 3 && seeded.inIdb === 3, JSON.stringify(seeded));

  /* 删除（软删 + 彻底删），并 await */
  const del = await ev(`(async () => {
    window.AuraRecords.softDeleteSession('hd1');
    const r = window.AuraRecords.hardDeleteSession('hd1');
    if (r && r.then) await r;
    await new Promise(r2=>setTimeout(r2,300));
    const all = await window.AuraDB.getAll('messages');
    return {
      idbLeft: all.filter(m=>m.sessionId==='hd1').length,
      lsKey: localStorage.getItem('aura_msgs_hd1') !== null,
      sessionGone: JSON.parse(localStorage.getItem('aura_sessions')||'[]').every(s=>s.id!=='hd1')
    };
  })()`);
  check("第 1 步：删除后立即读回 IndexedDB = 0 条", del && del.idbLeft === 0, JSON.stringify(del));
  check("第 2 步：localStorage 该会话键不存在", del && del.lsKey === false, JSON.stringify(del));

  /* 第 3/4 步：完全重开（新的页面上下文）→ 再读 */
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?hd2=" + Date.now() });
  await sleep(4500);
  const reopen = await ev(`(async () => {
    const all = await window.AuraDB.getAll('messages');
    return {
      idbLeft: all.filter(m=>m.sessionId==='hd1').length,
      lsKey: localStorage.getItem('aura_msgs_hd1') !== null,
      sessions: JSON.parse(localStorage.getItem('aura_sessions')||'[]').map(s=>s.id)
    };
  })()`);
  check("第 3 步：重开后 IndexedDB 仍 0 条（未复活）", reopen && reopen.idbLeft === 0, JSON.stringify(reopen));
  check("第 4 步：重开后 localStorage 仍无该键（hydrate 没写回）", reopen && reopen.lsKey === false, JSON.stringify(reopen));

  console.log(fails === 0 ? "\n全部通过 ✅" : "\n失败 " + fails + " 项 ❌");
  ws.close(); try { chrome.kill(); } catch (e) { }
  process.exit(fails === 0 ? 0 : 1);
})().catch((e) => { console.error(e && e.stack); process.exit(2); });
