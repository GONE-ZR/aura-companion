# -*- coding: utf-8 -*-
"""最终验收：手机真实会走的通道（gh-proxy / GitHub Pages）拿到的 APK 与清单是否一致"""
import hashlib
import io
import json
import sys
import time

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LOCAL_APK = r"D:\opencode workspace\aura-companion\downloads\aura-companion.apk"
PAGES = "https://gone-zr.github.io/aura-companion/"
PROXY = "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/"

data = open(LOCAL_APK, "rb").read()
local_sha = hashlib.sha256(data).hexdigest()
print("本机 APK：%d B  sha256=%s…" % (len(data), local_sha[:16]))


def get(url, **kw):
    return requests.get(url, timeout=kw.pop("timeout", 90), headers={"Origin": "https://x.test"}, **kw)


def wait_pages(max_wait=420):
    t0 = time.time()
    last = ""
    while time.time() - t0 < max_wait:
        try:
            r = get(PAGES + "downloads/latest.json", timeout=25)
            m = r.json()
            last = "清单 v%s size=%s" % (m.get("version"), m.get("size"))
            if str(m.get("sha256")) == local_sha:
                return m, True
        except Exception as e:
            last = "等待中（%s）" % type(e).__name__
        time.sleep(20)
    print("  最后一次：", last)
    return None, False


print("\n--- 等 Pages 重建（最多 7 分钟）---")
m, ready = wait_pages()
print("Pages 就绪：", ready)

ok = bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s  %s" % (name, extra))


print("\n--- 清单一致性 ---")
import re as _re
from pathlib import Path as _P
_up = _P(r"D:\opencode workspace\aura-companion\static\js\updater.js").read_text(encoding="utf-8")
_m = _re.search(r'var CURRENT = "([0-9.]+)"', _up)
local_ver = _m.group(1) if _m else "?"
print("本地 updater.js 版本：", local_ver)
for label, base in (("Pages", PAGES), ("gh-proxy", PROXY)):
    try:
        mm = get(base + "downloads/latest.json", timeout=30).json()
        check("%s 清单版本 %s" % (label, local_ver), mm.get("version") == local_ver,
              str(mm.get("version")))
        check("%s 清单 sha 与本机一致" % label, str(mm.get("sha256")) == local_sha,
              "%s… vs %s…" % (str(mm.get("sha256"))[:12], local_sha[:12]))
    except Exception as e:
        check("%s 清单可读" % label, False, type(e).__name__)

print("\n--- APK 实下载（不分块、算哈希）---")
for label, base in (("Pages", PAGES), ("gh-proxy", PROXY)):
    t0 = time.time()
    try:
        r = get(base + "downloads/aura-companion.apk", timeout=180)
        blob = r.content
        ms = int((time.time() - t0) * 1000)
        h = hashlib.sha256(blob).hexdigest()
        check("%s APK 下载成功" % label, r.status_code == 200, str(r.status_code))
        check("%s APK 大小一致" % label, len(blob) == len(data),
              "%d vs %d" % (len(blob), len(data)))
        check("%s APK 哈希一致" % label, h == local_sha, "%s…" % h[:12])
        print("       %s 耗时 %.1f 秒" % (label, ms / 1000.0))
    except Exception as e:
        check("%s APK 可下载" % label, False, type(e).__name__)

print("\n--- 远程配置 ---")
for label, base in (("Pages", PAGES), ("gh-proxy", PROXY)):
    try:
        r = get(base + "remote/config.json", timeout=30)
        c = r.json()
        check("%s 配置可读" % label, r.status_code == 200)
        check("%s 配置含 11 个开关" % label, len(c.get("features", {})) >= 11,
              str(len(c.get("features", {}))))
        check("%s 配置无密钥" % label,
              "ghp_" not in r.text and "sk-" not in r.text)
        check("%s 允许跨域" % label,
              r.headers.get("Access-Control-Allow-Origin") in ("*", "https://x.test"),
              str(r.headers.get("Access-Control-Allow-Origin")))
    except Exception as e:
        check("%s 配置可读" % label, False, type(e).__name__)

print("\n最终验收：通过 %d 项，失败 %d 项" % (ok, bad))
sys.exit(0 if bad == 0 else 1)
