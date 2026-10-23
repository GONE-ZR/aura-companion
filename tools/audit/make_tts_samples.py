# -*- coding: utf-8 -*-
"""验证 /api/tts：前端倍数 → edge-tts 字符串；三句样音 v3~v5"""
import io
import json
import sys
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8000"
OUT = Path(__file__).parent / "tts-samples"
VOICE = "zh-CN-XiaoyiNeural"

CASES = [
    ("v3", "今天有点累。不过你来了，还行。", 0.93, 0.98),   # 平
    ("v4", "不。", 0.96, 0.97),                             # 嘴硬：pitch 不下调过头、不刺耳
    ("v5", "不想睡……", 0.90, 0.96),                         # 淡：不虚、不幼态
]


def call(text, rate, pitch):
    body = json.dumps({"text": text, "voice": VOICE, "rate": rate, "pitch": pitch}).encode()
    req = urllib.request.Request(BASE + "/api/tts", data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read()


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for tag, text, rate, pitch in CASES:
        try:
            st, data = call(text, rate, pitch)
            p = OUT / (tag + ".mp3")
            p.write_bytes(data)
            print("%s  status=%d  bytes=%d  rate=%.2f pitch=%.2f  %s" % (tag, st, len(data), rate, pitch, p.name))
        except Exception as e:  # noqa: BLE001
            print("%s  失败: %s %s" % (tag, type(e).__name__, e))
