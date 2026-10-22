# -*- coding: utf-8 -*-
"""试各个 Cloudflare 边缘区域，量隧道往返延迟，选最快的"""
import io
import re
import subprocess
import sys
import time
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
CF = r"D:\tools\cloudflared.exe"
REGIONS = sys.argv[1:] or ["", "apac", "jp", "hk", "sg", "kr", "tw", "us"]


def try_region(region):
    args = [CF, "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate"]
    if region:
        args += ["--region", region]
    p = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                         text=True, encoding="utf-8", errors="replace",
                         creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                         bufsize=1)
    url = None
    loc = None
    t0 = time.time()
    import threading
    lines = []
    stop = threading.Event()

    def reader():
        for line in p.stdout:
            lines.append(line)
            m = URL_RE.search(line)
            if m:
                url_box.append(m.group(0))
            if "location=" in line:
                loc_box.append(line.strip())

    url_box, loc_box = [], []
    th = threading.Thread(target=reader, daemon=True)
    th.start()
    while time.time() - t0 < 90 and not url_box:
        time.sleep(0.5)
    if not url_box:
        p.terminate()
        return None, None, None, lines[-3:]
    url = url_box[0]
    # 等隧道真正 Registered
    reg = 0
    while time.time() - t0 < 120:
        if any("Registered tunnel connection" in l for l in lines):
            reg = time.time() - t0
            break
        time.sleep(0.5)
    # 测往返
    import requests
    ts = []
    for _ in range(4):
        t1 = time.time()
        try:
            r = requests.get(url + "/api/version", timeout=25)
            if r.status_code == 200:
                ts.append((time.time() - t1) * 1000)
        except Exception:
            pass
    p.terminate()
    median = sorted(ts)[len(ts) // 2] if ts else -1
    return url, median, reg, (loc_box[-1] if loc_box else "")


print("%-8s %-10s %-10s %s" % ("region", "注册耗时", "往返中位", "说明"))
best = None
for reg in REGIONS:
    name = reg or "(自动)"
    url, med, regt, extra = try_region(reg)
    if not url:
        print("%-8s %-10s %-10s 连不上" % (name, "-", "-"))
        continue
    print("%-8s %-10s %-10s %s" % (name, "%.0fs" % regt, "%.0fms" % med, url))
    if med > 0 and (best is None or med < best[1]):
        best = (url, med, name)
if best:
    print()
    print("最快：%s  %.0fms  %s" % (best[0], best[1], best[2]))
