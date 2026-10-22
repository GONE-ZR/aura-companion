# -*- coding: utf-8 -*-
"""重新打包桌面上的源码副本（保持既有条目，只替换/追加）"""
import os
import shutil
import zipfile
from pathlib import Path

SRC = Path(r"D:\opencode workspace\aura-companion")
ZIP = Path(r"C:\Users\27748\Desktop\安静陪伴-源码.zip")
FOLDER = Path(r"C:\Users\27748\Desktop\安静陪伴-源码")

SKIP_DIRS = {"node_modules", ".gradle", "dist", "web", ".venv", "__pycache__", ".git"}
SKIP_EXT = {".apk", ".exe", ".blockmap", ".zip", ".dmg"}


def collect():
    out = []
    for dirpath, dirnames, filenames in os.walk(SRC):
        # android 下的 build/ 是编译产物，desktop/build 是图标资源 —— 只排前者
        dirnames[:] = [d for d in dirnames
                       if d not in SKIP_DIRS
                       and not (d == "build" and "android" in Path(dirpath).as_posix())]
        for fn in filenames:
            p = Path(dirpath) / fn
            if fn == ".env" or fn.endswith(".env.local") or fn == ".gh_token":
                continue
            # 本机自动化脚本（含个人信息），不进交付副本
            if p.parent.name == "tools" and (fn.startswith("_") or fn == "cdp.js"):
                continue
            if p.suffix.lower() in SKIP_EXT:
                continue
            out.append(p)
    return out


def main():
    files = collect()
    # 更新磁盘上的文件夹副本
    if FOLDER.exists():
        shutil.rmtree(FOLDER, ignore_errors=True)
    for p in files:
        rel = p.relative_to(SRC)
        dst = FOLDER / rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(p, dst)

    # 重写 zip
    if ZIP.exists():
        ZIP.unlink()
    with zipfile.ZipFile(ZIP, "w", zipfile.ZIP_DEFLATED) as z:
        for p in files:
            z.write(p, str(p.relative_to(SRC)).replace("\\", "/"))
    print("files:", len(files), "zip MB:", round(ZIP.stat().st_size / 1048576, 2))


if __name__ == "__main__":
    main()
