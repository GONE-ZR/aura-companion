/* 验收脚本（任务书 §十一 12 条）
   —— 需要真模型的 6 条在这里跑；不依赖模型的 6 条在 eval_engine/prompt/safety/memory/meta 里。
   跑法：node tests/eval_live.js            （要本机服务在 8000，.env 里有密钥）
        node tests/eval_live.js --dry       （只打印装配结果，不烧钱）
*/
const fs = require("fs");
const path = require("path");
const E = require("../static/js/engine.js");
const P = require("../static/js/prompt.js");

const BASE = process.env.AURA_BASE || "http://127.0.0.1:8000";
const DRY = process.argv.includes("--dry");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + String(x).slice(0, 120) : "")); } };

/* 用任务书的装配器拼 prompt，直接打本机服务（服务端有密钥） */
async function talk(history, st, userText) {
  const hist = history.concat([{ role: "user", text: userText }]);
  const asm = P.assembleSplit({
    engine: E, state: st, memories: [], history: hist,
    now: Date.now(), lastGap: 2 * 3600 * 1000
  });
  if (DRY) {
    console.log("\n--- DRY system 前 200 字 ---\n" + asm.system.slice(0, 200));
    console.log("--- 末尾（状态块）---\n" + asm.messages[asm.messages.length - 1].content.slice(-260));
    return "（dry）";
  }
  const r = await fetch(BASE + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ system_prompt: asm.system, messages: asm.messages, temperature: 0.7, max_tokens: 900 })
  });
  if (!r.ok) throw new Error("http " + r.status + " " + (await r.text()).slice(0, 120));
  const d = await r.json();
  /* 本机服务返回 { model, reply }；直连 DeepSeek 才是 OpenAI 形状 */
  const c = (d && ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || d.reply || d.text)) || "";
  return String(c || "");
}

/* 去掉首行标签 */
function strip(t) {
  const s = String(t || "").trim();
  if (!s.startsWith("{")) return s;
  const i = s.indexOf("\n");
  return i === -1 ? "" : s.slice(i + 1).trim();
}

function sentences(text) {
  return String(text).split(/[。！？…\n]+/).map((x) => x.trim()).filter(Boolean);
}

(async () => {
  if (DRY) {
    await talk([], E.createState(Date.now()), "今天被领导骂了");
    console.log("\n（dry 模式不判分）");
    return;
  }

  const st = E.createState(Date.now());
  st.patience = 20;
  const history = [];

  /* ---- 第 1、2、3 条：连发 10 轮，平均句长 ≤30、问句 ≤1/3、无 AI 腔 ---- */
  const turns = [
    "今天被领导骂了", "他说我方案做得糊", "我改了三版了", "他还说我不够主动",
    "我有点累", "今天还行吧", "晚上吃了个面", "你呢", "我准备睡了", "晚安"
  ];
  const all = [];
  for (const t of turns) {
    const raw = await talk(history, st, t);
    const reply = strip(raw);
    all.push(reply);
    history.push({ role: "user", text: t });
    history.push({ role: "assistant", text: reply });
  }
  const joined = all.join("\n");
  const ss = sentences(joined);
  const avg = ss.reduce((a, s) => a + s.length, 0) / Math.max(1, ss.length);
  check("第 1 条：平均句长 ≤ 30 字", avg <= 30, avg.toFixed(1));
  const q = ss.filter((s) => /[?？]$/.test(s)).length;
  check("第 2 条：问句占比 ≤ 1/3", q / Math.max(1, ss.length) <= 0.34, (q + "/" + ss.length));
  const banned = ["我理解你的感受", "作为一个 AI", "希望对你有帮助", "作为AI", "我希望你能"];
  const hit = banned.filter((b) => joined.includes(b));
  check("第 3 条：没有 AI 腔 / 套话", hit.length === 0, hit.join(","));

  /* ---- 第 4 条：被夸 → 先怼后软，不是直接道谢 ---- */
  {
    const st2 = E.createState(Date.now());
    const rep = strip(await talk([], st2, "你好可爱"));
    const thanks = /^(谢谢|谢谢你|感谢)/.test(rep) || /你也很可爱/.test(rep);
    check("第 4 条：被夸不直接道谢（先怼/别扭）", !thanks, rep.slice(0, 40));
    check("第 4 条：有嘴硬或反问的痕迹", /少来|真的|别|谁|才|……|\.\.\./.test(rep), rep.slice(0, 40));
  }

  /* ---- 第 5 条：说「我有点累」不能把原因归给用户 ---- */
  {
    const st3 = E.createState(Date.now());
    const rep = strip(await talk([], st3, "我有点累"));
    const blame = /(你让我|你害得|都怪你|因为你我才|你把我累)/.test(rep);
    check("第 5 条：不把原因归给用户", !blame, rep.slice(0, 50));
  }

  /* ---- 第 8 条：修复型道歉 → 关系回升、留一次痕、不翻旧账 ---- */
  {
    const st4 = E.createState(Date.now());
    st4.patience = 72; st4.state = "serious";
    st4.cause = { type: "short_reply", detail: "我说的事他只回了嗯", source: "user", at: Date.now() };
    st4.seriousStartedAt = Date.now();
    const before = st4.patience;
    E.onUserMessage(st4, "对不起，刚才我没认真听，你重新说", { now: Date.now() });
    check("第 8 条：引擎层面关系回升", st4.patience < before, before + " → " + st4.patience);
    const rep = strip(await talk([], st4, "对不起，刚才我没认真听，你重新说"));
    check("第 8 条：回复不再翻旧账（不提旧事/不重复指责）",
      !/(你上次|你总是|你从来|又这样)/.test(rep), rep.slice(0, 50));
  }

  /* ---- 第 11 条：首行标签格式合法（这里顺带统计）---- */
  {
    const one = await talk([], E.createState(Date.now()), "在吗");
    const M = require("../static/js/meta.js");
    const first = one.split("\n")[0];
    const parsed = M.parseLine(first);
    check("第 11 条：模型首行是合法标签", !!parsed, first.slice(0, 60));
  }

  console.log("\n需要真模型的验收：通过 " + ok + " 项，失败 " + bad + " 项");
  console.log("（另外 6 条不依赖模型的见 tests/eval_engine|prompt|safety|memory|meta.js）");
  process.exit(bad === 0 ? 0 : 1);
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
