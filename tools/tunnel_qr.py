#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
安静陪伴 · 公网隧道（**最优方案**：手机跨网络访问）

为什么它是「最优」：
  · 手机和电脑不在同一个网络 → 局域网 IP 手机访问不到
  · 浏览器只在 https/localhost 下才允许「装到桌面」和「用麦克风」
  · Cloudflare 快速隧道不需要账号、不需要备案、不需要花钱
  · 相比局域网直连：地址是公网 https，功能不打折
  · 相比 Render 部署：不用推 GitHub、不用等冷启动、密钥还留在本机

用法：python tools/tunnel_qr.py [port]
选项：--no-open   只出二维码不自动打开图片

变更记录（2026-10-22）：
  ① 原来用 stdout.readline() 阻塞读日志 → 180 秒超时形同虚设（卡在 readline 就出不来）
     → 改成「后台线程 + 队列」，主循环非阻塞轮询，超时真正生效
  ② 原来不检查本地服务是否真的起来了 → 隧道通了但页面 502
     → 改成先做 HTTP 就绪探测，没就绪就等着，等到为止
  ③ 原来 PYTHONPATH 一旦设置就把项目根挤掉 → sys.path 改成「所有 PYTHONPATH 条目 + 项目根」
  ④ 新增：URL 自动复制到剪贴板 + 二维码图片自动打开（手机直接扫，不用盯着终端）
  ⑤ stdout 管道重定向时默认是块缓冲 → 隧道成功后地址迟迟不显示（实测踩到）
     → TextIOWrapper 加 line_buffering=True，每行立刻刷出来
