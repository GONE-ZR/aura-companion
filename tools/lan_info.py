#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
局域网信息 + 二维码：让手机扫一下就能打开本机的安静陪伴。
用法：python tools/lan_info.py [port]
"""
import io
import os
import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _console  # noqa: F401  统一 stdout 包装（只能包一次）

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(os.environ.get("PYTHONPATH", ""))) if os.environ.get("PYTHONPATH") else str(ROOT))


def lan_ip():
    """不真的发包就能拿到出口网卡 IP（连到 8.8.8.8 的 UDP socket）"""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        try:
            return socket.gethostbyname(socket.gethostname())
        except Exception:
            return "127.0.0.1"
    finally:
        s.close()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    ip = lan_ip()
    url = "http://%s:%d" % (ip, port)

    print()
    print("=" * 56)
    print("  安静陪伴 · 局域网已启动")
    print("=" * 56)
    print()
    print("  手机上打开这个地址（手机和电脑连同一个 WiFi）：")
    print()
    print("      " + url)
    print()
    print("  本机打开：")
    print("      http://127.0.0.1:%d" % port)
    print()

    # 二维码
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        png = ROOT / "手机打开二维码.png"
        qr.make_image(fill_color="#3A3D3B", back_color="white").save(png)
        print("  终端二维码（手机扫）：")
        qr.print_ascii(invert=True)
        print("  二维码图片已存：%s" % png)
    except Exception as e:
        print("  （二维码生成失败：%s）" % e)

    print()
    print("  ⚠️ 局域网是 http，不是安全上下文：")
    print("     · 可以聊天、可以看历史（历史在你手机本地）")
    print("     · 不能装到桌面（PWA 与麦克风都需要 https）")
    print("     · 想跨网络用 / 想装桌面 / 想用麦克风")
    print("       → 双击「启动手机版(公网隧道).bat」（公网 https，最优方案）")
    print()


if __name__ == "__main__":
    main()
