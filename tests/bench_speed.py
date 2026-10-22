# -*- coding: utf-8 -*-
"""测速度：隧道往返 / 本地往返 / DeepSeek 首字延迟（flash vs v4-pro）"""
import io
import json
import os
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa
import requests  # noqa

load_dotenv(ROOT / ".env")
KEY = os.environ["DEEPSEEK_API_KEY"]
H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}
TUNNEL = sys.argv[1] if len(sys.argv) > 1 else "https://floating-forecasts-reading-hunter.trycloudflare.com"


def rtt(url, n=4):
    ts = []
    for _ in range(n):
        t0 = time.time()
        try:
            requests.get(url, timeout=30)
        except Exception:
            pass
        ts.append((time.time() - t0) * 1000)
    return ts


print("== 隧道往返（手机看到的那一段）==")
for u in [TUNNEL + "/api/version", "http://127.0.0.1:8000/api/version"]:
    ts = rtt(u)
    print("  %-58s 中位 %.0f ms  (min %.0f / max %.0f)" % (u[:58], sorted(ts)[len(ts)//2], min(ts), max(ts)))

print()
print("== DeepSeek 首字延迟（模型思考多久）==")
for model in ("deepseek-flash", "deepseek-v4-pro"):
    for label, mt in (("max_tokens=1200", 1200),):
        t0 = time.time()
        first = None
        content = ""
        reasoning = 0
        try:
            with requests.post(
                "https://api.deepseek.com/v1/chat/completions",
                headers=H,
                json={"model": model,
                      "messages": [{"role": "user", "content": "今天被领导当众骂了"}],
                      "max_tokens": mt, "stream": True, "temperature": 0.7},
                stream=True, timeout=(20, 180)) as resp:
                for raw in resp.iter_lines(decode_unicode=True):
                    if not raw or not raw.startswith("data:"):
                        continue
                    b = raw[5:].strip()
                    if b == "[DONE]":
                        break
                    try:
                        o = json.loads(b)
                    except Exception:
                        continue
                    d = (o.get("choices") or [{}])[0].get("delta") or {}
                    if d.get("reasoning_content"):
                        reasoning += 1
                    if d.get("content") and first is None:
                        first = time.time() - t0
                    if d.get("content"):
                        content += d["content"]
        except Exception as e:
            print("  %-16s ERR %r" % (model, e))
            continue
        total = time.time() - t0
        print("  %-16s 首字 %5.0f ms   总 %5.0f ms   推理块 %3d   正文 %d 字   | %s"
              % (model, (first or 0) * 1000, total * 1000, reasoning, len(content),
                 content.strip()[:40].replace("\n", " ")))
