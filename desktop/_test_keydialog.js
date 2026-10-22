/* 用 CDP 直接验证「设置 API 密钥」弹窗：填假密钥 → 点保存 → 看是否真的写进配置
   用法：node desktop/_test_keydialog.js 9333
*/
const PORT = process.argv[2] || "9333";
const BASE = `http://127.0.0.1:${PORT}`;
const fs = require("fs");
const os = require("os");
const path = require("path");

const CONFIG = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"),
  "aura-companion", "config.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", (e) => reject(new Error("ws error")));
    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const h = pending.get(m.id);
        pending.delete(m.id);
        m.error ? h.reject(new Error(JSON.stringify(m.error))) : h.resolve(m.result);
      }
    });
    const api = {
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

async function evaluate(c, expression) {
  const r = await c.send("Runtime.evaluate", {
    expression, awaitPromise: true, returnByValue: true, userGesture: true
  });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
  return r.result ? r.result.value : undefined;
}

(async () => {
  const list = await (await fetch(`${BASE}/json/list`)).json();
  console.log("目标数:", list.length);
  list.forEach((t) => console.log("  -", t.type, "|", t.title, "|", String(t.url).slice(0, 60)));

  const dlg = list.find((t) => /设置 API 密钥/.test(t.title) || String(t.url).startsWith("data:text/html"));
  if (!dlg) {
    console.log("❌ 没找到密钥弹窗");
    process.exit(1);
  }

  const c = await connect(dlg.webSocketDebuggerUrl);
  await c.send("Runtime.enable");

  console.log("桥是否就绪（window.__aura）:", await evaluate(c, "typeof window.__aura"));
  console.log("输入框存在:", await evaluate(c, "!!document.getElementById('k')"));

  await evaluate(c, "document.getElementById('k').value='sk-test1234567890abcdef'; 1");
  await evaluate(c, "document.getElementById('s').click(); 1");
  await sleep(1500);

  const exists = fs.existsSync(CONFIG);
  console.log("\n配置文件已写入:", exists, CONFIG);
  if (exists) {
    const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
    console.log("encKey 长度:", (cfg.encKey || "").length, "| plainKey:", !!cfg.plainKey);
  }
  console.log("弹窗是否已关闭:", await evaluate(c, "document.visibilityState").catch(() => "(已关闭)"));
  c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
