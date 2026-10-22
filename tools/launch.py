#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
安静陪伴 · 一键启动器（mobile / lan）

为什么把逻辑从 .bat 挪进 Python：
  cmd.exe 解析 .bat 时，多层括号块（if/for 嵌套）、引号里的括号、chcp 切换，
  会把命令行**切碎**执行 —— 实测出现过：
      'import socket,sys; s=socket.socket()...' 不是内部或外部命令
      cloudflared 收到 --url 之外的残缺参数
  .bat 里塞逻辑 = 脆。逻辑进 Python，.bat 只剩 4 行壳，稳。

用法：
    python tools/launch.py mobile   # 公网隧道（最优方案）
    python tools/launch.py lan      # 局域网直连（备用方案）
"""
import io
import os
import socket
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _console  # noqa: F401  统一 stdout 包装（只能包一次）

ROOT = Path(__file__).resolve().parent.parent

CLOUDFLARED = Path(r"D:\tools\cloudflared.exe")
CLOUDFLARED_URL = ("https://github.com/cloudflare/cloudflared/releases/latest/download/"
                    "cloudflared-windows-amd64.exe")
PORT = 8000
EXTRA_SITE = Path(r"D:\tools\py-packages")

# 让 qrcode 之类装在 D 盘的工具包也能 import 到
for _p in [str(ROOT)] + [p for p in (os.environ.get("PYTHONPATH") or "").split(os.pathsep) if p] \
        + [str(EXTRA_SITE)]:
    if _p not in sys.path:
        sys.path.insert(0, _p)


def hr(title=""):
    print()
    print("  " + "-" * 56)
    if title:
        print("  " + title)
        print("  " + "-" * 56)


# ---------------------------------------------------------------- 依赖 / 配置
def deps_ok():
    try:
        import flask  # noqa: F401
        import requests  # noqa: F401
        import dotenv  # noqa: F401
        import edge_tts  # noqa: F401
        return True
    except Exception:
        return False


def ensure_deps():
    if deps_ok():
        return True
    print("  [i] 首次运行，安装依赖（1-3 分钟）...")
    subprocess.call([sys.executable, "-m", "pip", "install", "-r",
                     str(ROOT / "requirements.txt")])
    return deps_ok()


def ensure_env():
    env = ROOT / ".env"
    if not env.exists():
        src = ROOT / ".env.example"
        if src.exists():
            shutil.copyfile(src, env)
            print("  [!] 已复制 .env 模板。你可以在网页里点「设置 API 密钥」填。")


def ensure_cloudflared():
    if CLOUDFLARED.exists():
        return True
    print("  [i] 缺少 cloudflared，正在下载（55MB）…")
    try:
        CLOUDFLARED.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(CLOUDFLARED_URL, str(CLOUDFLARED))
        return CLOUDFLARED.exists()
    except Exception as e:
        print("  [x] 下载失败：%s" % e)
        return False


# ---------------------------------------------------------------- 端口 / 服务
def port_in_use(port):
    s = socket.socket()
    try:
        s.settimeout(1.0)
        return s.connect_ex(("127.0.0.1", port)) == 0
    finally:
        s.close()


def http_ready(port, timeout=4):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/" % port, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def wait_http(port, timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if http_ready(port):
            return True
        time.sleep(1.0)
    return False


def start_app(host):
    """后台起 app.py（无控制台窗口），返回进程对象"""
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    return subprocess.Popen(
        [sys.executable, "app.py", "--host", host, "--port", str(PORT)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        creationflags=flags,
    )


# ---------------------------------------------------------------- 两个模式
def mode_mobile():
    hr("安静陪伴 · 手机公网版（最优方案）")
    print("  手机和电脑不在同一个网络也能打开；地址是 https，")
    print("  能「添加到主屏幕」，麦克风也能用。")
    print("  代价：地址是临时的，关掉这个窗口就失效。")

    if not ensure_deps():
        print("  [x] 依赖没装好，先修好再启动。")
        return 1
    ensure_env()
    if not ensure_cloudflared():
        return 1

    child = None
    if port_in_use(PORT):
        print("  [1/2] %d 端口已经有服务在跑，复用它。" % PORT)
    else:
        print("  [1/2] 启动本地服务…")
        child = start_app("127.0.0.1")
        if not wait_http(PORT):
            print("  [x] 本地服务 %d 秒没起来。" % 90)
            if child:
                child.terminate()
            return 1
        print("       本地服务已就绪")

    print("  [2/2] 建立公网隧道（网络差要 30-60 秒）…")
    sys.path.insert(0, str(ROOT / "tools"))
    import tunnel_qr

    url, proc = tunnel_qr.start_tunnel(PORT)
    if not url:
        print("  [x] 隧道没连上，看 %s" % (ROOT / "_tunnel.log"))
        if child:
            child.terminate()
        return 1

    print()
    print("  " + "=" * 58)
    print("  公网地址已就绪")
    print("  " + "=" * 58)
    print()
    print("      " + url)
    print()
    print("  · 手机浏览器直接打开（不同网络也没问题）")
    print("  · https → 能「添加到主屏幕」，麦克风也能用")
    print("  · 地址是临时的：关掉这个窗口就失效")
    print()

    if tunnel_qr.copy_to_clipboard(url):
        print("  [✓] 地址已复制到剪贴板（可以微信/AirDrop 发给手机）")
    else:
        print("  [!] 复制到剪贴板失败，请手动选中上面的地址")

    png = tunnel_qr.save_qr(url)
    if png:
        print("  [✓] 二维码图片：%s" % png)
        if tunnel_qr.open_file(png):
            print("  [✓] 已自动打开二维码 —— 手机扫它就行")
    else:
        print("  [!] 二维码生成失败（缺 qrcode？pip install \"qrcode[pil]\"）")

    print()
    print("  按 Ctrl+C 结束。")
    print()

    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print()
        print("  已退出。")
    finally:
        for p in (proc, child):
            if p:
                try:
                    p.terminate()
                except Exception:
                    pass
    return 0


def mode_lan():
    hr("安静陪伴 · 局域网版（备用方案）")
    print("  条件：手机和电脑必须连同一个 WiFi。")
    print("  地址是 http：能聊天、翻历史、换壁纸；")
    print("  但装不了桌面图标、麦克风会被浏览器拒绝。")
    print("  想跨网络 / 想装桌面 → 双击「启动手机版(公网隧道).bat」。")

    if not ensure_deps():
        print("  [x] 依赖没装好，先修好再启动。")
        return 1
    ensure_env()

    sys.path.insert(0, str(ROOT / "tools"))
    import lan_info

    ip = lan_info.lan_ip()
    url = "http://%s:%d" % (ip, PORT)

    # 先确认端口状态，再出地址和二维码（免得给出打不开的码）
    reuse = False
    if port_in_use(PORT):
        try:
            with urllib.request.urlopen("http://%s:%d/" % (ip, PORT), timeout=4) as r:
                reuse = 200 <= r.status < 500
        except Exception:
            reuse = False
        if not reuse:
            print()
            print("  [x] %d 端口被占用，但那个服务只监听本机（127.0.0.1），手机访问不到。" % PORT)
            print("      请先关掉占用它的窗口（比如另一个安静陪伴服务），再运行一次。")
            print()
            return 1

    print()
    print("  手机上打开这个地址（手机和电脑连同一个 WiFi）：")
    print()
    print("      " + url)
    print()
    print("  本机打开：      http://127.0.0.1:%d" % PORT)
    print()

    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        png = ROOT / "手机打开二维码.png"
        qr.make_image(fill_color="#3A3D3B", back_color="white").save(png)
        print("  [✓] 二维码图片：%s" % png)
    except Exception as e:
        print("  [!] 二维码生成失败：%s" % e)

    print()
    if reuse:
        print("  [i] %d 端口已有服务且能从局域网访问，复用它。" % PORT)
    print("  正在启动服务，窗口别关（关了手机就连不上了）…")
    print()

    try:
        import webbrowser
        webbrowser.open("http://127.0.0.1:%d" % PORT)
    except Exception:
        pass

    child = start_app("0.0.0.0")
    try:
        while child.poll() is None:
            time.sleep(2)
    except KeyboardInterrupt:
        pass
    finally:
        try:
            child.terminate()
        except Exception:
            pass
    return 0


def main():
    mode = (sys.argv[1] if len(sys.argv) > 1 else "mobile").lower()
    if mode == "mobile":
        return mode_mobile()
    if mode == "lan":
        return mode_lan()
    print("  用法：python tools/launch.py [mobile|lan]")
    return 2


if __name__ == "__main__":
    sys.exit(main() or 0)
