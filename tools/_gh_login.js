/* ============================================================
   gh_login.js —— 用 Chrome 自己的自动填充完成 GitHub 登录
   （密码由浏览器填入并直接提交，全程不经过 Node，也不会打印）
   ============================================================ */
const fs = require("fs");

const BASE = "http://127.0.0.1:9222";

async function targets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const { resolve: rs, reject: rj } = pending.get(m.id);
        pending.delete(m.id);
        m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const ts = (await targets()).filter((t) => t.type === "page" && t.url.includes("github.com"));
  if (!ts.length) { console.log("ERR 没有 github 标签页"); process.exit(1); }
  const c = await connect(ts[0].webSocketDebuggerUrl);

  // 0. 把页面拉到前台（否则 Input 事件不会被处理）
  await c.send("Page.bringToFront").catch(() => { });
  await sleep(800);
  const foc = await c.send("Runtime.evaluate", {
    expression: "JSON.stringify({hasFocus:document.hasFocus(), vis:document.visibilityState})",
    returnByValue: true
  });
  console.log("页面焦点:", foc.result.value);

  // 1. 填用户名（用 Input.insertText，走真实输入事件）
  await c.send("Runtime.evaluate", { expression: "document.querySelector('#login_field').focus()" });
  await c.send("Input.insertText", { text: "2774889909@qq.com" });
  await sleep(400);

  // 2. 聚焦密码框 → Chrome 自动填充下拉 → 方向键 + 回车选中
  await c.send("Runtime.evaluate", { expression: "document.querySelector('#password').focus()" });
  await sleep(700);
  for (const vk of ["ArrowDown", "Enter"]) {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: vk, code: vk, windowsVirtualKeyCode: vk === "ArrowDown" ? 40 : 13 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: vk, code: vk, windowsVirtualKeyCode: vk === "ArrowDown" ? 40 : 13 });
    await sleep(300);
  }
  await sleep(600);

  const filled = await c.send("Runtime.evaluate", {
    expression: "JSON.stringify({user:(document.querySelector('#login_field')||{}).value||'', pwLen:((document.querySelector('#password')||{}).value||'').length})",
    returnByValue: true
  });
  console.log("填充结果:", filled.result.value);

  const info = JSON.parse(filled.result.value);
  if (!info.pwLen) {
    console.log("自动填充没生效，需要手动处理");
    c.close();
    process.exit(2);
  }

  // 3. 提交
  await c.send("Runtime.evaluate", {
    expression: "(()=>{const f=document.querySelector('form'); if(f){f.submit(); return 'submitted'} const b=document.querySelector('input[type=submit]'); if(b){b.click(); return 'clicked'} return 'no-form'})()",
    returnByValue: true
  });
  await sleep(6000);
  const after = await c.send("Runtime.evaluate", {
    expression: "JSON.stringify({url:location.href,title:document.title,login:(document.querySelector('meta[name=user-login]')||{}).content||null,twofa: /two-factor|2fa|device-verification/i.test(document.body.innerText)})",
    returnByValue: true
  });
  console.log("登录后:", after.result.value);
  c.close();
}

main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
