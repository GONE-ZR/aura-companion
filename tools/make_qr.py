# -*- coding: utf-8 -*-
"""
生成「永久二维码」：指向仓库里固定文件名的 APK
  · 每次发版只覆盖同一个文件 → 二维码永远不用重扫
  · 扫码 → 手机浏览器直接下载 APK
用法：python tools/make_qr.py
"""
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.path.insert(0, r"D:\tools\py-packages")

ROOT = Path(r"D:\opencode workspace\aura-companion")
DESKTOP = Path(r"C:\Users\27748\Desktop")
RAW = "https://gone-zr.github.io/aura-companion/downloads"   # 国内可直连（raw.githubusercontent 被墙）

APK_URL = RAW + "/aura-companion.apk"
PAGE_URL = RAW + "/index.html"
JSON_URL = RAW + "/latest.json"


def main():
    import qrcode
    latest = json.loads((ROOT / "downloads" / "latest.json").read_text(encoding="utf-8"))
    qr = qrcode.QRCode(border=2)
    qr.add_data(APK_URL)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#14140f", back_color="white")

    out1 = ROOT / "手机打开二维码.png"
    img.save(out1)
    out2 = DESKTOP / "扫码下载APK.png"
    img.save(out2)
    print("二维码（永久地址，永远不用重扫）:", APK_URL)
    print("  项目内:", out1)
    print("  桌面  :", out2)

    # 终端里也画一个，方便小纯自己扫
    qr2 = qrcode.QRCode(border=1)
    qr2.add_data(APK_URL)
    qr2.make(fit=True)
    qr2.print_ascii(invert=True)

    print()
    print("下载页 :", PAGE_URL)
    print("清单   :", JSON_URL)
    print("当前版 :", latest.get("version"), "%.2f MB" % (latest.get("size", 0) / 1048576))


if __name__ == "__main__":
    main()
