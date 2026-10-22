/* 调试：看模型原始输出（首行到底是不是标签） */
const E = require("../static/js/engine.js");
const P = require("../static/js/prompt.js");

(async () => {
  const st = E.createState(Date.now());
  const asm = P.assembleSplit({
    engine: E, state: st, memories: [],
    history: [{ role: "user", text: "在吗" }],
    now: Date.now(), lastGap: 3600000
  });
  const r = await fetch("http://127.0.0.1:8000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt: asm.system, messages: asm.messages, temperature: 0.7, max_tokens: 400 })
  });
  const d = await r.json();
  console.log("=== 服务返回的键 ===", Object.keys(d || {}).join(","));
  console.log(JSON.stringify(d).slice(0, 400));
  const c = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || d.text || "";
  console.log("\n=== 原始输出 ===");
  console.log(JSON.stringify(c).slice(0, 500));
  console.log("\n=== 首行 ===");
  console.log(JSON.stringify(c.split("\n")[0]));
  console.log("\n=== 最后一轮 user 消息末尾 200 字 ===");
  console.log(JSON.stringify(asm.messages[asm.messages.length - 1].content.slice(-200)));
})();
