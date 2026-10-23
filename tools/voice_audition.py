# -*- coding: utf-8 -*-
"""语音候选试听：A/B/C/D 四个音色画像 × 四句同文台词

    python tools/voice_audition.py

产出（voice-lab/ 目录）：
   A-清冷少女.mp3 / B-普通少女.mp3 / C-御姐偏软.mp3 / D-御姐偏冷.mp3   ← 四句连读
   A_1.mp3 … D_4.mp3                                                   ← 单句（细听用）
   参数记录在 voice-lab/README.txt
"""
import asyncio
import io
import sys
from pathlib import Path

import edge_tts

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "voice-lab"
OUT.mkdir(exist_ok=True)

LINES = [
    "嗯，我在。",
    "行啊，你挺会说的。",
    "有点累。不是冲你。",
    "不聊这个。",
]

# 四个候选：同一个音色库里的两种基础声线 + 不同的 rate/pitch 画像
#   A 萝莉向·清冷 —— 偏亮、句尾不飘
#   B 萝莉向·普通 —— 更软、略靠中
#   C 御姐向·偏软 —— 中低、稳、带一点柔
#   D 御姐向·偏冷 —— 更低更稳、起伏极小
CANDIDATES = [
    {"id": "A", "name": "清冷少女", "voice": "zh-CN-XiaoyiNeural", "rate": "+2%", "pitch": "+18Hz"},
    {"id": "B", "name": "普通少女", "voice": "zh-CN-XiaoyiNeural", "rate": "-2%", "pitch": "+4Hz"},
    {"id": "C", "name": "御姐偏软", "voice": "zh-CN-XiaoxiaoNeural", "rate": "-4%", "pitch": "-10Hz"},
    {"id": "D", "name": "御姐偏冷", "voice": "zh-CN-XiaoxiaoNeural", "rate": "-7%", "pitch": "-22Hz"},
]


async def synth(text, voice, rate, pitch, path):
    com = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
    await com.save(str(path))
    return path.stat().st_size


async def main():
    log = []
    for c in CANDIDATES:
        # 四句连读（句子之间靠标点自然停顿）
        joined = "\n".join(LINES)
        whole = OUT / ("%s-%s.mp3" % (c["id"], c["name"]))
        size = await synth(joined, c["voice"], c["rate"], c["pitch"], whole)
        log.append("%s 四句连读  %-22s %7d B  voice=%s rate=%s pitch=%s"
                   % (c["id"], whole.name, size, c["voice"], c["rate"], c["pitch"]))
        # 单句
        for i, line in enumerate(LINES, 1):
            p = OUT / ("%s_%d.mp3" % (c["id"], i))
            s2 = await synth(line, c["voice"], c["rate"], c["pitch"], p)
            log.append("   %s_%d  %6d B  %s" % (c["id"], i, s2, line))

    (OUT / "README.txt").write_text(
        "小纯语音候选试听\n"
        "四句台词（四段内容完全一致）：\n"
        + "\n".join("  %d %s" % (i, l) for i, l in enumerate(LINES, 1))
        + "\n\n"
        + "\n".join(log)
        + "\n\n选型标准：第 2 句「带刺但不凶」、第 3 句「累但还在照顾对方」、第 1 句不能像客服。\n",
        encoding="utf-8")

    print("\n".join(log))


asyncio.run(main())
