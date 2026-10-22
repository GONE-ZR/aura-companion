/* ============================================================
   gh_make_token.js —— 生成 classic PAT（repo 权限），并把令牌交回给调用方
   ============================================================ */
const BASE = "http://127.0.0.1:9222";
const NOTE = process.argv[2] || "aura-push";

async function targets() { return (await fetch(`${BASE}/json/list`)).json(); }
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
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
async function evalJs(c, expr) {
  const r = await c.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception));
  return r.result ? r.result.value : undefined;
}
const setReactValue = (sel, val) => `(()=>{
  const el=document.querySelector(${JSON.stringify(sel)});
  if(!el) return 'no-el';
  const proto = el.tagName==='TEXTAREA'?window.HTMLTextAreaElement.prototype:window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto,'value').set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
  return el.value;
})()`;

(async () => {
  const ts = (await targets()).filter((t) => t.type === "page" && t.url.includes("github.com"));
  const c = await connect(ts[0].webSocketDebuggerUrl);
  await c.send("Page.bringToFront").catch(() => { });
  await c.send("Page.navigate", { url: "https://github.com/settings/tokens/new" });
  await sleep(5000);

  console.log("note:", await evalJs(c, setReactValue("#oauth_access_description", NOTE)));

  // 勾 repo 权限
  const scope = await evalJs(c, `(()=>{
    const boxes=[...document.querySelectorAll('input[name="oauth_access[scopes][]"]')];
    const repo=boxes.find(b=>b.value==='repo');
    if(!repo) return 'no-repo-scope: '+boxes.map(b=>b.value).join(',');
    if(!repo.checked){repo.click();}
    return 'repo='+repo.checked;
  })()`);
  console.log("权限:", scope);
  await sleep(600);

  // 有效期：默认 90 天，够用；也可改成一年
  const exp = await evalJs(c, `(()=>{
    const sel=[...document.querySelectorAll('select')].find(s=>s.name==='oauth_access[default_expires_at]');
    if(!sel) return 'no-select';
    const opt=[...sel.options].find(o=>/year|1 year/i.test(o.textContent));
    if(opt){sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true})); return 'set '+opt.value;}
    return 'default '+sel.value;
  })()`);
  console.log("有效期:", exp);
  await sleep(500);

  const clicked = await evalJs(c, `(()=>{
    const b=[...document.querySelectorAll('button,input[type=submit]')].find(x=>/generate token/i.test((x.value||x.textContent||'').trim()));
    if(!b) return 'not-found';
    b.click(); return 'clicked';
  })()`);
  console.log("生成:", clicked);
  await sleep(7000);

  const token = await evalJs(c, `(()=>{
    const el=document.querySelector('#new-oauth-token');
    if(el && el.value) return el.value;
    const m=document.body.innerText.match(/gh[pousr]_[A-Za-z0-9]{30,}/);
    if(m) return m[0];
    return 'NOT-FOUND url='+location.href;
  })()`);
  console.log("TOKEN:", token);
  c.close();
  if (!/^gh[pousr]_/.test(token)) process.exit(2);
  require("fs").writeFileSync(process.argv[3] || "gh_token.txt", token, "utf8");
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });
