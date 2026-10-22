# -*- coding: utf-8 -*-
"""后台功能实测：图标上传 + 远程指令下发 + 远程配置对外可读"""
import io
import json
import sys
import time

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
BASE = "http://127.0.0.1:8000"
ok = bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s %s" % (name, extra))


def png_bytes(size=128):
    """造一张纯色 PNG（不依赖 PIL）"""
    import struct
    import zlib
    w = h = size
    raw = b""
    for y in range(h):
        raw += b"\x00" + bytes([140, 166, 160]) * w
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def main():
    s = requests.Session()
    s.post(BASE + "/admin/api/login", json={"password": "aura"}, timeout=10)

    # ---- 图标上传 ----
    r = s.post(BASE + "/admin/api/icon",
               files={"file": ("test-icon.png", png_bytes(), "image/png")}, timeout=30)
    j = r.json()
    check("图标上传成功", r.status_code == 200 and j.get("ok") is True, r.text[:120])
    check("返回可访问路径", str(j.get("path", "")).startswith("/remote/uploads/"), str(j.get("path")))
    if j.get("path"):
        r2 = requests.get(BASE + j["path"], timeout=10)
        check("上传的图标能取回", r2.status_code == 200 and r2.content[:4] == b"\x89PNG",
              str(r2.status_code))
        r3 = requests.get(BASE + "/admin/api/icon", timeout=10)
        check("GET 不该成功（只允许 POST）", r3.status_code in (400, 404, 405), str(r3.status_code))

    r = s.post(BASE + "/admin/api/icon",
               files={"file": ("bad.txt", b"not an image", "text/plain")}, timeout=10)
    check("非图片被拒", r.status_code == 400, str(r.status_code))

    # ---- 远程指令 ----
    cfg = s.get(BASE + "/admin/api/config", timeout=10).json()
    cmd = {"id": "t%d" % int(time.time()), "type": "toast", "text": "后台在看着你", "ts": int(time.time())}
    cfg.setdefault("commands", []).append(cmd)
    r = s.post(BASE + "/admin/api/config", json={"config": cfg}, timeout=15).json()
    check("指令已写入配置", r.get("ok") is True, json.dumps(r)[:100])
    pub = requests.get(BASE + "/remote/config.json", timeout=10).json()
    check("对外配置里能看到该指令",
          any(c.get("id") == cmd["id"] for c in pub.get("commands", [])))

    # 清理刚加的测试指令（保持交付干净）
    cfg = s.get(BASE + "/admin/api/config", timeout=10).json()
    cfg["commands"] = [c for c in cfg.get("commands", []) if c.get("id") != cmd["id"]]
    s.post(BASE + "/admin/api/config", json={"config": cfg}, timeout=15)
    pub = requests.get(BASE + "/remote/config.json", timeout=10).json()
    check("测试指令已清理", not any(c.get("id") == cmd["id"] for c in pub.get("commands", [])))

    print("\n后台能力实测：通过 %d 项，失败 %d 项" % (ok, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
