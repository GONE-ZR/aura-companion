#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
组装 Capacitor 需要的 web/ 目录（前端只有一份，这里只是换个摆放）
用法：python tools/build_web.py
"""
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def main():
    if WEB.exists():
        shutil.rmtree(WEB)
    WEB.mkdir(parents=True)

    shutil.copy2(ROOT / "templates" / "index.html", WEB / "index.html")
    shutil.copy2(ROOT / "manifest.json", WEB / "manifest.json")
    shutil.copy2(ROOT / "service-worker.js", WEB / "service-worker.js")
    shutil.copytree(ROOT / "static", WEB / "static")
    shutil.copytree(ROOT / "icons", WEB / "icons")

    print("web/ ready:", WEB)
    for p in sorted(WEB.rglob("*")):
        if p.is_file():
            print("  ", p.relative_to(WEB), p.stat().st_size)


if __name__ == "__main__":
    main()
