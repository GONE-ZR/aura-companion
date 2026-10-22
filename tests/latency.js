/* 第四篇/本轮 Q2：打印主对话请求参数（隐去 Key）+ 实测首字延迟 5 次
   跑法：node tests/latency.js            （真调 5 次）
        node tests/latency.js --print     （只打印参数，不花钱）
*/
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const KEY = (function () {
  try {
    const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m);
    return m ? m[1].trim() : "";
  } catch (e) { return ""; }
})();

const E = require("../static/js/engine.js");
const P = require("../static/js/prompt.js");

const MODEL = { id: "deepseek-flash", temperature: 1.25, max_tokens: 300 };

function buildPayload(userText) {
  const st = E.createState(Date.now());
  const asm = P.assembleCached({
    engine: E, state: st, memories: [], history: [{ role: "user", text: userText }],
    now: Date.now(), lastGap: 3600000
  });
  const msgs = [{ role: "system", content: asm.system }].concat(
    asm.messages.map((m) => ({ role: m.role, content: m.content })));
  return {
    model: MODEL.id,
    thinking: { type: "disabled" },
    messages: msgs,
    temperature: MODEL.temperature,
    max_tokens: MODEL.max_tokens,
    stream: true,
    stream_options: { include_usage: true }
  };
}

function redact(p) {
  const c = JSON.parse(JSON.stringify(p));
  c.messages = c.messages.map((m) => ({
    role: m.role,
    content: m.content.length > 120 ? m.content.slice(0, 120) + " …(" + m.content.length + " 字)" : m.content
  }));
  return c;
}

async function oneTurn(text) {
  const payload = buildPayload(text);
  const t0 = Date.now();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + KEY },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("http " + res.status + " " + (await res.text()).slice(0, 120));
  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let buf = "", first = null, total = "";
  while (true) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const line of lines) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const d = s.slice(5).trim();
      if (d === "[DONE]") continue;
      let o; try { o = JSON.parse(d); } catch (e) { continue; }
      const delta = (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || "";
      if (delta && first === null) first = Date.now() - t0;
      total += delta;
    }
  }
  return { first, total: Date.now() - t0, chars: total.length };
}

(async () => {
  const payload = buildPayload("在吗");
  console.log("=== 主对话请求参数（Key 已隐去）===");
  console.log(JSON.stringify(redact(payload), null, 2).slice(0, 1600));
  console.log("\nthinking =", JSON.stringify(payload.thinking));
  console.log("temperature =", payload.temperature, "| max_tokens =", payload.max_tokens);
  console.log("stream_options =", JSON.stringify(payload.stream_options));

  if (process.argv.includes("--print")) return;
  if (!KEY) { console.log("\n（.env 里没有密钥，跳过实测）"); return; }

  console.log("\n=== 首字延迟实测 5 次 ===");
  const firsts = [];
  for (let i = 0; i < 5; i++) {
    try {
      const r = await oneTurn("在吗");
      firsts.push(r.first);
      console.log(`  #${i + 1}  首字 ${r.first} ms · 全程 ${r.total} ms · ${r.chars} 字`);
    } catch (e) {
      console.log(`  #${i + 1}  失败：${e.message}`);
    }
  }
  if (firsts.length) {
    const avg = Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length);
    console.log("\n平均首字：" + avg + " ms（" + firsts.join(" / ") + "）");
    console.log(avg <= 1500 ? "✅ ≤1.5s" : "⚠️ >1.5s，需要定位是网络还是模型");
  }
})();