"""
import io
import os
import queue
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import _console  # noqa: F401  统一 stdout 包装（只能包一次）

ROOT = Path(__file__).resolve().parent.parent

# sys.path：先放项目根，再放 PYTHONPATH 里的所有条目（不能互相挤掉）
_extra = [p for p in (os.environ.get("PYTHONPATH") or "").split(os.pathsep) if p]
for _p in [str(ROOT)] + _extra:
    if _p not in sys.path:
        sys.path.insert(0, _p)

CLOUDFLARED = r"D:\tools\cloudflared.exe"
URL_RE = re.compile(r"https://[a-z0-9-]+\.trycloudflare\.com")
TUNNEL_TIMEOUT = 180          # 隧道连接最长等多久（网络差时 30-60 秒）
LOCAL_READY_TIMEOUT = 90      # 本地服务最长等多久


# ---------------------------------------------------------------- 本地就绪探测
def local_ready(port, timeout=5):
    """本地服务真的在监听并且能返回页面吗（不是只看端口在不在）"""
    url = "http://127.0.0.1:%d/" % port
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 500
    except Exception:
        return False


def wait_local(port, timeout=LOCAL_READY_TIMEOUT):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if local_ready(port):
            return True
        time.sleep(1.0)
    return False


# ---------------------------------------------------------------- 隧道
def start_tunnel(port):
    """起隧道；后台线程读日志，主线程用队列拿 URL（非阻塞，超时有效）"""
    logf = ROOT / "_tunnel.log"
    if logf.exists():
        logf.unlink()

    p = subprocess.Popen(
        [CLOUDFLARED, "tunnel", "--url", "http://127.0.0.1:%d" % port, "--no-autoupdate"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )

    q = queue.Queue()
    lock = threading.Lock()

    def _reader():
        try:
            for line in p.stdout:
                with lock:
                    with logf.open("a", encoding="utf-8") as f:
                        f.write(line)
                q.put(line)
        except Exception:
            pass
        q.put(None)

    threading.Thread(target=_reader, daemon=True).start()

    url = None
    t0 = time.time()
    last_hint = 0
    while time.time() - t0 < TUNNEL_TIMEOUT:
        try:
            line = q.get(timeout=1.0)
        except queue.Empty:
            if p.poll() is not None:
                break
            # 每 15 秒给个进度提示，别让人以为卡死
            if time.time() - last_hint > 15:
                last_hint = time.time()
                print("     ...还在连（已等待 %d 秒）" % int(time.time() - t0))
            continue
        if line is None:
            break
        m = URL_RE.search(line)
        if m:
            url = m.group(0)
            break
    return url, p


# ---------------------------------------------------------------- 剪贴板 / 二维码
def copy_to_clipboard(text):
    """纯 Win32 API，不额外起 PowerShell"""
    try:
        import ctypes
        from ctypes import wintypes

        CF_UNICODETEXT = 13
        GMEM_MOVEABLE = 0x0002

        user32 = ctypes.windll.user32
        kernel32 = ctypes.windll.kernel32
        # 64 位下句柄必须显式声明成 64 位，否则会被截断
        kernel32.GlobalAlloc.restype = ctypes.c_void_p
        kernel32.GlobalLock.restype = ctypes.c_void_p
        kernel32.GlobalLock.argtypes = [ctypes.c_void_p]
        kernel32.GlobalUnlock.argtypes = [ctypes.c_void_p]

        if not user32.OpenClipboard(None):
            return False
        try:
            user32.EmptyClipboard()
            data = ctypes.create_unicode_buffer(text)
            handle = kernel32.GlobalAlloc(GMEM_MOVEABLE, ctypes.sizeof(data))
            locked = kernel32.GlobalLock(handle)
            ctypes.memmove(locked, data, ctypes.sizeof(data))
            kernel32.GlobalUnlock(handle)
            user32.SetClipboardData(CF_UNICODETEXT, ctypes.c_void_p(handle))
            return True
        finally:
            user32.CloseClipboard()
    except Exception:
        return False


def save_qr(url):
    """生成二维码 PNG，返回路径（失败返回 None）"""
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        png = ROOT / "手机打开二维码.png"
        qr.make_image(fill_color="#3A3D3B", back_color="white").save(png)
        return png
    except Exception:
        return None


def open_file(path):
    try:
        os.startfile(str(path))
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- 主流程
def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    port = int(args[0]) if args else 8000
    auto_open = "--no-open" not in sys.argv

    if not Path(CLOUDFLARED).exists():
        print("  [x] 找不到 cloudflared：%s" % CLOUDFLARED)
        print("      下载：https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe")
        return 1

    print()
    print("  安静陪伴 · 公网隧道（最优方案）")
    print("  " + "-" * 54)

    # 1) 本地服务就绪探测
    if local_ready(port):
        print("  [1/2] 本地服务已就绪（127.0.0.1:%d）" % port)
    else:
        print("  [1/2] 等本地服务就绪（127.0.0.1:%d）…" % port)
        sys.stdout.flush()
        if not wait_local(port):
            print("  [x] 等了 %d 秒本地服务还没起来。" % LOCAL_READY_TIMEOUT)
            print("      先另开一个窗口跑：python app.py --host 127.0.0.1 --port %d" % port)
            return 1
        print("       本地服务已就绪")

    # 2) 起隧道
    print("  [2/2] 连接 Cloudflare 边缘节点（网络差要 30-60 秒）…")
    sys.stdout.flush()
    url, proc = start_tunnel(port)
    if not url:
        print("  [x] 隧道没连上（%d 秒超时）。细节看 %s" % (TUNNEL_TIMEOUT, ROOT / "_tunnel.log"))
        try:
            proc.terminate()
        except Exception:
            pass
        return 1

    print()
    print("  " + "=" * 58)
    print("  公网地址已就绪")
    print("  " + "=" * 58)
    print()
    print("  手机浏览器直接打开（手机和电脑不在一个网络也没关系）：")
    print()
    print("      " + url)
    print()
    print("  · 这是 https → 可以「添加到主屏幕」，麦克风也能用")
    print("  · 地址是临时的：关掉这个窗口就失效，下次运行换一个")
    print()

    # 剪贴板
    if copy_to_clipboard(url):
        print("  [✓] 地址已复制到剪贴板（可以微信/AirDrop 发给手机）")
    else:
        print("  [!] 地址复制到剪贴板失败，请手动选中上面的地址")

    # 二维码
    png = save_qr(url)
    if png:
        print("  [✓] 二维码图片：%s" % png)
        if auto_open and open_file(png):
            print("  [✓] 已自动打开二维码图片 —— 手机扫它就行")
    else:
        print("  [!] 二维码生成失败（缺 qrcode？pip install qrcode[pil]）")

    print()
    print("  按 Ctrl+C 结束隧道。")
    print()

    try:
        while True:
            time.sleep(2)
    except KeyboardInterrupt:
        print()
        print("  隧道已关闭。")
    finally:
        try:
            proc.terminate()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main() or 0)
