/* w6 两张表：合成后对比度 + 静止→峰值帧 变化像素占比；顺带 w23 振幅 */
const { spawn } = require("child_process");
const fs = require("fs"); const path = require("path"); const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9393;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "w6");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

(async () => {
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
  const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) }; return r.result && r.result.result ? r.result.result.value : null; };

  await send("Page.enable"); await send("Runtime.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__AURA_WAVE_DEBUG__ = true;" });
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?w6=" + Date.now() });
  await sleep(3400);
  await ev(`(() => {
    localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct');
    localStorage.setItem('aura_api_key','sk-dummy'); localStorage.setItem('aura_wave','1');
    const now=Date.now();
    localStorage.setItem('aura_sessions',JSON.stringify([{id:'w6',title:'w6',created:now-1e6,updated:now,deletedAt:null}]));
    localStorage.setItem('aura_msgs_w6',JSON.stringify([{id:'a',role:'ai',content:'在。',ts:now-1e5,deletedAt:null}]));
    location.reload();
  })()`);
  await sleep(4400);
  for (let i = 0; i < 30; i++) {
    const ok = await ev(`!!(window.AuraWave && window.AuraWave.drawStatic)`);
    if (ok === true) break;
    await sleep(400);
  }

  const res = await ev(`(async () => {
    const W = window.AuraWave;
    const states = ['soft','smile','calm','low','tired','blank','sulky','serious'];
    const bgs = ['warm','dusk','cool','gray'];
    const BG = { light: {warm:'#FDF6E8',dusk:'#FBE8D3',cool:'#E9EEF2',gray:'#E4E6E8'},
                 dark:  {warm:'#2A2E33',dusk:'#332C26',cool:'#252B31',gray:'#2C2C2C'} };
    const rgb = h => [1,3,5].map(i=>parseInt(h.substr(i,2),16));
    const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const comp = (f,b,a) => f.map((v,i)=>Math.round(v*a+b[i]*(1-a)));
    const out = { light: [], dark: [], amps: [] };

    for (const mode of ['light','dark']) {
      document.body.setAttribute('data-night', mode==='dark' ? '1':'0');
      for (const bg of bgs) {
        document.body.setAttribute('data-bg', bg);
        for (const st of states) {
          W.drawStatic();
          await new Promise(r=>requestAnimationFrame(r));
          const c = document.getElementById('wave-line');
          const ctx = c.getContext('2d');
          const base = ctx.getImageData(0,0,c.width,c.height).data;
          localStorage.removeItem('aura_wave_log');
          const t = W.maybe({ delta:-0.16,newResidue:0.55,intent:'express',state:st,
            valence: st==='soft'||st==='smile' ? 0.4 : (st==='low'||st==='tired'||st==='calm' ? 0 : -0.5),
            arousal:0.6, residueId:'w6-'+st+'-'+bg, layerId:'W6'+st+bg+Date.now(), first:false, offline:false, safety:false });
          await new Promise(x=>setTimeout(x,900));
          const peak = ctx.getImageData(0,0,c.width,c.height).data;
          let diff = 0;
          for (let i=0;i<base.length;i+=4){ if (base[i+3] !== peak[i+3]) diff++; }
          const width = c.width;
          const threshold = width * 2 * 0.30;
          const a = W._alphaFor(st, mode==='dark', bg);
          const fg = W._palette[mode][st];
          const l1 = lum(comp(rgb(fg), rgb(BG[mode][bg]), a)), l2 = lum(rgb(BG[mode][bg]));
          const ratio = +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2));
          out[mode].push({ st, bg, alpha:a, ratio, diffPx:diff, ratioPct:+((diff/(width*2))*100).toFixed(1),
            main: ratio>=2.2, parallel: diff>=threshold, drawnAmp: t.drawnAmp, amp: t.amp });
          await new Promise(x=>setTimeout(x,300));
        }
      }
    }
    [0,0.1,0.2,0.3,0.4,0.5,0.6,0.8,0.95,1].forEach(i => out.amps.push([i, +W._amplitude(i,false).toFixed(2)]));
    out.conceal = +W._amplitude(1,true).toFixed(2);
    return out;
  })()`);

  console.log(JSON.stringify(res, null, 1).slice(0, 4000));
  fs.writeFileSync(path.join(__dirname, "out-w6.json"), JSON.stringify(res, null, 1), "utf8");
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
