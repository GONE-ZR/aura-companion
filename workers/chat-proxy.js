/**
 * 小纯 · Cloudflare Workers 聊天代理（含每日硬额度上限）
 * ============================================================
 * 为什么要有额度上限：这个代理地址会跟着公开 APK 一起公开（配置里写着），
 * 等于一个"谁拿到都能用"的入口。DeepSeek 那边很难做到"按 key 每日限额"，
 * 所以**唯一可靠的硬兜底就在这一层**：每天超过 DAILY_LIMIT 次直接 429。
 *
 * 部署（一次性，约 5 分钟）
 * ------------------------------------------------------------
 * 1. dash.cloudflare.com → Workers & Pages → Create → Worker → 粘贴本文件 → Deploy
 * 2. Settings → Variables and Secrets，添加：
 *      DEEPSEEK_KEY  = sk-你的密钥         （类型：Secret，加密）
 *      DAILY_LIMIT   = 800                 （每天最多几次请求，按自己用量定）
 *      MAX_TOKENS    = 800                 （单次回复上限，防止被刷长文）
 *      ALLOW_ORIGIN  = *                   （或写死 https://localhost）
 * 3. 绑定 KV（额度计数要用）：
 *      Storage & Databases → KV → Create namespace → 名字 aura-quota
 *      回到 Worker → Settings → Bindings → Add → KV Namespace
 *      变量名写 AURA_KV，选中 aura-quota
 *      （不绑也能跑，但那就没有额度上限了 —— 不建议）
 * 4. 记下地址 https://xxx.你的子域.workers.dev
 * 5. 手机 App → 设置 → 代理地址 → 填进去；或写 remote/config.json 的 net.chatProxy（可热更新）
 *
 * 免费额度：Workers 10 万次请求/天、KV 10 万读 + 1000 写/天。
 *          本代理每次请求 2 写（+1 计数、过期），单人一天几百次完全够。
 *
 * 路由
 *   POST /chat    → 转发 DeepSeek（SSE 透传），带每日额度闸门
 *   GET  /usage   → 看今天用了多少 / 上限多少
 *   GET  /health  → 自检
 */

const UPSTREAM = "https://api.deepseek.com/v1/chat/completions";
const ALLOWED_MODELS = ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat"];

function cors(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function today() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, "");
}

function json(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { "Content-Type": "application/json", ...cors(origin) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = !env.ALLOW_ORIGIN || env.ALLOW_ORIGIN === "*" ? "*" : env.ALLOW_ORIGIN;
    const limit = Number(env.DAILY_LIMIT || 800);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, hasKey: !!env.DEEPSEEK_KEY, quotaBound: !!env.AURA_KV, limit }, 200, origin);
    }

    if (url.pathname === "/usage") {
      if (!env.AURA_KV) return json({ used: null, limit, note: "没绑 KV，额度上限未启用" }, 200, origin);
      const used = Number((await env.AURA_KV.get("q:" + today())) || 0);
      return json({ used, limit, left: Math.max(0, limit - used) }, 200, origin);
    }

    if (url.pathname !== "/chat" || request.method !== "POST") {
      return json({ error: "not found" }, 404, origin);
    }

    if (!env.DEEPSEEK_KEY) return json({ error: "worker 没配 DEEPSEEK_KEY" }, 500, origin);

    /* ---- 每日额度闸门（硬兜底） ---- */
    if (env.AURA_KV) {
      const key = "q:" + today();
      const used = Number((await env.AURA_KV.get(key)) || 0);
      if (used >= limit) {
        return json(
          { error: "今天额度用完了（" + limit + " 次）", used, limit },
          429,
          origin
        );
      }
      await env.AURA_KV.put(key, String(used + 1), { expirationTtl: 60 * 60 * 48 });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "bad json" }, 400, origin);
    }

    if (!ALLOWED_MODELS.includes(body.model)) body.model = "deepseek-flash";
    body.thinking = { type: "disabled" };          /* 主对话必须关思考 */
    if (env.MAX_TOKENS) {
      body.max_tokens = Math.min(Number(body.max_tokens || 300), Number(env.MAX_TOKENS));
    }

    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.DEEPSEEK_KEY}`,
      },
      body: JSON.stringify(body),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: new Headers({
        "Content-Type": upstream.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-store",
        ...cors(origin),
      }),
    });
  },
};
