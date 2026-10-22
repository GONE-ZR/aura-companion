# -*- coding: utf-8 -*-
"""把项目打成「源码 zip」（给交付总包用；不含依赖与构建产物）"""
import io
import sys
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
OUT = Path.home() / "Desktop" / "安静陪伴-源码.zip"

SKIP_DIRS = {
    "node_modules", ".git", "build", ".gradle", "dist", "web", "downloads",
    "__pycache__", ".idea", ".vscode", "venv", ".venv", "android/app/build",
}
SKIP_EXT = {".pyc", ".apk", ".exe", ".zip", ".log", ".bak", ".db"}


def keep(p: Path) -> bool:
    rel = p.relative_to(ROOT)
    parts = set(rel.parts)
    if parts & SKIP_DIRS:
        return False
    if any(str(rel).startswith(s + "/") or str(rel).startswith(s + "\\") for s in SKIP_DIRS):
        return False
    if p.suffix.lower() in SKIP_EXT:
        return False
    if p.name.startswith("_ss."):
        return False
    return True


files = [p for p in ROOT.rglob("*") if p.is_file() and keep(p)]
if OUT.exists():
    OUT.unlink()
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for p in files:
        z.write(p, p.relative_to(ROOT).as_posix())

print("源码 zip：%s  %.2f MB  %d 个文件" % (OUT.name, OUT.stat().st_size / 1048576, len(files)))
