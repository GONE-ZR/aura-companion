/* ============================================================
   cdp.js —— Chrome DevTools Protocol 轻量客户端（Node 24 自带 WebSocket）
   用法：
     node tools/cdp.js list
     node tools/cdp.js eval "<js 表达式>"
     node tools/cdp.js open "<url>"
     node tools/cdp.js shot <out.png>
   ============================================================ */
const fs = require("fs");
const PORT = process.env.CDP_PORT || 9222;
const BASE = `http://127.0.0.1:${PORT}`;

async function targets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const events = [];
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", (e) => reject(new Error("ws error")));
    ws.addEventListener("message", (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.id && pending.has(msg.id)) {
        const { resolve: rs, reject: rj } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rj(new Error(JSON.stringify(msg.error)));
        else rs(msg.result);
      } else if (msg.method) {
        events.push(msg);
      }
    });
    const api = {
      events,
      send(method, params = {}) {
        return new Promise((rs, rj) => {
          const mid = ++id;
          pending.set(mid, { resolve: rs, reject: rj });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { try { ws.close(); } catch (e) { } }
    };
  });
}

async function pageTarget() {
  const ts = await targets();
  const pages = ts.filter((t) => t.type === "page");
  if (!pages.length) throw new Error("没有可用的页面标签");
  // 优先挑非新标签页
  return pages.find((t) => !/^about:(blank|newtab)$/.test(t.url)) || pages[0];
}

async function evalJs(expr, targetWs) {
  const wsUrl = targetWs || (await pageTarget()).webSocketDebuggerUrl;
  const c = await connect(wsUrl);
  const res = await c.send("Runtime.evaluate", {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  c.close();
  if (res.exceptionDetails) {
    throw new Error("JS 异常: " + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
  }
  return res.result ? res.result.value : undefined;
}

(async () => {
  const cmd = process.argv[2];
  if (cmd === "list") {
    const ts = await targets();
    ts.forEach((t) => console.log(`[${t.type}] ${t.title}  ${t.url}`));
    return;
  }
  if (cmd === "eval") {
    const out = await evalJs(process.argv[3]);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
    return;
  }
  if (cmd === "open") {
    const url = process.argv[3];
    const t = await pageTarget();
    const c = await connect(t.webSocketDebuggerUrl);
    await c.send("Page.navigate", { url });
    c.close();
    console.log("navigated:", url);
    return;
  }
  if (cmd === "shot") {
    const out = process.argv[3] || "cdp-shot.png";
    const t = await pageTarget();
    const c = await connect(t.webSocketDebuggerUrl);
    const { data } = await c.send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(out, Buffer.from(data, "base64"));
    c.close();
    console.log("saved:", out);
    return;
  }
  console.log("未知命令");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
