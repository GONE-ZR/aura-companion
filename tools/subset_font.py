# -*- coding: utf-8 -*-
"""得意黑子集化（第三篇 §3.5）
   charset = ASCII + 常用汉字（GB2312 一级 3755）+ 本项目用到的所有字
   产出：static/fonts/smiley-sans.ttf / .woff2（ASCII 文件名）
"""
import io
import subprocess
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(r"D:\opencode workspace\aura-companion")
SRC = ROOT / "_ss.ttf"
OUT_DIR = ROOT / "static" / "fonts"
OUT_DIR.mkdir(parents=True, exist_ok=True)

if not SRC.exists():
    print("✗ 缺 _ss.ttf（先跑下载）")
    sys.exit(1)

chars = set()
# 1) ASCII
for c in range(0x20, 0x7F):
    chars.add(chr(c))
# 2) 项目里出现过的所有字符（JS/HTML/MD）
for pat in ("static/js/*.js", "static/css/*.css", "templates/*.html", "*.md"):
    for p in ROOT.glob(pat):
        try:
            chars.update(ch for ch in p.read_text(encoding="utf-8", errors="ignore") if ord(ch) > 0x7F)
        except Exception:
            pass
# 3) GB2312 一级常用字（3755）
for b1 in range(0xB0, 0xD8):
    for b2 in range(0xA1, 0xFF):
        try:
            chars.add(bytes([b1, b2]).decode("gb2312"))
        except Exception:
            pass
# 4) 标点与拟声词补充
chars.update("，。！？、；：…—～·「」『』（）《》〈〉“”‘’　")
chars.update("哼唔啧唉哦嗯哈嘿咦诶呀哇噢嘶嘘")

text = "".join(sorted(chars))
print("子集字符数：", len(text))

ttf = OUT_DIR / "smiley-sans.ttf"
woff2 = OUT_DIR / "smiley-sans.woff2"

cmd = [
    sys.executable, "-m", "fontTools.subset", str(SRC),
    "--text=" + text,
    "--output-file=" + str(ttf),
    "--layout-features=*",
    "--no-hinting",
    "--desubroutinize",
    "--name-IDs=*",
]
r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace")
print("ttf:", r.returncode, r.stderr[-200:] if r.returncode else "")
print("  %.1f KB" % (ttf.stat().st_size / 1024) if ttf.exists() else "  ✗ 未生成")

r2 = subprocess.run(cmd[:-3] + ["--flavor=woff2", "--output-file=" + str(woff2)],
                    capture_output=True, text=True, encoding="utf-8", errors="replace")
print("woff2:", r2.returncode, r2.stderr[-200:] if r2.returncode else "")
print("  %.1f KB" % (woff2.stat().st_size / 1024) if woff2.exists() else "  ✗ 未生成")

for p in (ttf, woff2):
    if p.exists():
        print("%-28s %7.1f KB  %s" % (p.name, p.stat().st_size / 1024,
                                      "✅ ≤500KB" if p.stat().st_size <= 500 * 1024 else "⚠️ >500KB"))
