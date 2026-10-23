/* 阶段六修正令 · 验收脚本
   输出: tools/audit/out-p6.json + 证据截图（同目录 p6-evidence/）
*/
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9371;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "p6-prof");
const EVID = path.join(__dirname, "p6-evidence");
const KEY = process.env.AURA_TEST_KEY || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });

const out = {};
const put = (k, v) => { out[k] = v; };

(async () => {
  fs.mkdirSync(EVID, { recursive: true });
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE, "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
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
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) + " " + String((r.result.exceptionDetails.exception || {}).description || "").slice(0, 200) };
    return r.result && r.result.result ? r.result.result.value : null;
  };
  const shot = async (name, h, scale) => {
    const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 390, height: h, scale: scale || 2 }, fromSurface: true });
    if (r.result && r.result.data) { fs.writeFileSync(path.join(EVID, name), Buffer.from(r.result.data, "base64")); return true; }
    return false;
  };
  const metrics = (w, h, dpr) => send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr || 2, mobile: true, screenWidth: w, screenHeight: h });

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__AURA_WAVE_DEBUG__ = true;" });
  await metrics(390, 844, 2);

  const boot = async (withKey) => {
    await send("Page.navigate", { url: "http://127.0.0.1:8000/?p6=" + Date.now() });
    await sleep(3200);
    await ev(`(() => {
      localStorage.setItem('aura_onboarded_v2','1');
      localStorage.setItem('aura_mode','direct');
      ${withKey ? "localStorage.setItem('aura_api_key','" + KEY + "');" : "localStorage.removeItem('aura_api_key'); localStorage.removeItem('aura_chat_proxy');"}
      localStorage.setItem('aura_wave','1');
      localStorage.removeItem('aura_wave_log');
      const now=Date.now();
      localStorage.setItem('aura_sessions', JSON.stringify([{id:'p6',title:'阶段六',created:now-9e5,updated:now,deletedAt:null}]));
      localStorage.setItem('aura_msgs_p6', JSON.stringify([{id:'q1',role:'me',content:'今天有点累',ts:now-8e5,deletedAt:null},{id:'q2',role:'ai',content:'那就先歇会儿，不急。',ts:now-7e5,deletedAt:null}]));
      localStorage.setItem('aura_engine_v1', JSON.stringify({trait:'warm-tsundere',state:'tired',cause:null,patience:73,sulkyTurnsLeft:0,seriousStartedAt:null,lastDecayAt:now,lastSulkyAt:0,lastNoReplyMarkAt:0,updatedAt:now,events:[],core:{valence:0.2,arousal:0.5,bond:0.5,target:'self',intent:'express',residue:[],updatedAt:now}}));
      location.reload();
    })()`);
    await sleep(4200);
    await ev(`try { window.Aura.chat.loadSession('p6'); } catch(e) {} 1`);
    await sleep(900);
  };

  /* ===================== 0. 有 Key 启动：数字 ===================== */
  await boot(!!KEY);
  put("hasKey", !!KEY);

  /* 主题设置器 */
  const setTheme = (bg, night) => ev(`(() => {
    if (!document.getElementById('p6-freeze')) {
      const st = document.createElement('style'); st.id = 'p6-freeze';
      st.textContent = '*{transition:none!important;animation:none!important}';
      document.head.appendChild(st);
    }
    document.body.setAttribute('data-bg','${bg}');
    document.body.setAttribute('data-night','${night}');
    document.body.setAttribute('data-st','calm');
    if (window.AuraWave) { window.AuraWave.sync(); window.AuraWave.drawStatic(); }
    return 1;
  })()`);

  const trigger = (state, extra) => ev(`(() => {
    try { localStorage.removeItem('aura_wave_log'); } catch (e) {}
    return window.AuraWave.maybe(Object.assign({
      delta: -0.15, newResidue: 0.25, intent: 'express', state: '${state}',
      valence: -0.4, arousal: 0.7, residueId: 'r${state}', layerId: 'L${state}' + Date.now(),
      first: false, offline: false, safety: false
    }, ${JSON.stringify(extra || {})}));
  })()`);

  const canvasStats = () => ev(`(() => {
    const c = document.getElementById('wave-line');
    if (!c) return { none: true };
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxA = 0, rows = [];
    for (let y=0; y<c.height; y++) { let n=0; for (let x=0; x<c.width; x++){ const A=d[(y*c.width+x)*4+3]; if(A>0)n++; if(A>maxA)maxA=A; } rows.push(n); }
    return { maxA, rows, w: c.width, h: c.height, display: getComputedStyle(c).display };
  })()`);

  /* --- 数字 1/2/6：像素 bbox 与顶部栏 diff --- */
  const cases = [
    { name: "light", bg: "warm", night: "0" },
    { name: "dark", bg: "warm", night: "1" }
  ];
  for (const cs of cases) {
    await setTheme(cs.bg, cs.night);
    await sleep(400);
    await shot("p6-" + cs.name + "-static.png", 60, 2);
    const t = await trigger("sulky");
    await sleep(700);                       /* 生长完成，进入保持段 */
    await shot("p6-" + cs.name + "-active.png", 60, 2);
    await sleep(2600);
    await shot("p6-" + cs.name + "-after.png", 60, 2);
    out["trig_" + cs.name] = t;
    out["canvas_" + cs.name] = await canvasStats();
  }

  /* --- 数字 5：八状态静止态截图（浅/深各 8 张）--- */
  const states = ["soft", "smile", "calm", "low", "tired", "blank", "sulky", "serious"];
  for (const mode of ["light", "dark"]) {
    await setTheme("warm", mode === "dark" ? "1" : "0");
    await sleep(300);
    for (const st of states) {
      await ev(`(() => { const c=document.getElementById('wave-line'); if(c){ const x=c.getContext('2d'); x.clearRect(0,0,c.width,c.height);} window.AuraWave.drawStatic(); return 1; })()`);
      await sleep(120);
      await shot("p6-static-" + mode + "-" + st + ".png", 4, 2);
    }
  }

  /* --- 数字 4：fps --- */
  const fps = await ev(`(async () => {
    localStorage.removeItem('aura_wave_log');
    window.AuraWave.maybe({ delta:-0.15,newResidue:0.25,intent:'express',state:'sulky',valence:-0.4,arousal:0.7,residueId:'fps',layerId:'F'+Date.now(),first:false,offline:false,safety:false });
    let n = 0; const t0 = performance.now();
    await new Promise(r => { function tick(){ n++; if (performance.now()-t0 < 2300) requestAnimationFrame(tick); else r(); } requestAnimationFrame(tick); });
    return { fps: Math.round(n / 2.3), frames: n };
  })()`);
  put("fps", fps);

  /* --- 数字 8：10 组振幅 --- */
  put("amps", await ev(`(() => {
    const W = window.AuraWave, rows = [];
    [0,0.1,0.2,0.3,0.4,0.5,0.6,0.8,0.95,1].forEach(i => rows.push([i, +W._amplitude(i,false).toFixed(2)]));
    return { rows, conceal: +W._amplitude(1,true).toFixed(2), max: Math.max(...rows.map(r=>r[1]), W._amplitude(1,true)) };
  })()`));

  /* --- 数字 9：ΔE 表（模块内八色） --- */
  put("de", await ev(`(() => {
    const P = window.AuraWave._palette;
    const fam = { soft:'暖', smile:'暖', calm:'墨', low:'冷', tired:'冷', blank:'冷', sulky:'红', serious:'红' };
    function lab(hex){ const c=[1,3,5].map(i=>parseInt(hex.substr(i,2),16)/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));
      let x=(c[0]*0.4124+c[1]*0.3576+c[2]*0.1805)/0.95047, y=(c[0]*0.2126+c[1]*0.7152+c[2]*0.0722), z=(c[0]*0.0193+c[1]*0.1192+c[2]*0.9505)/1.08883;
      const g=t=>t>0.008856?Math.pow(t,1/3):7.787*t+16/116; const fx=g(x),fy=g(y),fz=g(z);
      return [116*fy-16,500*(fx-fy),200*(fy-fz)]; }
    function de(a,b){ const A=lab(a),B=lab(b); return Math.sqrt(A.reduce((s,v,i)=>s+Math.pow(v-B[i],2),0)); }
    function calc(pal){ const ks=Object.keys(pal); let intra=0, inter=99, wIntra=null;
      for(let i=0;i<ks.length;i++) for(let j=i+1;j<ks.length;j++){ const v=de(pal[ks[i]],pal[ks[j]]);
        if(fam[ks[i]]===fam[ks[j]]){ if(v>intra){intra=v; wIntra=[ks[i],ks[j]];} } else if(v<inter) inter=v; }
      return { intra:+intra.toFixed(1), inter:+inter.toFixed(1), worst: wIntra }; }
    return { light: calc(P.light), dark: calc(P.dark) };
  })()`));

  /* --- 数字 3：对比度（用模块内的 alpha 表 + 背景色，页面内算）--- */
  put("contrast", await ev(`(() => {
    const T = window.AuraWave._alphaTable, P = window.AuraWave._palette;
    const BG = { light: {warm:'#FDF6E8',dusk:'#FBE8D3',cool:'#E9EEF2',gray:'#E4E6E8'}, dark: {warm:'#2A2E33',dusk:'#332C26',cool:'#252B31',gray:'#2C2C2C'} };
    const rgb = h => [1,3,5].map(i=>parseInt(h.substr(i,2),16));
    const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const comp = (f,b,a) => f.map((v,i)=>Math.round(v*a+b[i]*(1-a)));
    function run(mode){ const rows=[]; let worst=99, worstAt=null;
      Object.keys(T[mode]).forEach(st => Object.keys(BG[mode]).forEach(bg => {
        const a=T[mode][st][bg], c=comp(rgb(P[mode][st]), rgb(BG[mode][bg]), a);
        const l1=lum(c), l2=lum(rgb(BG[mode][bg])); const r=(Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05);
        rows.push([st,bg,a,+r.toFixed(2)]); if(r<worst){worst=r; worstAt=[st,bg];}
      }));
      return { worst:+worst.toFixed(2), worstAt, rows }; }
    return { light: run('light'), dark: run('dark') };
  })()`));

  /* ===================== w30 banner 避让 ===================== */
  await boot(false);                          /* 无 Key → banner 出现 */
  await sleep(800);
  out.w30_banner = await ev(`(async () => {
    const W = window.AuraWave;
    W.sync();
    const c = document.getElementById('wave-line');
    const before = W.state();
    const logBefore = JSON.parse(localStorage.getItem('aura_wave_log') || '[]').length;
    const t = W.maybe({ delta:-0.3,newResidue:0.4,intent:'conceal',state:'serious',valence:-0.8,arousal:0.8,residueId:'b',layerId:'B'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(r=>setTimeout(r,500));
    const logAfter = JSON.parse(localStorage.getItem('aura_wave_log') || '[]').length;
    return { bannerOff: before.bannerOff, display: c ? getComputedStyle(c).display : 'no-canvas', wrapDisplay: (document.getElementById('wave-wrap')||{}).style && document.getElementById('wave-wrap').style.display, rafCalls: W.state().rafCalls, fired: t, logBefore, logAfter, bannerText: (document.body.innerText||'').includes('还没填') };
  })()`);

  /* 填 Key → 重载 → banner 消失 → 恢复挂载 + 可触发 + 冷却未被重置 */
  await ev(`(() => {
    localStorage.setItem('aura_api_key','${KEY || "sk-dummy-for-banner-test"}');
    localStorage.setItem('aura_wave_log', JSON.stringify([Date.now()-60000, Date.now()-30000]));
    location.reload();
  })()`);
  await sleep(5200);
  await ev(`try { window.Aura.chat.loadSession('p6'); } catch(e) {} 1`);
  await sleep(800);
  out.w30_recover = await ev(`(async () => {
    const W = window.AuraWave;
    W.sync();
    await new Promise(r=>setTimeout(r,300));
    const c = document.getElementById('wave-line');
    const st = W.state();
    const t = W.maybe({ delta:-0.3,newResidue:0.4,intent:'conceal',state:'serious',valence:-0.8,arousal:0.8,residueId:'b2',layerId:'B2'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(r=>setTimeout(r,300));
    return {
      bannerOff: st.bannerOff, display: c ? getComputedStyle(c).display : 'none',
      fired: t, logLen: JSON.parse(localStorage.getItem('aura_wave_log')||'[]').length,
      bannerStillThere: (document.body.innerText||'').includes('还没填')
    };
  })()`);

  /* ===================== w18 钩子 ===================== */
  out.w18 = await ev(`(async () => {
    const W = window.AuraWave;
    W.waveHideForCapture(); W.waveHideForCapture();
    const c = document.getElementById('wave-line');
    const hidden = c ? getComputedStyle(c).display : 'none';
    const s1 = W.state();
    W.waveRestoreAfterCapture(); W.waveRestoreAfterCapture();
    await new Promise(r=>setTimeout(r,150));
    const shown = c ? getComputedStyle(c).display : 'none';
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxA = 0; for (let i=3;i<d.length;i+=4) if (d[i]>maxA) maxA = d[i];
    return { hiddenDisplay: hidden, hiddenMounted: s1.mounted, shownDisplay: shown, staticMaxAlpha: maxA, wrapCount: document.querySelectorAll('#wave-wrap').length };
  })()`);

  /* ===================== §7 开关 / w15 ===================== */
  out.w15 = await ev(`(async () => {
    const sw = document.getElementById('in-wave');
    if (!sw) return { noSwitch: true };
    sw.click();
    await new Promise(r=>setTimeout(r,300));
    const offState = window.AuraWave.state();
    const t = window.AuraWave.maybe({ delta:-0.5,newResidue:0.5,intent:'conceal',state:'sulky',valence:-0.8,arousal:0.8,residueId:'x',layerId:'X'+Date.now(),first:false,offline:false,safety:false });
    const c = document.getElementById('wave-line');
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxA = 0, nonEmpty = 0, colored = 0;
    for (let i=3;i<d.length;i+=4){ const A=d[i]; if(A>0){ nonEmpty++;
      const r=d[i-3],g=d[i-2],b=d[i-1];
      /* 只看“够亮且明显有色”的像素：低 alpha 的抗锯齿边不算颜色 */
      if (A >= 40 && Math.max(r,g,b) - Math.min(r,g,b) >= 25) colored++; }
      if(A>maxA)maxA=A; }
    sw.click();
    await new Promise(r=>setTimeout(r,150));
    return { ariaOff: sw.getAttribute('aria-checked'), enabled: offState.enabled, fired: t, maxAlphaWhenOff: maxA, nonEmptyWhenOff: nonEmpty, coloredPxWhenOff: colored, restored: window.AuraWave.state().enabled };
  })()`);

  /* ===================== §8 reduced motion / w16 ===================== */
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  await sleep(2800);                       /* 等上一轮动画/降级定时器结束 */
  out.w16 = await ev(`(async () => {
    window.AuraWave.sync();
    localStorage.removeItem('aura_wave_log');
    await new Promise(r=>setTimeout(r,100));
    const t = window.AuraWave.maybe({ delta:-0.2,newResidue:0.3,intent:'express',state:'low',valence:-0.5,arousal:0.2,residueId:'rm',layerId:'R'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(r=>setTimeout(r,200));
    const s = window.AuraWave.state();
    const c = document.getElementById('wave-line');
    const d = c.getContext('2d').getImageData(0,0,c.width,c.height).data;
    let maxA=0; for(let i=3;i<d.length;i+=4) if(d[i]>maxA)maxA=d[i];
    return { reducedMode: t, rafCalls: s.rafCalls, animating: s.animating, maxAlpha: maxA };
  })()`);
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

  /* ===================== w11 / w12 / w13 / w14 ===================== */
  out.w11 = await ev(`(() => {
    function run(intent) {
      let fired = 0;
      for (let i = 0; i < 10; i++) {
        localStorage.removeItem('aura_wave_log');
        const r = window.AuraWave.maybe({ delta: intent==='conceal'?0.0:0.02, newResidue: 0, intent: intent, state:'tired',
          valence: 0.05, arousal: 0.35, residueId:'c'+i, layerId: intent+i+'_'+Date.now(), first:false, offline:false, safety:false });
        if (r.fired) fired++;
      }
      return fired;
    }
    return { conceal: run('conceal'), express: run('express') };
  })()`);

  out.w12 = await ev(`(() => {
    let fired = 0;
    for (let i = 0; i < 10; i++) {
      localStorage.removeItem('aura_wave_log');
      const r = window.AuraWave.maybe({ delta:-0.9,newResidue:0.9,intent:'conceal',state:'serious',valence:-0.9,arousal:0.9,residueId:'s'+i,layerId:'S'+i+'_'+Date.now(),first:false,offline:false,safety:true });
      if (r.fired) fired++;
    }
    return { fired };
  })()`);

  out.w13 = await ev(`(() => {
    localStorage.removeItem('aura_wave_log');
    let fired = 0;
    for (let i = 0; i < 8; i++) {
      const r = window.AuraWave.maybe({ delta:-0.3,newResidue:0.3,intent:'express',state:'sulky',valence:-0.5,arousal:0.7,residueId:'k'+i,layerId:'K'+i+'_'+Date.now(),first:false,offline:false,safety:false });
      if (r.fired) fired++;
    }
    return { attempts: 8, fired };
  })()`);

  /* w14：先等上一轮动画彻底结束，再触发 → 2.5s 后必须与静止逐字节相同 */
  await sleep(2600);
  out.w14 = await ev(`(async () => {
    window.AuraWave.drawStatic();
    await new Promise(r=>setTimeout(r,200));
    const c = document.getElementById('wave-line');
    const snap = () => Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
    const base = snap();
    localStorage.removeItem('aura_wave_log');
    window.AuraWave.maybe({ delta:-0.3,newResidue:0.3,intent:'express',state:'sulky',valence:-0.5,arousal:0.7,residueId:'t',layerId:'T'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(r=>setTimeout(r,2550));
    const after = snap();
    let diff = 0, maxD = 0;
    for (let i=0;i<base.length;i++){ const d=Math.abs(base[i]-after[i]); if(d){diff++; if(d>maxD)maxD=d;} }
    return { diffPx: diff, maxDelta: maxD };
  })()`);

  /* ===================== w17 降级 ===================== */
  out.w17_degrade = await ev(`(async () => {
    const orig = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 25);
    localStorage.removeItem('aura_wave_log');
    window.AuraWave.maybe({ delta:-0.3,newResidue:0.3,intent:'express',state:'tired',valence:-0.4,arousal:0.6,residueId:'d',layerId:'D'+Date.now(),first:false,offline:false,safety:false });
    await new Promise(r=>setTimeout(r,1400));
    const s = window.AuraWave.state();
    const lite = document.getElementById('wave-wrap').classList.contains('wave-lite');
    window.requestAnimationFrame = orig;
    await new Promise(r=>setTimeout(r,1500));
    return { degraded: s.degraded, liteClass: lite };
  })()`);

  /* ===================== w24 非主聊天页 ===================== */
  out.w24 = await ev(`(async () => {
    const W = window.AuraWave;
    const res = {};
    function vis() { const c = document.getElementById('wave-line'); return c ? getComputedStyle(c).display : 'no-canvas'; }
    async function chk(name, open, close) {
      open(); await new Promise(r=>setTimeout(r,350)); W.sync();
      res[name] = vis();
      close(); await new Promise(r=>setTimeout(r,300)); W.sync();
    }
    const drawer = document.getElementById('drawer'), scrim = document.getElementById('scrim');
    await chk('settings', ()=>{drawer.setAttribute('aria-hidden','false'); scrim.hidden=false;}, ()=>{drawer.setAttribute('aria-hidden','true'); scrim.hidden=true;});
    const sheet = document.getElementById('sheet');
    await chk('sheet', ()=>{sheet.setAttribute('aria-hidden','false');}, ()=>{sheet.setAttribute('aria-hidden','true');});
    const modal = document.getElementById('modal');
    await chk('modal', ()=>{modal.hidden=false;}, ()=>{modal.hidden=true;});
    const kg = document.getElementById('keygate');
    await chk('keygate', ()=>{kg.hidden=false;}, ()=>{kg.hidden=true;});
    res.main = vis();
    return res;
  })()`);

  /* ===================== w25 横屏 / 键盘（可视高度过小） ===================== */
  await metrics(844, 390, 2);
  await sleep(300);
  out.w25_landscape = await ev(`(() => { window.AuraWave.sync(); const c=document.getElementById('wave-line'); return { display: c?getComputedStyle(c).display:'none', state: window.AuraWave.state() }; })()`);
  await metrics(390, 460, 2);
  await sleep(400);
  out.w25_keyboard = await ev(`(() => {
    window.AuraWave.sync();
    const c = document.getElementById('wave-line');
    return { display: c ? getComputedStyle(c).display : 'none', innerH: window.innerHeight, vvH: window.visualViewport ? Math.round(window.visualViewport.height) : null };
  })()`);
  await metrics(390, 844, 2);
  await sleep(300);
  out.w25_restored = await ev(`(() => { window.AuraWave.sync(); const c=document.getElementById('wave-line'); return { display: c ? getComputedStyle(c).display : 'none' }; })()`);

  /* ===================== 数字 7：首字延迟 ===================== */
  if (KEY) {
    await metrics(390, 844, 2);
    await send("Page.navigate", { url: "http://127.0.0.1:8000/?lat=" + Date.now() });
    await sleep(3400);
    await ev(`(() => { localStorage.setItem('aura_onboarded_v2','1'); localStorage.setItem('aura_mode','direct'); localStorage.setItem('aura_api_key','${KEY}'); const now=Date.now(); localStorage.setItem('aura_sessions',JSON.stringify([{id:'lt2',title:'延迟',created:now-1e6,updated:now,deletedAt:null}])); localStorage.setItem('aura_msgs_lt2','[]'); location.reload(); })()`);
    await sleep(4200);
    await ev(`window.Aura.cfg.apiKey='${KEY}'; window.Aura.save.apiKey('${KEY}'); window.Aura.chat.loadSession('lt2'); 1`);
    await sleep(600);
    const runOne = (on) => ev(`(async () => {
      localStorage.setItem('aura_wave','${on ? 1 : 0}');
      window.AuraWave.init();
      const t=document.getElementById('input'), b=document.getElementById('btn-send');
      t.value='在吗'; t.dispatchEvent(new Event('input',{bubbles:true}));
      const t0=performance.now(); b.click();
      let first=null;
      for (let k=0;k<180;k++){ await new Promise(r=>setTimeout(r,25));
        const ai=[...document.querySelectorAll('#log .msg.ai')].slice(-1)[0];
        if (ai && ai.querySelector('.bubble-text') && ai.querySelector('.bubble-text').textContent.trim()) { first=performance.now()-t0; break; } }
      await new Promise(r=>setTimeout(r,1200));
      return first?Math.round(first):null;
    })()`);
    const off = [], on = [];
    for (let i = 0; i < 6; i++) {          /* 交替跑，抵消模型端漂移 */
      off.push(await runOne(false));
      on.push(await runOne(true));
    }
    const med = a => { const v=a.filter(Boolean).sort((x,y)=>x-y); return v.length ? v[Math.floor(v.length/2)] : null; };
    const avg = a => { const v=a.filter(Boolean); return v.length ? Math.round(v.reduce((x,y)=>x+y,0)/v.length) : null; };
    /* 波动线自身耗时：从“首字已渲染”到“开始画”之间只做一次判断 + 一次首帧 */
    const cost = await ev(`(async () => {
      localStorage.setItem('aura_wave','1');
      localStorage.removeItem('aura_wave_log');
      const t0 = performance.now();
      window.AuraWave.maybe({ delta:-0.2,newResidue:0.3,intent:'express',state:'tired',valence:-0.4,arousal:0.6,residueId:'cost',layerId:'C'+Date.now(),first:false,offline:false,safety:false });
      const t1 = performance.now();
      await new Promise(r => requestAnimationFrame(() => r()));
      const t2 = performance.now();
      return { maybeMs: +(t1-t0).toFixed(2), firstFrameMs: +(t2-t1).toFixed(2) };
    })()`);
    out.latency = { off, on, offMedian: med(off), onMedian: med(on), offAvg: avg(off), onAvg: avg(on), deltaMedian: med(on) - med(off), waveCost: cost };
  }

  /* ===================== w19 桌面端 ===================== */
  await send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36 Electron/33.0.0" });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?desk=" + Date.now() });
  await sleep(4200);
  out.w19 = await ev(`({ hasWrap: !!document.getElementById('wave-wrap'), hasCanvas: !!document.getElementById('wave-line') })`);

  fs.writeFileSync(path.join(__dirname, "out-p6.json"), JSON.stringify(out, null, 1), "utf8");
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
  ws.close(); try { chrome.kill(); } catch (e) { }
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
