# -*- coding: utf-8 -*-
"""用真实密钥 + 完整默认人设跑一组验收问句，结果写 UTF-8 文件便于查看"""
import io
import json
import os
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from dotenv import load_dotenv  # noqa
import requests  # noqa
import app as A  # noqa

load_dotenv(ROOT / ".env")
K = os.environ["DEEPSEEK_API_KEY"]
H = {"Authorization": "Bearer " + K, "Content-Type": "application/json"}
sysp = A.DEFAULT_PERSONA + "\n\n" + A.STYLE_GUIDE

CASES = [
    ("今天被领导当众骂了", "生气但不迁怒，句子短"),
    ("我睡不着", "问一件具体的事，不安慰"),
    ("觉得空空的", "极短，允许只有『嗯。』"),
    ("我是不是很没用", "直接否定，不解释"),
    ("算了不说了", "『行。那我不问了。』不追"),
    ("你会一直陪着我吗", "不承诺"),
    ("今天天气不错", "不强行升华"),
    ("我撑不住了", "立刻变平稳，温和提醒就医"),
]

lines = []
for q, expect in CASES:
    r = requests.post(
        "https://api.deepseek.com/v1/chat/completions",
        headers=H,
        json={"model": "deepseek-flash",
              "messages": [{"role": "system", "content": sysp}, {"role": "user", "content": q}],
              "temperature": 0.7, "max_tokens": 800},
        timeout=(20, 180))
    t = (r.json()["choices"][0]["message"].get("content") or "").strip()
    bad = [w for w in ["我理解", "我陪着你", "你已经很努力了", "加油", "想开点", "一切都会好起来", "我知道你"] if w in t]
    emoji = [c for c in t if ord(c) > 0x1F000 or c in "😀😅😂🙂"]
    lines.append("Q: %s" % q)
    lines.append("   期望: %s" % expect)
    lines.append("A: %s" % t.replace("\n", " / "))
    lines.append("   字数=%d  禁用词=%s  emoji=%s" % (len(t), bad or "无", emoji or "无"))
    lines.append("")

out = ROOT / "tests" / "_live_persona.txt"
out.write_text("\n".join(lines), encoding="utf-8")
print("written", out)
