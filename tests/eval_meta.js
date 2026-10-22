/* 输出协议验收（任务书 §六 + §十一 第 11 条）
   跑法：node tests/eval_meta.js
*/
const M = require("../static/js/meta.js");

let ok = 0, bad = 0;
const check = (n, c, x) => { if (c) { ok++; console.log("  OK   " + n); } else { bad++; console.log("  FAIL " + n + (x ? "  → " + x : "")); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  /* 1. 正常解析 */
  {
    const m = M.parseLine('{"e":"sulky","b":"warm","i":1}');
    check("正常标签解析", m && m.e === "sulky" && m.b === "warm" && m.i === 1, JSON.stringify(m));
    check("代码块围栏也能解析", M.parseLine('```json\n{"e":"soft","b":"dusk","i":2}\n```').e === "soft");
    check("多余字段忽略", M.parseLine('{"e":"calm","b":"warm","i":0,"x":1}').e === "calm");
  }

  /* 2. 非法键降级 */
  {
    const m = M.parseLine('{"e":"angry","b":"warm","i":1}');
    check("非法表情键 → 降级 calm", m && m.e === "calm" && m.degraded === true, JSON.stringify(m));
    const b = M.parseLine('{"e":"soft","b":"purple","i":1}');
    check("非法背景键 → 降级 warm", b && b.b === "warm" && b.degraded === true, JSON.stringify(b));
    check("两个都不认识 → 视为没有标签", M.parseLine('{"e":"x","b":"y","i":1}') === null);
    check("强度越界被钳到 0..2", M.parseLine('{"e":"calm","b":"warm","i":9}').i === 2);
    check("首行不是 { → 视为没有标签", M.parseLine("今天有点累") === null);
    check("坏 JSON → null（不抛异常）", M.parseLine('{"e":"calm",') === null);
  }

  /* 3. 流式：先 meta 后正文 */
  {
    const events = [];
    const st = M.createMetaStream({
      onMeta: (m) => events.push(["meta", m.e]),
      onDelta: (t) => events.push(["delta", t]),
      onDone: () => events.push(["done"])
    });
    st.push('{"e":"sul');
    st.push('ky","b":"dusk","i":2}\n');
    st.push("行啊，你挺会说的。");
    st.end();
    check("meta 先于正文到达", events[0][0] === "meta" && events[0][1] === "sulky", JSON.stringify(events));
    check("正文完整", events.some((e) => e[0] === "delta" && e[1].includes("你挺会说的")));
    check("结束事件到达", events[events.length - 1][0] === "done");
    check("正文里不残留 JSON", !events.filter((e) => e[0] === "delta").some((e) => e[1].includes("sulky")));
  }

  /* 4. 首行不是标签 → 直接当正文，不报错 */
  {
    const events = [];
    const st = M.createMetaStream({
      onMeta: (m) => events.push(["meta", m.e, !!m.fallback]),
      onDelta: (t) => events.push(["delta", t])
    });
    st.push("今天不想说话。");
    st.end();
    check("无标签时用兜底 calm", events[0][0] === "meta" && events[0][1] === "calm" && events[0][2] === true);
    check("正文照常输出", events.some((e) => e[0] === "delta" && e[1].includes("不想说话")));
  }

  /* 5. 3 秒兜底（第 11 条：不许阻塞对话） */
  {
    const events = [];
    const st = M.createMetaStream({
      timeoutMs: 120,
      onMeta: (m) => events.push(["meta", m.e, !!m.fallback]),
      onDelta: (t) => events.push(["delta", t])
    });
    st.push('{"e":"soft"');
    await sleep(260);
    check("3 秒（这里压到 120ms）内没等到完整标签 → 兜底", events[0][0] === "meta" && events[0][2] === true, JSON.stringify(events));
    st.end();
  }

  /* 6. 拆气泡（>28 字或换行） */
  {
    const one = M.splitBubbles("短句。");
    check("短句不拆", one.length === 1, JSON.stringify(one));
    const multi = M.splitBubbles("第一句。\n第二句。");
    check("按换行拆", multi.length === 2, JSON.stringify(multi));
    const long = "我今天加班到八点，回家路上堵了很久很久，然后做饭的时候还把锅烧糊了，心情不太好。";
    const parts = M.splitBubbles(long);
    check("超长句被拆开", parts.length >= 2, JSON.stringify(parts));
    check("每段不太长（≤ 34 字）", parts.every((p) => p.length <= 34), JSON.stringify(parts.map((p) => p.length)));
    check("拆完不丢字", parts.join("").replace(/\s/g, "").length >= long.replace(/\s/g, "").length - 4,
      String(parts.join("").length) + " vs " + long.length);
  }

  console.log("\n输出协议验收：通过 " + ok + " 项，失败 " + bad + " 项");
  process.exit(bad === 0 ? 0 : 1);
})();
