/* 版本矩阵：对 4 个历史版本 + 当前版本跑 6 条高风险断言
   用法: node tools/audit/matrix.js
   输出: tools/audit/out-matrix.json
*/
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9363;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "matrix-prof");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

const TARGETS = [
  { v: "v1.0.7", port: 8011, commit: "aa9eb29" },
  { v: "v1.0.10", port: 8012, commit: "1083875" },
  { v: "v1.0.13", port: 8013, commit: "21791d5" },
  { v: "v1.0.16", port: 8014, commit: "95b9886" }
];

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
  let id = 0; const pend = new Map(); let events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method) events.push(d); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) };
    return r.result && r.result.result ? r.result.result.value : null;
  };
  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

  const out = {};
  for (const t of TARGETS) {
    const base = "http://127.0.0.1:" + t.port;
    const r = {};
    events = [];
    await send("Page.navigate", { url: base + "/?m=" + Date.now() });
    await sleep(3200);
    await ev(`(() => {
      ['aura_onboarded_v2','aura_onboarded','aura_ai_declared_at'].forEach(k => localStorage.setItem(k,'1'));
      localStorage.setItem('aura_mode','direct');
      localStorage.removeItem('aura_api_key');
      localStorage.removeItem('aura_chat_proxy');
      localStorage.removeItem('aura_proxy_url');
      const now = Date.now();
      localStorage.setItem('aura_sessions', JSON.stringify([{id:'mx',title:'矩阵',created:now-9e5,updated:now,deletedAt:null},{id:'mx2',title:'矩阵2',created:now-8e5,updated:now-1e5,deletedAt:null}]));
      localStorage.setItem('aura_msgs_mx', JSON.stringify([{id:'a1',role:'me',content:'今天有点累',ts:now-8e5,deletedAt:null},{id:'a2',role:'ai',content:'那就先歇会儿，不急。',ts:now-7e5,deletedAt:null}]));
      localStorage.setItem('aura_msgs_mx2','[]');
      localStorage.setItem('aura_engine_v1', JSON.stringify({trait:'warm-tsundere',state:'tired',cause:null,patience:73,sulkyTurnsLeft:0,seriousStartedAt:null,lastDecayAt:now,lastSulkyAt:0,lastNoReplyMarkAt:0,updatedAt:now,events:[]}));
      location.reload();
    })()`);
    await sleep(3600);
    if (await ev(`!!(window.Aura && window.Aura.chat && window.Aura.chat.loadSession)`)) {
      await ev(`window.Aura.chat.loadSession('mx'); 1`);
      await sleep(900);
    }

    /* A012 忍耐值是否上屏 */
    r.patienceUI = await ev(`(() => {
      const t = document.body.innerText || '';
      return { hasWord: /忍耐|耐心值|patience/i.test(t), has73: t.split('\\n').some(l => l.trim() === '73') };
    })()`);

    /* A071 气泡字体 */
    r.font = await ev(`(() => {
      const t = document.querySelector('#log .msg.ai .bubble-text') || document.querySelector('.bubble-text') || document.querySelector('#log .msg.ai .bubble');
      if (!t) return { none: true, logLen: (document.getElementById('log')||{}).children ? document.getElementById('log').children.length : -1 };
      const cs = getComputedStyle(t);
      return { family: cs.fontFamily, size: cs.fontSize };
    })()`);

    /* A072 对比度（warm/light） */
    r.contrast = await ev(`(() => {
      const t = document.querySelector('#log .msg.ai .bubble-text') || document.querySelector('#log .msg.ai .bubble');
      if (!t) return { none: true };
      const lum = (c) => { const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
      const rgb = (s) => { const m=String(s).match(/\\d+(\\.\\d+)?/g); return m?m.slice(0,3).map(Number):null; };
      let bg=null, el=t.parentElement;
      while(el){ const c=getComputedStyle(el).backgroundColor; if(c && !/rgba\\(0, 0, 0, 0\\)/.test(c)){bg=c;break;} el=el.parentElement; }
      if(!bg) bg=getComputedStyle(document.body).backgroundColor;
      const l1=lum(rgb(getComputedStyle(t).color)||[0,0,0]), l2=lum(rgb(bg)||[255,255,255]);
      return { ratio: +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)), color: getComputedStyle(t).color, bg };
    })()`);

    /* A024 全删会话不崩 */
    r.empty = await ev(`(async () => {
      const errs = []; const old = console.error; console.error = (...a) => errs.push(String(a[0]));
      window.addEventListener('error', e => errs.push('onerror:' + e.message), { once: true });
      const R = window.AuraRecords || (window.Aura && window.Aura.records);
      let deleted = 0, threw = null;
      try {
        if (R && R.softDeleteSession) { (R.sessions ? R.sessions({}) : []).forEach(s => { R.softDeleteSession(s.id); deleted++; }); }
        else {
          const list = JSON.parse(localStorage.getItem('aura_sessions') || '[]');
          localStorage.setItem('aura_sessions', JSON.stringify(list.map(s => Object.assign({}, s, { deletedAt: Date.now() }))));
          deleted = list.length;
        }
        if (window.Aura && window.Aura.chat && window.Aura.chat.loadSession) window.Aura.chat.loadSession('nope');
      } catch (e) { threw = String(e && e.message); }
      await new Promise(r => setTimeout(r, 400));
      console.error = old;
      return { deleted, threw, errs: errs.slice(0, 2) };
    })()`);

    /* A023 彻底删除真的删 localStorage */
    r.hard = await ev(`(() => {
      const R = window.AuraRecords || (window.Aura && window.Aura.records);
      if (!R || !R.hardDeleteSession) return { noApi: true };
      const before = localStorage.getItem('aura_msgs_mx') != null;
      let ret = null;
      try { ret = R.hardDeleteSession('mx'); } catch (e) { return { threw: String(e && e.message) }; }
      const after = localStorage.getItem('aura_msgs_mx') != null;
      return { before, after, ret };
    })()`);

    /* A044 无 Key 不回落 /api/chat */
    const before = events.filter(e => e.method === "Network.requestWillBeSent").length;
    r.nokey = await ev(`(async () => {
      const t = document.getElementById('input'), b = document.getElementById('btn-send');
      if (!t || !b) return { noInput: true };
      t.value = '在吗'; t.dispatchEvent(new Event('input', { bubbles: true }));
      b.click();
      await new Promise(r => setTimeout(r, 1500));
      return { gate: !!document.querySelector('.key-gate, #key-gate, .modal, .sheet') };
    })()`);
    await sleep(300);
    const urls = events.filter(e => e.method === "Network.requestWillBeSent").slice(before).map(e => e.params.request.url);
    r.nokey.reqs = urls.filter(u => /\/api\/chat/.test(u)).length;
    r.nokey.modelReqs = urls.filter(u => /deepseek\.com/.test(u)).length;

    out[t.v] = r;
  }

  fs.writeFileSync(path.join(__dirname, "out-matrix.json"), JSON.stringify(out, null, 1), "utf8");
  for (const [v, r] of Object.entries(out)) {
    console.log(v,
      "| patience上屏:", r.patienceUI && (r.patienceUI.hasWord || r.patienceUI.has73),
      "| 字体:", (r.font && (r.font.family || 'none') || '').slice(0, 46),
      "| 对比度:", r.contrast && r.contrast.ratio,
      "| 空态崩:", !!(r.empty && (r.empty.threw || (r.empty.errs || []).length)),
      "| 硬删:", JSON.stringify(r.hard),
      "| 无Key本地请求:", r.nokey && r.nokey.reqs, "模型请求:", r.nokey && r.nokey.modelReqs);
  }
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
