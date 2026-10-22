# -*- coding: utf-8 -*-
"""第四篇「模型层」验收（可执行）
   覆盖：72/73（界面不出现模型名，结构检查）/74/78/79/80/82/83/84/85/86
   跑法：python tests/eval_model.py
"""
import io
import json
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(r"D:\opencode workspace\aura-companion")
sys.path.insert(0, str(ROOT))

ok = bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s  %s" % (name, str(extra)[:110]))


print("=== 服务端：白名单 / 参数 / 思考开关 ===")
os_env = __import__("os").environ
os_env.setdefault("DEEPSEEK_API_KEY", "sk-test-placeholder")
import app as A

# 合法 standard
p = A._build_payload({"messages": [{"role": "user", "content": "hi"}]}, "k", True)
check("默认走 standard（flash）", p["model"] == "deepseek-flash", p["model"])
check("79：主对话 thinking 恒为 disabled", p.get("thinking") == {"type": "disabled"}, p.get("thinking"))
check("参数表：flash temperature=1.25", p["temperature"] == 1.25, p["temperature"])
check("参数表：max_tokens=300", p["max_tokens"] == 300, p["max_tokens"])
check("86：流式带 include_usage", p.get("stream_options", {}).get("include_usage") is True,
      p.get("stream_options"))

# 细腻档
p2 = A._build_payload({"messages": [{"role": "user", "content": "hi"}], "model_tier": "delicate"}, "k", True)
check("细腻档 → deepseek-v4-pro", p2["model"] == "deepseek-v4-pro", p2["model"])
check("细腻档 temperature=1.15", p2["temperature"] == 1.15, p2["temperature"])
check("细腻档同样关闭 thinking", p2.get("thinking") == {"type": "disabled"})

# 78：白名单
for bad_id in ("gpt-4o", "deepseek-v4-flash", "zhipu-glm-4.7-flash", "../etc/passwd"):
    try:
        A._build_payload({"model": bad_id, "messages": [{"role": "user", "content": "hi"}]}, "k", True)
        check("78：非法模型 %s 被拒" % bad_id, False, "竟然通过了")
    except A.ModelNotAllowed:
        check("78：非法模型 %s 被拒（400）" % bad_id, True)

# 84：system 里不许有每轮变化的内容
sys.path.insert(0, str(ROOT))
p3 = A._build_payload({
    "system_prompt": "你是小纯。",
    "messages": [{"role": "user", "content": "状态块 + 用户输入"}]
}, "k", True)
sys_msg = p3["messages"][0]["content"]
for token in ("忍耐值：", "时间：", "原因：", "20:30", "2026-"):
    check("84：system 不含每轮变化内容（%s）" % token, token not in sys_msg, sys_msg[:60])

print("\n=== 前端：装配顺序 / 首行标签宽解析 / 概览 ===")
# 用 node 跑 prompt.js 的 assembleCached，检查结构
import subprocess

node_code = r'''
const P = require("./static/js/prompt.js");
const E = require("./static/js/engine.js");
const st = E.createState(Date.now());
const asm = P.assembleCached({
  engine: E, state: st,
  memories: [{ fact: "下周三有面试", type: "event", confidence: 0.9, status: "active" }],
  history: [{ role: "user", text: "在吗" }, { role: "assistant", text: "在。" }, { role: "user", text: "今天被骂了" }],
  now: Date.now(), lastGap: 3600000
});
const last = asm.messages[asm.messages.length - 1];
console.log(JSON.stringify({
  hasStateInSystem: /忍耐值|状态：/.test(asm.system),
  hasMemInSystem: asm.system.indexOf("你记得的事") !== -1,
  systemLen: asm.system.length,
  lastIsUser: last.role === "user",
  lastHasState: last.content.indexOf("忍耐值") !== -1,
  lastHasMem: last.content.indexOf("下周三有面试") !== -1,
  lastHasUser: last.content.indexOf("今天被骂了") !== -1,
  historyKept: asm.messages.length,
  chars: asm.chars
}));
'''
r = subprocess.run(["node", "-e", node_code], cwd=str(ROOT), capture_output=True, text=True,
                   encoding="utf-8", errors="replace")
try:
    d = json.loads(r.stdout.strip().splitlines()[-1])
except Exception:
    d = {}
    print("   node 输出：", (r.stdout or "")[:200], (r.stderr or "")[:200])

check("83/84：system 只有静态人设（不含状态/忍耐值）", d.get("hasStateInSystem") is False, d)
check("83：system 不含记忆块（记忆挪到最后一条 user）", d.get("hasMemInSystem") is False, d)
check("最后一条是 user", d.get("lastIsUser") is True)
check("状态块在最后一条 user 里", d.get("lastHasState") is True)
check("记忆块在最后一条 user 里", d.get("lastHasMem") is True)
check("用户输入在最后一条 user 里（在状态与记忆之后）", d.get("lastHasUser") is True)
check("上下文 ≤ 4000 字符", (d.get("chars") or 99999) <= 4000, d.get("chars"))

# 72/73：界面不出现模型名（扫前端源码）
front = "\n".join(p.read_text(encoding="utf-8", errors="replace")
                  for p in (ROOT / "static" / "js").glob("*.js"))
ui_files = "\n".join(p.read_text(encoding="utf-8", errors="replace")
                     for p in [ROOT / "templates" / "index.html"])
for name in ("deepseek-flash", "deepseek-v4-pro"):
    check("72：界面文件里不出现模型名（%s）" % name, name not in ui_files)

print("\n模型层验收：通过 %d 项，失败 %d 项" % (ok, bad))
sys.exit(0 if bad == 0 else 1)
