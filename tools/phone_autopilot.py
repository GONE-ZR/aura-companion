#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
手机自动驾驶：手机一连上电脑，就自动完成
   1) 装 APK        2) 启动应用        3) 填 DeepSeek 密钥        4) 保存并验证
全程用 adb（不需要你点手机屏幕，除非手机弹出授权框）。

用法：python tools/phone_autopilot.py            # 前台跑，直到完成
     python tools/phone_autopilot.py --watch    # 后台守候，手机一连上就自动装
"""
import io
import os
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(r"D:\opencode workspace\aura-companion")
ADB = r"D:\tools\android-sdk\platform-tools\adb.exe"
APK = Path(r"C:\Users\27748\Desktop\安静陪伴.apk")
SHOTS = ROOT / "phone_shots"
PKG = "com.aura.companion"
ACTIVITY = "com.aura.companion/.MainActivity"

SHOTS.mkdir(exist_ok=True)


def adb(*args, timeout=60, binary=False):
    r = subprocess.run([ADB] + list(args), capture_output=True, timeout=timeout)
    if binary:
        return r.stdout
    return (r.stdout or b"").decode("utf-8", "replace") + (r.stderr or b"").decode("utf-8", "replace")


def log(*a):
    print("[%s]" % time.strftime("%H:%M:%S"), *a, flush=True)


def devices():
    out = adb("devices")
    res = []
    for line in out.splitlines()[1:]:
        line = line.strip()
        if not line or line.startswith("*"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            res.append(parts[0])
    return res


def wait_device(timeout=600):
    log("等待手机连接（USB 或无线调试）…")
    t0 = time.time()
    while time.time() - t0 < timeout:
        ds = devices()
        if ds:
            log("发现设备:", ds[0])
            return ds[0]
        time.sleep(2)
    return None


def install(dev):
    log("开始安装 APK…")
    out = adb("-s", dev, "install", "-r", "-d", str(APK), timeout=300)
    log("安装结果:", out.strip().splitlines()[-1] if out.strip() else "(无输出)")
    return "Success" in out


def launch(dev):
    adb("-s", dev, "shell", "am", "start", "-n", ACTIVITY, timeout=30)
    time.sleep(4)


def shot(dev, name):
    data = adb("-s", dev, "exec-out", "screencap", "-p", timeout=40, binary=True)
    p = SHOTS / ("%s.png" % name)
    p.write_bytes(data)
    return p


def dump_ui(dev):
    """uiautomator 导出当前界面结构"""
    adb("-s", dev, "shell", "uiautomator", "dump", "/sdcard/ui.xml", timeout=40)
    xml = adb("-s", dev, "shell", "cat", "/sdcard/ui.xml", timeout=40)
    m = re.search(r"<\?xml.*?</hierarchy>", xml, re.S)
    return m.group(0) if m else ""


def nodes(xml):
    out = []
    if not xml:
        return out
    try:
        root = ET.fromstring(xml)
    except Exception:
        return out
    for n in root.iter("node"):
        b = n.get("bounds", "")
        mm = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", b)
        if not mm:
            continue
        x1, y1, x2, y2 = map(int, mm.groups())
        out.append({
            "text": (n.get("text") or "") + "|" + (n.get("content-desc") or ""),
            "cls": n.get("class", ""),
            "clickable": n.get("clickable") == "true",
            "cx": (x1 + x2) // 2,
            "cy": (y1 + y2) // 2,
            "bounds": (x1, y1, x2, y2),
        })
    return out


def find(ns, *keywords):
    for kw in keywords:
        for n in ns:
            if kw.lower() in n["text"].lower():
                return n
    return None


def tap(dev, x, y):
    adb("-s", dev, "shell", "input", "tap", str(x), str(y), timeout=20)
    time.sleep(1.2)


def type_text(dev, text):
    # input text 不支持空格与特殊字符，密钥是纯 ASCII，安全
    safe = text.replace(" ", "%s").replace("'", "").replace('"', "")
    adb("-s", dev, "shell", "input", "text", safe, timeout=40)
    time.sleep(0.8)


def key(dev, code):
    adb("-s", dev, "shell", "input", "keyevent", str(code), timeout=20)
    time.sleep(1.0)


def run():
    dev = wait_device()
    if not dev:
        log("超时：没等到设备")
        return 1

    # 1) 安装
    if not install(dev):
        log("安装失败")
        shot(dev, "install_failed")
        return 2

    # 2) 启动
    launch(dev)
    shot(dev, "01_launched")
    log("已启动应用，截图:", SHOTS / "01_launched.png")

    # 3) 关闭可能出现的首次引导弹窗
    ns = nodes(dump_ui(dev))
    ok = find(ns, "知道了", "好", "OK")
    if ok:
        tap(dev, ok["cx"], ok["cy"])
        log("关闭了首次引导")

    # 4) 打开设置
    ns = nodes(dump_ui(dev))
    gear = None
    for n in ns:
        if n["clickable"] and ("设置" in n["text"] or "settings" in n["text"].lower()
                               or "Setting" in n["cls"]):
            gear = n
            break
    if gear:
        tap(dev, gear["cx"], gear["cy"])
        log("打开了设置")
    else:
        # 兜底：点右上角图标区域（顶部栏最右）
        log("没找到设置节点，点右上角兜底")
        tap(dev, 1230, 110)
    time.sleep(1.5)
    shot(dev, "02_drawer")
    log("抽屉截图:", SHOTS / "02_drawer.png")

    # 5) 找到密钥输入框并输入
    ns = nodes(dump_ui(dev))
    field = None
    for n in ns:
        if n["cls"].endswith("EditText") and ("密码" in n["text"] or "sk-" in n["text"]
                                              or "密钥" in n["text"] or "key" in n["text"].lower()):
            field = n
            break
    if field is None:
        # 退一步：把抽屉里所有 EditText 都列出来
        edits = [n for n in ns if n["cls"].endswith("EditText")]
        log("抽屉里的输入框:", [(e["text"], e["bounds"]) for e in edits])
        if edits:
            field = edits[0]
    if field is None:
        log("没找到密钥输入框，人工接管。截图:", SHOTS / "02_drawer.png")
        return 3

    tap(dev, field["cx"], field["cy"])
    # 读密钥
    key_txt = ""
    env = ROOT / ".env"
    for line in env.read_text(encoding="utf-8").splitlines():
        if line.startswith("DEEPSEEK_API_KEY="):
            key_txt = line.split("=", 1)[1].strip()
    if not key_txt:
        log(".env 里没有密钥")
        return 4
    type_text(dev, key_txt)
    time.sleep(0.8)
    shot(dev, "03_key_typed")

    # 6) 点「保存密钥」
    ns = nodes(dump_ui(dev))
    save = find(ns, "保存密钥", "保存")
    if save:
        tap(dev, save["cx"], save["cy"])
        log("点了保存")
    else:
        key(dev, 66)  # 回车提交
        log("没找到保存按钮，用回车提交")
    time.sleep(1.5)
    shot(dev, "04_saved")

    # 7) 回到对话页，发一条消息验证
    key(dev, 4)  # back
    time.sleep(1.2)
    ns = nodes(dump_ui(dev))
    inp = None
    for n in ns:
        if n["cls"].endswith("EditText"):
            inp = n
            break
    if inp:
        tap(dev, inp["cx"], inp["cy"])
        type_text(dev, "你好")
        time.sleep(0.5)
        key(dev, 66)  # enter 发送
        time.sleep(6)
    shot(dev, "05_chat")
    log("验证截图:", SHOTS / "05_chat.png")
    log("✅ 自动流程结束，请看 phone_shots 目录里的截图确认")
    return 0


if __name__ == "__main__":
    if "--watch" in sys.argv:
        while True:
            try:
                run()
            except Exception as e:
                log("出错:", e)
            time.sleep(5)
    else:
        sys.exit(run())
