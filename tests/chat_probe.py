# -*- coding: utf-8 -*-
"""验证桌面版内部服务 /api/chat 能直连 DeepSeek（主进程通道）"""
import io
import json
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8731/api/chat"
key = sys.argv[2] if len(sys.argv) > 2 else ""
data = json.dumps({
    "system_prompt": "你是我的专属安静陪伴伙伴，不是心理医生。说话简短柔和，一两句。",
    "messages": [{"role": "user", "content": "今天被领导当众骂了"}],
    "max_tokens": 1200
}, ensure_ascii=False).encode("utf-8")

headers = {"Content-Type": "application/json; charset=utf-8"}
if key:
    headers["X-Aura-Key"] = key
req = urllib.request.Request(url, data=data, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=180) as r:
        body = json.loads(r.read().decode("utf-8"))
        print("HTTP", r.status)
        print("回复：", (body.get("reply") or "").replace("\n", " / "))
        print("模型：", body.get("model"))
except Exception as e:
    print("FAIL", e)
