/* ============================================================
   gh_new_repo.js —— 在 GitHub 上建仓（已登录会话，走真实表单）
   ============================================================ */
const BASE = "http://127.0.0.1:9222";
const REPO = process.argv[2] || "aura-companion";

async function targets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.addEventListener("open", () => resolve(api));
    ws.addEventListener("error", () => reject(new Error("ws error")));
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const { resolve: rs, reject: rj } = pending.get(m.id); pending.delete(m.id);
        m.error ? rj(new Error(JSON.stringify(m.error))) : rs(m.result);
      }
    });
    const api = {
      send(method, params = {}) {
        return new Promise((rs, rj) => {
          const mid = ++id; pending.set(mid, { resolve: rs, reject: rj });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { try { ws.close(); } catch (e) { } }
    };
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const evalJs = async (c, expr) => {
  const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
};

(async () => {
  const ts = (await targets()).filter((t) => t.type === "page" && t.url.includes("github.com"));
  if (!ts.length) { console.log("ERR 没有 github 标签页"); process.exit(1); }
  const c = await connect(ts[0].webSocketDebuggerUrl);
  await c.send("Page.bringToFront").catch(() => { });

  // 1) 确认登录身份
  await c.send("Page.navigate", { url: "https://github.com/new" });
  await sleep(4000);
  const who = await evalJs(c, "(document.querySelector('meta[name=user-login]')||{}).content || document.body.innerText.slice(0,80)");
  console.log("当前登录:", who);

  // 2) 查重（规格 24.1：已存在就停，绝不覆盖）
  const exists = await evalJs(c, `fetch('/${'YunYueSama'}/${REPO}').then(r=>r.status)`);
  console.log("目标仓库存在性检查 HTTP:", exists);
  if (exists === 200) { console.log("仓库已存在，停止（不覆盖）"); c.close(); process.exit(3); }

  // 3) 填名字
  await evalJs(c, `(()=>{
    const el=document.querySelector('#repository-name-input');
    const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    setter.call(el, ${JSON.stringify(REPO)});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    el.dispatchEvent(new Event('change',{bubbles:true}));
    return el.value;
  })()`);
  await sleep(1200);

  // 4) 可见性 = Public
  const vis = await evalJs(c, `(()=>{
    const pub=[...document.querySelectorAll('input[type=radio]')].find(r=>/public/i.test(r.value||'')||/public/i.test((r.closest('label')||{}).textContent||''));
    if(pub){pub.click(); return 'clicked '+pub.value;}
    return 'no-radio';
  })()`);
  console.log("可见性:", vis);
  await sleep(800);

  // 5) 点 Create repository
  const clicked = await evalJs(c, `(()=>{
    const btns=[...document.querySelectorAll('button,input[type=submit]')];
    const b=btns.find(x=>/create repository/i.test((x.value||x.textContent||'').trim()));
    if(!b) return 'not-found';
    b.click(); return 'clicked';
  })()`);
  console.log("提交:", clicked);

  await sleep(7000);
  const after = await evalJs(c, "JSON.stringify({url:location.href,title:document.title,err:(document.querySelector('.flash-error,.flash-danger')||{}).textContent||null})");
  console.log("结果:", after);
  c.close();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
