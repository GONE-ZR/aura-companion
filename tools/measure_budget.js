/* 对照实验：同样的装配，只把 MAX_CHARS 放大，看缓存命中率是否跳起来
   跑法：node tools/measure_budget.js 10 12000
   （不改生产代码：运行时替换源码里的常量再 eval）
*/
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const KEY = (function () {
  const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  const m = env.match(/^DEEPSEEK_API_KEY=(.+)$/m);
  return m ? m[1].trim() : "";
})();

const N = Number(process.argv[2] || 10);
const BUDGET = Number(process.argv[3] || 12000);

function loadWithBudget(file, budget) {
  let src = fs.readFileSync(path.join(ROOT, "static/js", file), "utf8");
  if (file === "prompt.js") src = src.replace(/var MAX_CHARS = \d+;/, "var MAX_CHARS = " + budget + ";");
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports, console,
    window: {}, self: {}, globalThis: {},
    Date, Math, JSON, Number, String, Array, Object, RegExp, isNaN, parseInt, parseFloat
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: file });
  return module.exports;
}

const E = loadWithBudget("engine.js", BUDGET);
const P = loadWithBudget("prompt.js", BUDGET);

const USER_LINES = ["在吗", "今天有点累", "刚下班", "外面下雨了", "你吃了吗", "我这两天睡不好",
  "工作有点烦", "领导又改需求", "我是不是很没用", "你别安慰我"];

async function turn(state, history, text) {
  const asm = P.assembleCached({
    engine: E, state, memories: [], history, now: Date.now(), lastGap: 3600000
  });
  const messages = [{ role: "system", content: asm.system }].concat(
    asm.messages.map((m) => ({ role: m.role, content: m.content }))
  );
  const t0 = Date.now();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({
      model: "deepseek-flash", thinking: { type: "disabled" }, messages,
      temperature: 1.25, max_tokens: 300, stream: true,
      stream_options: { include_usage: true }
    })
  });
  if (!res.ok) throw new Error("http " + res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", out = "", usage = null, first = null;
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop();
    for (const raw of lines) {
      const s = raw.trim();
      if (!s.startsWith("data:")) continue;
      const d = s.slice(5).trim();
      if (d === "[DONE]") continue;
      let o; try { o = JSON.parse(d); } catch (e) { continue; }
      if (o.usage) usage = o.usage;
      const delta = (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || "";
      if (delta && first === null) first = Date.now() - t0;
      out += delta;
    }
  }
  return { asm, out, usage, first };
}

(async () => {
  const state = E.createState(Date.now());
  let history = [];
  const rows = [];
  for (let i = 0; i < N; i++) {
    const u = USER_LINES[i % USER_LINES.length];
    const r = await turn(state, history, u);
    const uu = r.usage || {};
    rows.push({
      i: i + 1, chars: r.asm.chars, hist: r.asm.messages.length - 1,
      prompt: uu.prompt_tokens || 0, hit: uu.prompt_cache_hit_tokens || 0,
      miss: uu.prompt_cache_miss_tokens || 0, first: r.first
    });
    const wire = r.asm.messages[r.asm.messages.length - 1].content;
    history.push({ role: "user", text: wire });
    history.push({ role: "assistant", text: r.out || "嗯" });
  }
  console.log("预算=" + BUDGET + " 轮 注入字 历史条 prompt 命中 未命中 首字ms");
  rows.forEach((r) => console.log(
    String(r.i).padStart(2) + " " + String(r.chars).padStart(6) + " " +
    String(r.hist).padStart(6) + " " + String(r.prompt).padStart(6) + " " +
    String(r.hit).padStart(5) + " " + String(r.miss).padStart(6) + " " +
    String(r.first || "-").padStart(5)));
  const p = rows.reduce((a, r) => a + r.prompt, 0);
  const h = rows.reduce((a, r) => a + r.hit, 0);
  console.log("命中率：" + (p ? Math.round(h / p * 1000) / 10 : 0) + "%  注入平均 " +
    Math.round(rows.reduce((a, r) => a + r.chars, 0) / rows.length) + " 字");
})();
