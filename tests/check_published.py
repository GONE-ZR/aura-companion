# -*- coding: utf-8 -*-
"""验发布结果：raw 上的 latest.json / APK / 远程配置是不是都是新的"""
import hashlib
import io
import json
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main"
ok = bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s  %s" % (name, extra))


def main():
    r = requests.get(BASE + "/downloads/latest.json", timeout=30)
    d = r.json()
    check("latest.json 可读", r.status_code == 200)
    check("版本是 1.0.2", d.get("version") == "1.0.2", str(d.get("version")))

    r = requests.get(BASE + "/downloads/aura-companion.apk", timeout=120)
    blob = r.content
    h = hashlib.sha256(blob).hexdigest()
    check("APK 可下载", r.status_code == 200, str(r.status_code))
    check("APK 大小与清单一致", len(blob) == d.get("size"),
          "raw=%d 清单=%s" % (len(blob), d.get("size")))
    check("APK 哈希与清单一致", h == d.get("sha256"),
          "raw=%s… 清单=%s…" % (h[:12], str(d.get("sha256"))[:12]))
    check("APK 是合法 zip（能装）", blob[:2] == b"PK")

    r = requests.get(BASE + "/remote/config.json", timeout=30)
    cfg = r.json()
    check("远程配置可读", r.status_code == 200)
    check("配置含 11 个功能开关", len(cfg.get("features", {})) >= 11,
          str(len(cfg.get("features", {}))))
    check("配置不含密钥", "ghp_" not in r.text and "sk-" not in r.text)
    print("     配置版本 v%s · 主题色 %s" % (cfg.get("version"),
                                       (cfg.get("theme") or {}).get("accent")))

    r = requests.get(BASE + "/downloads/latest.json", timeout=30)
    print("\n发布验收：通过 %d 项，失败 %d 项" % (ok, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
