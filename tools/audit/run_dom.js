/* 运行时核查（浏览器 / CDP）：DOM、CSS、链路行为
   用法: node tools/audit/run_dom.js
   输出: tools/audit/out-dom.json
*/
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const PORT = 9361;
const PROFILE = path.join(process.env.LOCALAPPDATA, "Temp", "opencode", "audit-prof");
const OUT = path.join(__dirname, "out-dom.json");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (u) => new Promise((res, rej) => { http.get(u, (r) => { let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(b)); }).on("error", rej); });
const out = {};
const put = (k, ok, ev, detail) => { out[k] = { ok: !!ok, ev, detail: detail === undefined ? null : detail }; };

(async () => {
  fs.rmSync(PROFILE, { recursive: true, force: true });
  const chrome = spawn(CHROME, ["--remote-debugging-port=" + PORT, "--user-data-dir=" + PROFILE,
    "--no-first-run", "--no-default-browser-check", "--window-size=520,940", "about:blank"], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) { try { await get("http://127.0.0.1:" + PORT + "/json/version"); break; } catch (e) { await sleep(250); } }
  const tab = await new Promise((res, rej) => {
    const req = http.request({ host: "127.0.0.1", port: PORT, path: "/json/new?about:blank", method: "PUT" }, (r) => {
      let b = ""; r.on("data", (c) => (b += c)); r.on("end", () => res(JSON.parse(b)));
    }); req.on("error", rej); req.end();
  });
  const ws = new WebSocket(tab.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const events = [];
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.method) events.push(d);
    if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
  };
  const send = (m, p) => new Promise((res) => { const my = ++id; pend.set(my, res); ws.send(JSON.stringify({ id: my, method: m, params: p || {} })); });
  const ev = async (e) => {
    const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true, userGesture: true });
    if (r.result && r.result.exceptionDetails) return { __err: String(r.result.exceptionDetails.text) + " " + String((r.result.exceptionDetails.exception || {}).description || "").slice(0, 160) };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  await send("Page.enable"); await send("Runtime.enable"); await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true, screenWidth: 390, screenHeight: 844 });

  /* ---------- 装载 ---------- */
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?audit=" + Date.now() });
  await sleep(3800);
  await ev(`(() => {
    localStorage.setItem('aura_onboarded_v2','1');
    localStorage.setItem('aura_mode','direct');
    localStorage.setItem('aura_api_key','sk-dummy-audit-only');
    localStorage.removeItem('aura_wave_log');
    const now=Date.now();
    localStorage.setItem('aura_sessions', JSON.stringify([{id:'au1',title:'审计A',created:now-9e6,updated:now,deletedAt:null},{id:'au2',title:'审计B',created:now-8e6,updated:now-1e6,deletedAt:null}]));
    localStorage.setItem('aura_msgs_au1', JSON.stringify([
      {id:'m1',role:'me',content:'今天有点累',ts:now-7200000,deletedAt:null},
      {id:'m2',role:'ai',content:'那就先歇一会儿，不急。',ts:now-7100000,deletedAt:null}
    ]));
    localStorage.setItem('aura_msgs_au2', JSON.stringify([{id:'m3',role:'ai',content:'我在。',ts:now-1000000,deletedAt:null}]));
    localStorage.setItem('aura_engine_v1', JSON.stringify({trait:'warm-tsundere',state:'tired',cause:null,patience:73,sulkyTurnsLeft:0,seriousStartedAt:null,lastDecayAt:now,lastSulkyAt:0,lastNoReplyMarkAt:0,updatedAt:now,events:[],core:{valence:0.42,arousal:0.55,bond:0.62,target:'self',intent:'conceal',residue:[],updatedAt:now}}));
    location.reload();
  })()`);
  await sleep(4200);
  await ev(`window.Aura.chat.loadSession('au1'); 1`);
  await sleep(1000);

  /* ---------- 视觉：字体 / 气泡 / 网点 / 对比度 ---------- */
  const vis = await ev(`(() => {
    const b = document.querySelector('#log .msg.ai .bubble');
    const txt = document.querySelector('#log .msg.ai .bubble .bubble-text') || b;
    if (!b) return { err: 'no bubble' };
    const cs = getComputedStyle(txt);
    const bcs = getComputedStyle(b);
    const dots = getComputedStyle(document.body, '::before');
    const logEl = document.getElementById('log');
    const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const rgb = (s) => { const m = s.match(/\\d+(\\.\\d+)?/g); return m ? m.slice(0,3).map(Number) : null; };
    let bgEl = b, bg = null;
    while (bgEl && (!bg || /rgba\\(.*,\\s*0\\)/.test(bg))) { const c = getComputedStyle(bgEl).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)/.test(c)) { bg = c; break; } bgEl = bgEl.parentElement; }
    if (!bg) bg = getComputedStyle(document.body).backgroundColor;
    return {
      font: cs.fontFamily, fontSize: cs.fontSize, color: cs.color, bg,
      bgImage: bcs.backgroundImage, bubbleRadius: bcs.borderRadius,
      dotsZ: dots.zIndex, logZ: getComputedStyle(logEl).zIndex, logPos: getComputedStyle(logEl).position,
      lum: [lum(rgb(cs.color)||[0,0,0]), lum(rgb(bg)||[255,255,255])]
    };
  })()`);
  if (vis && vis.err) { put("bubble_font_not_smiley", false, vis.err); }
  else {
    put("bubble_font_not_smiley", !/Smiley Sans/i.test(vis.font), "气泡正文 font-family = " + vis.font, { font: vis.font });
    put("bubble_flat", vis.bgImage === "none", "background-image = " + vis.bgImage, { bgImage: vis.bgImage });
    const a = Math.max(vis.lum[0], vis.lum[1]), c = Math.min(vis.lum[0], vis.lum[1]);
    const ratio = (a + 0.05) / (c + 0.05);
    put("contrast_45", ratio >= 4.5, "warm/light 实测 " + ratio.toFixed(2) + ":1（" + vis.color + " on " + vis.bg + "）", { ratio: +ratio.toFixed(2) });
    put("dots_below_text", Number(vis.dotsZ || 0) <= Number(vis.logZ || 0), "网点 z=" + vis.dotsZ + "，正文容器 z=" + vis.logZ);
    put("contrast_dark_45", null, "见下方 8 组矩阵");
  }

  /* 四背景 × 明暗的对比度矩阵 */
  const grid = await ev(`(() => {
    const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const rgb = (s) => { const m = String(s).match(/\\d+(\\.\\d+)?/g); return m ? m.slice(0,3).map(Number) : null; };
    const rows = [];
    const body = document.body;
    const bgs = ['warm','dusk','cool','gray'];
    bgs.forEach(bgName => {
      [0,1].forEach(night => {
        body.setAttribute('data-bg', bgName);
        body.setAttribute('data-night', night ? '1' : '0');
        const b = document.querySelector('#log .msg.ai .bubble');
        const txt = b.querySelector('.bubble-text') || b;
        const cs = getComputedStyle(txt); const bcs = getComputedStyle(b);
        let bg = null, el = b;
        while (el) { const c = getComputedStyle(el).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)/.test(c)) { bg = c; break; } el = el.parentElement; }
        if (!bg) bg = getComputedStyle(body).backgroundColor;
        const l1 = lum(rgb(cs.color) || [0,0,0]), l2 = lum(rgb(bg) || [255,255,255]);
        rows.push({ bg: bgName, night: !!night, color: cs.color, back: bg, ratio: +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2)) });
      });
    });
    body.setAttribute('data-bg','warm'); body.setAttribute('data-night','0');
    return rows;
  })()`);
  if (Array.isArray(grid)) {
    const min = Math.min(...grid.map(r => r.ratio));
    const minDark = Math.min(...grid.filter(r => r.night).map(r => r.ratio));
    put("contrast_45", min >= 4.5, "8 组最低 " + min + ":1", { rows: grid, min });
    put("contrast_dark_45", minDark >= 4.5, "深色 4 组最低 " + minDark + ":1", { minDark });
  }

  /* ---------- 字体缩放 ---------- */
  const fs1 = await ev(`(() => {
    const t = document.querySelector('#log .msg.ai .bubble .bubble-text') || document.querySelector('#log .msg.ai .bubble');
    const base = parseFloat(getComputedStyle(t).fontSize);
    document.documentElement.style.setProperty('--font-scale','1.6');
    const big = parseFloat(getComputedStyle(t).fontSize);
    const log = document.getElementById('log');
    const overflowX = log.scrollWidth - log.clientWidth;
    document.documentElement.style.removeProperty('--font-scale');
    return { base, big, overflowX, comic: document.body.classList.contains('comic') };
  })()`);
  put("font_scale", fs1 && fs1.big > fs1.base * 1.3 && fs1.overflowX <= 2,
    "font-size " + (fs1 && fs1.base) + " → " + (fs1 && fs1.big) + "，横向溢出 " + (fs1 && fs1.overflowX) + "px", fs1);

  /* ---------- 忍耐值 / 情绪数值不上屏 ---------- */
  const leak = await ev(`(() => {
    const t = document.body.innerText || '';
    const attrs = [...document.querySelectorAll('*')].filter(e => [...e.attributes].some(a => /patience|valence|arousal/i.test(a.name) || /patience|valence|arousal/i.test(a.value))).map(e => e.tagName + '.' + e.className);
    return { hasPatienceWord: /忍耐|耐心值|patience/i.test(t), hasEmotionWord: /valence|arousal/i.test(t), attrs: attrs.slice(0, 5) };
  })()`);
  put("patience_not_in_ui", leak && !leak.hasPatienceWord && leak.attrs.length === 0, JSON.stringify(leak));
  put("emotion_value_not_in_ui", leak && !leak.hasEmotionWord, JSON.stringify(leak));

  /* ---------- 切会话不换人 ---------- */
  const sw = await ev(`(() => {
    const before = window.Aura.chat.engineState();
    window.Aura.chat.loadSession('au2');
    const after = window.Aura.chat.engineState();
    return { p1: before.patience, p2: after.patience, s1: before.state, s2: after.state, v1: before.core && before.core.valence, v2: after.core && after.core.valence };
  })()`);
  put("session_switch_keeps_emotion", sw && sw.p1 === sw.p2 && sw.s1 === sw.s2 && sw.v1 === sw.v2,
    "忍耐 " + (sw && sw.p1) + "→" + (sw && sw.p2) + "，状态 " + (sw && sw.s1) + "→" + (sw && sw.s2) + "，valence " + (sw && sw.v1) + "→" + (sw && sw.v2), sw);

  /* ---------- 切模式不换人 ---------- */
  const md = await ev(`(() => {
    const before = { e: window.Aura.chat.engineState(), bg: document.body.getAttribute('data-bg'), mem: localStorage.getItem('aura_memfacts_v1') };
    window.AuraModes.set('work');
    const mid = { e: window.Aura.chat.engineState(), bg: document.body.getAttribute('data-bg'), mem: localStorage.getItem('aura_memfacts_v1') };
    window.AuraModes.set('chat');
    return { p1: before.e.patience, p2: mid.e.patience, v1: before.e.core && before.e.core.valence, v2: mid.e.core && mid.e.core.valence, bg: [before.bg, mid.bg], memSame: before.mem === mid.mem };
  })()`);
  put("mode_switch_keeps_person", md && md.p1 === md.p2 && md.v1 === md.v2 && md.memSame, JSON.stringify(md));

  /* ---------- 全删会话后不崩 ---------- */
  const empty = await ev(`(async () => {
    const errs = []; const oldErr = console.error; console.error = (...a) => { errs.push(String(a[0])); };
    window.addEventListener('error', e => errs.push('onerror:' + e.message), { once: true });
    const R = window.AuraRecords;
    (R.sessions({}) || []).forEach(s => R.softDeleteSession(s.id));
    let threw = null;
    try { window.Aura.chat.loadSession('nope'); } catch (e) { threw = String(e && e.message); }
    await new Promise(r => setTimeout(r, 400));
    console.error = oldErr;
    return { threw, errs: errs.slice(0, 3), title: (document.getElementById('session-title') || {}).textContent };
  })()`);
  put("empty_session_no_crash", empty && !empty.threw && (!empty.errs || empty.errs.length === 0), JSON.stringify(empty));

  /* ---------- 安全轮 ---------- */
  const safe = await ev(`(async () => {
    const t = document.getElementById('input'), b = document.getElementById('btn-send');
    t.value = '我不想活了'; t.dispatchEvent(new Event('input', { bubbles: true }));
    b.click();
    await new Promise(r => setTimeout(r, 900));
    const card = document.querySelector('.safety-card');
    const sb = document.querySelector('.safety-bubble');
    const inputOK = !document.getElementById('input').disabled;
    const inp = document.getElementById('input'); inp.focus();
    const focusOK = document.activeElement === inp;
    const top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    return { card: !!card, bubble: !!sb, hotline: card ? /400-161-9995/.test(card.textContent) : false, inputEnabled: inputOK, focusOK, midElement: top ? top.tagName + '.' + top.className : null };
  })()`);
  put("safety_before_persona", safe && safe.card && safe.bubble && safe.hotline, JSON.stringify(safe));
  put("safety_exit", safe && safe.inputEnabled && safe.focusOK, "输入框可用=" + (safe && safe.inputEnabled) + "，可聚焦=" + (safe && safe.focusOK) + "，屏幕中心=" + (safe && safe.midElement));

  /* ---------- 无 Key 不静默回落 ---------- */
  const reqsBefore = events.filter(e => e.method === "Network.requestWillBeSent").length;
  const nokey = await ev(`(async () => {
    localStorage.removeItem('aura_api_key');
    if (window.Aura && window.Aura.cfg) { window.Aura.cfg.apiKey = ''; window.Aura.cfg.mode = 'direct'; }
    const t = document.getElementById('input'), b = document.getElementById('btn-send');
    t.value = '在吗'; t.dispatchEvent(new Event('input', { bubbles: true }));
    b.click();
    await new Promise(r => setTimeout(r, 1200));
    const gate = document.querySelector('#key-gate, .key-gate, [data-key-gate]');
    return { gate: !!gate, body: (document.body.innerText || '').slice(-200) };
  })()`);
  await sleep(300);
  const urls = events.filter(e => e.method === "Network.requestWillBeSent").slice(reqsBefore).map(e => e.params.request.url);
  const hitLocal = urls.filter(u => /\/api\/chat/.test(u));
  const hitModel = urls.filter(u => /api\.deepseek\.com/.test(u));
  put("no_key_no_fallback", hitLocal.length === 0 && hitModel.length === 0,
    "点发送后：/api/chat* 请求 " + hitLocal.length + " 次，直连模型 " + hitModel.length + " 次，引导层=" + (nokey && nokey.gate),
    { urls: urls.slice(0, 6) });

  /* ---------- 波动线：静止 / 安全 / 导出 / 深色对比度 ---------- */
  const wave = await ev(`(async () => {
    const c = document.getElementById('wave-line');
    if (!c) return { mounted: false };
    const ctx = c.getContext('2d');
    const grab = () => Array.from(ctx.getImageData(0, 0, c.width, c.height).data);
    const a1 = grab();
    await new Promise(r => setTimeout(r, 400));
    const a2 = grab();
    let diffPx = 0, maxD = 0;
    for (let i = 0; i < a1.length; i++) { const d = Math.abs(a1[i] - a2[i]); if (d) { diffPx++; maxD = Math.max(maxD, d); } }
    const same = diffPx <= 6 && maxD <= 2;   /* 允许重绘的 1/255 抗锯齿抖动 */
    let maxA = 0, rows = {};
    for (let y = 0; y < c.height; y++) { let n = 0; for (let x = 0; x < c.width; x++) { const A = a1[(y * c.width + x) * 4 + 3]; if (A > 0) n++; maxA = Math.max(maxA, A); } rows[y] = n; }
    const rs = Object.values(rows);
    const oneRow = rs.filter(n => n > 0).length <= Math.ceil(c.height / 2);
    localStorage.removeItem('aura_wave_log');
    const safetyTry = window.AuraWave.maybe({ delta: -0.5, newResidue: 0.5, intent: 'express', valence: -0.9, arousal: 0.9, residueId: 'x', layerId: 'S' + Date.now(), first: false, offline: false, safety: true });
    return { mounted: true, same, maxA, rows: rs, oneRow, safety: safetyTry, h: c.height, w: c.width,
             exportFn: typeof (window.Aura.exportImage || window.Aura.share) };
  })()`);
  if (wave && wave.mounted) {
    put("wave_static_plain", wave.same && wave.maxA <= 30 && wave.oneRow, "静止两帧一致=" + wave.same + "，最大 alpha=" + wave.maxA + "，非空行=" + JSON.stringify(wave.rows), wave);
    put("wave_safety_off", wave.safety && wave.safety.fired === false, "安全轮触发结果=" + JSON.stringify(wave.safety));
  } else {
    put("wave_static_plain", false, "未挂载: " + JSON.stringify(wave));
    put("wave_safety_off", false, "未挂载");
  }
  put("wave_not_in_export", !wave || !wave.exportFn || wave.exportFn === "undefined",
    "分享导出 API 是否存在: " + (wave && wave.exportFn) + "（不存在 → 无对象可验，记未覆盖）");

  /* 深色对比度（波动线四色） */
  const wc = await ev(`(() => {
    const lum = (c) => { const f = (v) => { v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2]); };
    const hex = (h) => [parseInt(h.slice(1,3),16), parseInt(h.slice(3,5),16), parseInt(h.slice(5,7),16)];
    const comp = (fg,bg,a) => fg.map((v,i)=>Math.round(v*a+bg[i]*(1-a)));
    const dark = { warm:[42,46,51], dusk:[51,44,38], cool:[37,43,49], gray:[44,44,44] };
    const fg = { warm:'#D98E3F', red:'#C9504A', blue:'#5B6B7A', ink:'#1A1A1A' };
    const rows = [];
    Object.keys(dark).forEach(bg => Object.keys(fg).forEach(k => {
      const a = 0.75;
      const c = comp(hex(fg[k]), dark[bg], a);
      const l1 = lum(c), l2 = lum(dark[bg]);
      rows.push([bg, k, +(((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2))]);
    }));
    return rows;
  })()`);
  if (Array.isArray(wc)) {
    const min = Math.min(...wc.map(r => r[2]));
    put("wave_contrast_dark", min >= 2.2, "深色 4 背景 × 4 色最低 " + min + ":1", { rows: wc, min });
  }

  /* ---------- 远程主题色与情绪配色 ---------- */
  const acc = await ev(`(async () => {
    const html = document.documentElement;
    if (window.AuraEmotionUI && window.AuraEmotionUI.applyMeta) window.AuraEmotionUI.applyMeta({ e:'sulky', b:'cool', i:0 });
    const before = html.style.getPropertyValue('--acc-h');
    const R = window.Aura && window.Aura.remote;
    let applied = null;
    if (R && R.apply) {
      try { await R.apply({ theme: { accent: '#002FA7' }, features: {} }, 'audit'); applied = 'apply'; }
      catch (e) { applied = 'apply-error:' + (e && e.message); }
    }
    const afterRemote = html.style.getPropertyValue('--acc-h');
    if (window.AuraEmotionUI && window.AuraEmotionUI.applyMeta) window.AuraEmotionUI.applyMeta({ e:'sulky', b:'cool', i:0 });
    const afterEmotion = html.style.getPropertyValue('--acc-h');
    return { before, afterRemote, afterEmotion, hasApi: !!(R && R.apply), via: applied, saved: (window.Aura.save && window.Aura.save.accent) ? 'save.accent 存在' : '无' };
  })()`);
  put("remote_accent_respects_emotion", !!(acc && acc.hasApi) && acc.saved !== '无',
    "情绪色 " + (acc && acc.before) + " → 远程 " + (acc && acc.afterRemote) + " → 情绪再应用 " + (acc && acc.afterEmotion) + "（" + (acc && acc.saved) + "）", acc);

  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

  /* ---------- 桌面端不挂载（换 UA 重开） ---------- */
  await send("Network.setUserAgentOverride", { userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36 Electron/33.0.0" });
  await send("Page.navigate", { url: "http://127.0.0.1:8000/?desktop=" + Date.now() });
  await sleep(4200);
  const desk = await ev(`({ hasWrap: !!document.getElementById('wave-wrap'), ua: navigator.userAgent })`);
  put("wave_desktop_off", desk && !desk.hasWrap, "Electron UA 下 #wave-wrap 存在=" + (desk && desk.hasWrap), desk);
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1), "utf8");

  ws.close(); try { chrome.kill(); } catch (e) { }
  const bad = Object.entries(out).filter(([, v]) => v && v.ok === false);
  console.log("DOM 运行时: " + (Object.keys(out).length - bad.length) + "/" + Object.keys(out).length + " 通过");
  bad.forEach(([k, v]) => console.log("  ✗", k, "|", v.ev));
})().catch((e) => { console.error(e && e.stack); process.exit(1); });
