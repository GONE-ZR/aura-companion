/* 追加探针：无 Key 引导到底出不出现 / 情绪色偏移语义 / features.deleteSession 是否导出 */
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9364;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "probe2");
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
  let id = 0; const pend = new Map(); let events = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.method) events.push(d); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?p2=" + Date.now() });
  await sleep(3600);
  await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.removeItem('aura_api_key'); localStorage.removeItem('aura_chat_proxy'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'q1',title:'探针',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_q1',JSON.stringify([{id:'a',role:'me',content:'累',ts:now-9e5,deletedAt:null},{id:'b',role:'ai',content:'那就歇会儿。',ts:now-8e5,deletedAt:null}])); location.reload(); })()`);
  await sleep(4200);
  await ev(`window.Aura.chat.loadSession('q1'); 1`);
  await sleep(800);

  /* 情绪色语义 */
  const hue = await ev(`(async () => {
    const h = () => parseFloat(document.documentElement.style.getPropertyValue('--acc-h') || getComputedStyle(document.documentElement).getPropertyValue('--acc-h'));
    const out = {};
    window.AuraEmotionUI.applyMeta({ e:'calm', b:'warm', i:0 }); out.calmDefault = h();
    window.AuraEmotionUI.applyMeta({ e:'sulky', b:'cool', i:0 }); out.sulkyDefault = h();
    await window.Aura.remote.apply({ theme: { accent: '#002FA7' }, features: {} }, 'probe');
    out.afterRemote = h();
    window.AuraEmotionUI.applyMeta({ e:'calm', b:'warm', i:0 }); out.calmAfterRemote = h();
    window.AuraEmotionUI.applyMeta({ e:'sulky', b:'cool', i:0 }); out.sulkyAfterRemote = h();
    return out;
  })()`);
  console.log('hue:', JSON.stringify(hue));

  /* 无 Key：引导层与 toast 原文 */
  const nokey = await ev(`(async () => {
    localStorage.removeItem('aura_api_key');
    if (window.Aura.cfg) { window.Aura.cfg.apiKey = ''; window.Aura.cfg.mode = 'direct'; }
    const t = document.getElementById('input'), b = document.getElementById('btn-send');
    t.value = '在吗'; t.dispatchEvent(new Event('input', { bubbles: true }));
    b.click();
    const seen = [];
    for (let i = 0; i < 24; i++) {
      await new Promise(r => setTimeout(r, 100));
      const all = [...document.querySelectorAll('body *')].filter(e => {
        const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
        return r.width > 80 && r.height > 20 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.1;
      });
      const hit = all.filter(e => /密钥|Key|填|设置|没配/.test(e.textContent || '') && e.children.length < 6 && (e.textContent || '').length < 140);
      hit.slice(0, 2).forEach(e => { const s = e.textContent.trim().replace(/\\s+/g, ' ').slice(0, 80); if (s && !seen.includes(s)) seen.push(s); });
    }
    const dialogs = [...document.querySelectorAll('[role=dialog], .modal, .sheet, .gate, #key-gate, [id*=key], [class*=key]')].map(e => e.id + '.' + e.className).slice(0, 6);
    return { seen: seen.slice(0, 5), dialogs, showKeyGate: typeof window.Aura.showKeyGate, bodyTail: (document.body.innerText || '').slice(-160) };
  })()`);
  console.log('nokey:', JSON.stringify(nokey, null, 1));

  /* features.deleteSession 导出 */
  const feat = await ev(`({ keys: Object.keys(window.Aura.features || {}), hasDelete: typeof (window.Aura.features || {}).deleteSession })`);
  console.log('features:', JSON.stringify(feat));

  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
