#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
组装 Capacitor 需要的 web/ 目录（前端只有一份，这里只是换个摆放）
用法：python tools/build_web.py
"""
import sys
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"


def _run_gates():
    """构建前两道闸门：bake（固化配置 + 拦局域网/killSwitch/rollout）+ check_assets（缺图就 fail）"""
    import subprocess

    steps = [
        ([sys.executable, str(ROOT / "tools" / "bake.py")], "bake"),
        (["node", str(ROOT / "tools" / "check_assets.js")], "check_assets"),
    ]
    for cmd, name in steps:
        r = subprocess.run(cmd, cwd=str(ROOT), capture_output=True, text=True,
                           encoding="utf-8", errors="replace")
        out = (r.stdout or "").strip().splitlines()
        tail = out[-1] if out else ""
        if r.returncode != 0:
            print("[闸门失败] %s" % name)
            print((r.stdout or "") + (r.stderr or ""))
            raise SystemExit(1)
        print("[闸门通过] %s  %s" % (name, tail))



def main():
    _run_gates()
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
