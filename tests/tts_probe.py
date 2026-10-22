# -*- coding: utf-8 -*-
"""用 UTF-8 正确发中文，测试桌面版 /api/tts（PowerShell 的 Invoke-WebRequest 会把中文按 ANSI 发，文字全变 ?）"""
import json
import sys
import urllib.request

url = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8731/api/tts"
data = json.dumps({
    "text": "你在，我慢慢说。",
    "voice": "zh-CN-XiaoxiaoNeural",
    "rate": "+0%", "pitch": "+0Hz", "volume": "+0%"
}, ensure_ascii=False).encode("utf-8")

req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json; charset=utf-8"})
try:
    with urllib.request.urlopen(req, timeout=90) as r:
        body = r.read()
        print("OK", r.status, len(body), "bytes", r.headers.get("Content-Type"))
        with open(r"D:\tools\tts-final.mp3", "wb") as f:
            f.write(body)
except Exception as e:
    print("FAIL", e)
