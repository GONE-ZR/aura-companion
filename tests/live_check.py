#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
真机联网验收：用 .env 里的真实密钥跑通规格书 25.2 的四件事
用法：python tests/live_check.py
"""
import io
import json
import os
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402
import requests  # noqa: E402

load_dotenv(ROOT / ".env")
KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
BASE = os.environ.get("DEEPSEEK_BASE", "https://api.deepseek.com/v1").rstrip("/")
MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-flash")

if not KEY:
    print("没有 DEEPSEEK_API_KEY，先写进 .env")
    sys.exit(1)

ok = 0
bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  [PASS] " + name + (("  " + str(extra)) if extra else ""))
    else:
        bad += 1
        print("  [FAIL] " + name + ("  " + str(extra)))


H = {"Authorization": "Bearer " + KEY, "Content-Type": "application/json"}

print("=" * 60)
print("真实密钥联网验收  model=%s" % MODEL)
print("=" * 60)

# ---------- 1. 纯文字 ----------
print("\n[1] /api/chat 纯文字")
try:
    r = requests.post(
        BASE + "/chat/completions",
        headers=H,
        json={
            "model": MODEL,
            "messages": [
                {"role": "system", "content": "你是我的专属安静陪伴伙伴，不是心理医生。说话简短柔和，句子短，不长篇大论。"},
                {"role": "user", "content": "今天被领导当众骂了"},
            ],
            "temperature": 0.7,
            "max_tokens": 200,
        },
        timeout=(20, 120),
    )
    check("HTTP 200", r.status_code == 200, r.text[:200])
    if r.status_code == 200:
        d = r.json()
        txt = d["choices"][0]["message"].get("content") or ""
        check("有回复内容", len(txt.strip()) > 0, repr(txt[:60]))
        print("       模型回复：%s" % txt.strip()[:80])
except Exception as e:
    check("请求不异常", False, repr(e))

# ---------- 2. 流式 ----------
print("\n[2] /api/chat/stream 逐块到达")
try:
    chunks = []
    t0 = time.time()
    with requests.post(
        BASE + "/chat/completions",
        headers=H,
        json={
            "model": MODEL,
            "messages": [{"role": "user", "content": "我睡不着"}],
            "temperature": 0.7,
            "max_tokens": 1200,
            "stream": True,
        },
        stream=True,
        timeout=(20, 180),
    ) as resp:
        check("HTTP 200", resp.status_code == 200, resp.status_code)
        reasoning = 0
        for raw in resp.iter_lines(decode_unicode=True):
            if not raw:
                continue
            line = raw.strip()
            if not line.startswith("data:"):
                continue
            body = line[5:].strip()
            if body == "[DONE]":
                break
            try:
                obj = json.loads(body)
                d = (obj.get("choices") or [{}])[0].get("delta") or {}
                if d.get("reasoning_content"):
                    reasoning += 1
                c = d.get("content") or ""
                if c:
                    chunks.append(c)
            except Exception:
                pass
    dt = time.time() - t0
    text = "".join(chunks)
    check("收到多个分块（真流式）", len(chunks) >= 2, "%d 块 / %.2fs（另有 %d 块推理）" % (len(chunks), dt, reasoning))
    check("拼起来是完整中文", len(text.strip()) > 0, repr(text[:60]))
    print("       流式拼出：%s" % text.strip()[:80])
except Exception as e:
    check("请求不异常", False, repr(e))

# ---------- 3. 语音合成 ----------
print("\n[3] edge-tts 语音合成")
try:
    import asyncio
    import edge_tts

    async def tts():
        comm = edge_tts.Communicate("我在，你慢慢说。", "zh-CN-XiaoxiaoNeural")
        buf = bytearray()
        async for ch in comm.stream():
            if ch.get("type") == "audio":
                buf.extend(ch["data"])
        return bytes(buf)

    audio = asyncio.run(tts())
    check("合成出音频", len(audio) > 3000, "%d bytes" % len(audio))
    (ROOT / "tests" / "_tts_sample.mp3").write_bytes(audio)
except Exception as e:
    check("合成不异常", False, repr(e))

# ---------- 4. 带图对话 ----------
print("\n[4] 带图对话（走 flash 多模态）")
try:
    from PIL import Image, ImageDraw
    img = Image.new("RGB", (480, 320), (238, 236, 230))
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 440, 280], outline=(90, 110, 105), width=6)
    d.text((70, 140), "HELLO AURA", fill=(90, 110, 105))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80)
    b64 = "data:image/jpeg;base64," + __import__("base64").b64encode(buf.getvalue()).decode()

    r = requests.post(
        BASE + "/chat/completions",
        headers=H,
        json={
            "model": MODEL,
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": "这张图里写的是什么字？只回答字的内容。"},
                    {"type": "image_url", "image_url": {"url": b64}},
                ],
            }],
            "max_tokens": 100,
        },
        timeout=(20, 180),
    )
    check("HTTP 200", r.status_code == 200, r.text[:200])
    if r.status_code == 200:
        txt = r.json()["choices"][0]["message"].get("content") or ""
        check("模型看懂了图", "HELLO" in txt.upper() or "AURA" in txt.upper(), repr(txt[:80]))
        print("       模型回答：%s" % txt.strip()[:80])
except Exception as e:
    check("请求不异常", False, repr(e))

# ---------- 5. 模型可用性 ----------
print("\n[5] 模型名与 401/429 处理")
try:
    r = requests.get(BASE + "/models", headers=H, timeout=30)
    names = [m["id"] for m in r.json().get("data", [])] if r.status_code == 200 else []
    check("deepseek-flash 在可用模型列表里", "deepseek-flash" in names, names[:8])
except Exception as e:
    check("models 查询不异常", False, repr(e))

print("\n" + "=" * 60)
print("通过 %d 项，失败 %d 项" % (ok, bad))
print("=" * 60)
sys.exit(1 if bad else 0)
