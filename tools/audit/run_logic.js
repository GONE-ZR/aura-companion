/* 运行时核查（纯逻辑，不需要浏览器）
   输出: tools/audit/out-logic.json
*/
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "../..");
const out = {};

function put(k, ok, ev, detail) { out[k] = { ok: !!ok, ev: ev, detail: detail === undefined ? null : detail }; }

/* ---------- A002 / A003 外显映射 ---------- */
try {
  const em = require(path.join(ROOT, "static/js/emotion-core.js"));
  const hi = { valence: 0.9, arousal: 0.9, bond: 0.9, target: "self" };
  const s90 = em.mapState(hi, 90);
  const s60 = em.mapState(hi, 60);
  const s89 = em.mapState(hi, 89);
  put("blank_at_90", s90 === "blank", "patience=90 & valence=+0.9 → " + s90, { s90, s60, s89 });
  put("serious_at_60", s60 === "serious" && s89 === "serious", "patience=60 → " + s60 + "，=89 → " + s89, { s60, s89 });
} catch (e) { put("blank_at_90", false, "模块加载失败: " + e.message); put("serious_at_60", false, e.message); }

/* ---------- A048 / A049 / A005 装配 ---------- */
try {
  const P = require(path.join(ROOT, "static/js/prompt.js"));
  const hist = [
    { role: "user", text: "A-用户原话" },
    { role: "ai", text: "B-她的回复" },
    { role: "user", text: "C-最后一句" }
  ];
  const mk = (now, patience) => P.assembleCached({
    history: hist, state: { patience: patience, state: "calm" }, now: now,
    memories: [{ text: "喜欢下雨天", confidence: 0.9, type: "preference" }],
    summary: "更早聊过作业", hotline: "400-161-9995"
  });
  const a = mk(1700000000000, 20), b = mk(1900000000000, 77);
  const msgs = a.messages;
  const orderOk = msgs.length === 4 && msgs[0].content === "A-用户原话" && msgs[1].content === "B-她的回复" &&
    msgs[3].content === "C-最后一句" && /【你记得的事】/.test(msgs[2].content) && msgs[3].role === "user";
  put("assembly_order", orderOk, "messages = [" + msgs.map(m => m.role + ":" + m.content.slice(0, 10)).join(" | ") + "]", { n: msgs.length });
  const sysStable = a.system === b.system;
  put("system_stable", sysStable, "两次不同时间/忍耐值 → system 字节" + (sysStable ? "完全一致" : "不一致"), { len: a.system.length });
  /* 真正判据：两次不同时间/忍耐值 → system 逐字节相同（静态）；且无未替换占位符 */
  const sysHasNumber = /\{\{|patience|\{\{现在\}\}/.test(a.system);
  put("system_static", sysStable && !sysHasNumber,
    "system 静态=" + sysStable + "，未替换占位符=" + sysHasNumber + "（含固定示例 08:00，属静态文案）",
    { hasPlaceholder: sysHasNumber, stable: sysStable });
} catch (e) { put("assembly_order", false, "prompt 模块失败: " + e.message); put("system_stable", false, e.message); put("system_static", false, e.message); }

/* ---------- A051 max_tokens ---------- */
try {
  const src = fs.readFileSync(path.join(ROOT, "static/js/chat.js"), "utf8");
  const vals = [...src.matchAll(/max_tokens\s*:\s*(\d+)/g)].map(m => Number(m[1]));
  const main = Math.max(...vals);
  put("max_tokens_ok", main >= 1200, "chat.js 里 max_tokens = " + JSON.stringify(vals), { values: vals });
} catch (e) { put("max_tokens_ok", false, e.message); }

/* ---------- A064 语音三层：整体替换 vs 加权平均 ---------- */
try {
  const V = require(path.join(ROOT, "static/js/voice-layer.js"));
  const p1 = V.paramsFor({ core: { valence: 0.6, arousal: 0.6, bond: 0.8 }, event: "被夸", turn: 9 });
  const p2 = V.paramsFor({ core: { valence: -0.6, arousal: 0.2, bond: 0.3 }, turn: 9 });
  const src = fs.readFileSync(path.join(ROOT, "static/js/voice-layer.js"), "utf8");
  const blended = /\(t\.rate \+ rate\) \/ 2|\(t\.pitch \+ pitch\) \/ 2/.test(src);
  put("voice_layer_replace", !blended, blended
    ? "默认「热情度」档仍是 (档位+公式)/2 的加权平均（voice-layer.js:143-144），仅情绪覆盖/撒娇是整体替换"
    : "全部路径整体替换", { p1: p1.layer, p2: p2.layer });
  out.voice_layer_replace.detail = { layer1: p1.layer, rate1: p1.rate, layer2: p2.layer, rate2: p2.rate, blended };
} catch (e) { put("voice_layer_replace", false, e.message); }

/* ---------- A080 波动线振幅 ---------- */
try {
  const W = require(path.join(ROOT, "static/js/wave.js"));
  const xs = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 0.95, 1].map(i => [+i.toFixed(2), +W._amplitude(i, false).toFixed(3)]);
  const c = +W._amplitude(1, true).toFixed(3);
  const max = Math.max(...xs.map(x => x[1]), c);
  put("wave_amp_le2", max <= 2, "10 组 + conceal 最大值 = " + max, { xs, conceal: c, max });
} catch (e) { put("wave_amp_le2", false, e.message); }

fs.writeFileSync(path.join(__dirname, "out-logic.json"), JSON.stringify(out, null, 1), "utf8");
const bad = Object.entries(out).filter(([, v]) => !v.ok);
console.log("逻辑运行时: " + (Object.keys(out).length - bad.length) + "/" + Object.keys(out).length + " 通过");
bad.forEach(([k, v]) => console.log("  ✗", k, "|", v.ev));
