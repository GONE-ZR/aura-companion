/* 实测当前装配下的 20 轮真实消耗（不改代码，只测量）
   跑法：node tools/measure_turns.js [轮数]
   输出：每轮 注入字数 / prompt tokens / 缓存命中 / 未命中 / 完成 / 首字 ms + 汇总
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

const E = require(path.join(ROOT, "static/js/engine.js"));
const P = require(path.join(ROOT, "static/js/prompt.js"));

const N = Number(process.argv[2] || 20);
const USER_LINES = [
  "在吗", "今天有点累", "刚下班", "外面下雨了", "你吃了吗",
  "我这两天睡不好", "工作有点烦", "领导又改需求", "我是不是很没用",
  "你别安慰我", "算了不说了", "你会不会觉得我烦", "我想安静一会儿",
  "陪我待会儿行吗", "我今天不想说话", "有点冷", "你冷不冷",
  "明天还要早起", "我先去洗澡", "晚安"
];

function build(state, history, userText) {
  const asm = P.assembleCached({
    engine: E, state, memories: [], history, now: Date.now(), lastGap: 3600000
  });
  const messages = [{ role: "system", content: asm.system }].concat(
    asm.messages.map((m) => ({ role: m.role, content: m.content }))
  );
  return { asm, payload: {
    model: "deepseek-flash",
    thinking: { type: "disabled" },
    messages,
    temperature: 1.25,
    max_tokens: 300,
    stream: true,
    stream_options: { include_usage: true }
  } };
}

async function turn(state, history, userText) {
  const { asm, payload } = build(state, history, userText);
  const t0 = Date.now();
  const res = await fetch("https://api.deepseek.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("http " + res.status + " " + (await res.text()).slice(0, 100));

  const reader = res.body.getReader();
  const dec = new TextDecoder("utf-8");
  let buf = "", first = null, text = "", usage = null;
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
      let o;
      try { o = JSON.parse(d); } catch (e) { continue; }
      if (o.usage) usage = o.usage;
      const delta = (o.choices && o.choices[0] && o.choices[0].delta && o.choices[0].delta.content) || "";
      if (delta && first === null) first = Date.now() - t0;
      text += delta;
    }
  }
  return { asm, text, usage, first, total: Date.now() - t0 };
}

(async () => {
  if (!KEY) { console.log("没有 .env 密钥，无法实测"); process.exit(1); }
  const state = E.createState(Date.now());
  let history = [];
  const rows = [];
  for (let i = 0; i < N; i++) {
    const u = USER_LINES[i % USER_LINES.length];
    const r = await turn(state, history, u);
    const uu = r.usage || {};
    rows.push({
      i: i + 1,
      chars: r.asm.chars,
      sys: r.asm.system.length,
      hist: r.asm.messages.length - 1,
      prompt: uu.prompt_tokens || 0,
      hit: uu.prompt_cache_hit_tokens || 0,
      miss: uu.prompt_cache_miss_tokens || 0,
      out: uu.completion_tokens || 0,
      first: r.first,
      reply: r.text.slice(0, 18)
    });
    /* 与 App 一致：历史里存"发出去的那份"（wire），前缀才稳定 */
    const wire = r.asm.messages[r.asm.messages.length - 1].content;
    history.push({ role: "user", text: wire });
    history.push({ role: "assistant", text: r.text || "嗯" });
  }

  console.log("轮 注入字 system字 历史条 prompt  命中  未命中 完成 首字ms");
  rows.forEach((r) => {
    console.log(
      String(r.i).padStart(2) + " " +
      String(r.chars).padStart(6) + " " +
      String(r.sys).padStart(7) + " " +
      String(r.hist).padStart(6) + " " +
      String(r.prompt).padStart(6) + " " +
      String(r.hit).padStart(5) + " " +
      String(r.miss).padStart(6) + " " +
      String(r.out).padStart(4) + " " +
      String(r.first || "-").padStart(6)
    );
  });

  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
  const avgChars = Math.round(sum("chars") / rows.length);
  const maxChars = Math.max(...rows.map((r) => r.chars));
  const prompt = sum("prompt"), hit = sum("hit"), miss = sum("miss"), out = sum("out");
  const afterFirst = rows.slice(1);
  const hitRate = prompt ? Math.round(hit / prompt * 1000) / 10 : 0;
  const firsts = rows.map((r) => r.first).filter(Boolean);
  const avgFirst = firsts.length ? Math.round(firsts.reduce((a, b) => a + b, 0) / firsts.length) : null;

  console.log("\n—— 汇总 ——");
  console.log("单轮注入：平均 " + avgChars + " 字 / 最长 " + maxChars + " 字");
  console.log("system 段：" + rows[0].sys + " 字（每轮是否相同：" +
    (rows.every((r) => r.sys === rows[0].sys) ? "是" : "否") + "）");
  console.log("prompt tokens 合计 " + prompt + "（命中 " + hit + " / 未命中 " + miss + "）");
  console.log("completion tokens 合计 " + out);
  console.log("缓存命中率（全部轮）：" + hitRate + "%");
  console.log("第 2~N 轮命中率：" + (function () {
    const p = afterFirst.reduce((a, r) => a + r.prompt, 0);
    const h = afterFirst.reduce((a, r) => a + r.hit, 0);
    return p ? Math.round(h / p * 1000) / 10 : 0;
  })() + "%");
  console.log("首字平均：" + avgFirst + " ms（" + firsts.length + " 次）");
  console.log("第 2~N 轮命中 tokens 是否 > 0：" +
    (afterFirst.some((r) => r.hit > 0) ? "是" : "否") + "（" +
    afterFirst.map((r) => r.hit).join(",") + "）");

  fs.writeFileSync(path.join(ROOT, "voice-lab", "..", "_measure_turns.json"),
    JSON.stringify({ rows, summary: { avgChars, maxChars, prompt, hit, miss, out, hitRate, avgFirst } }, null, 2));
})();
