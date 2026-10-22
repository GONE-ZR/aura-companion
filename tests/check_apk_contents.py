# -*- coding: utf-8 -*-
"""核对新 APK 里到底有没有：语音插件 / 新 voice.js / 权限"""
import io
import re
import sys
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
APK = Path(r"C:\Users\27748\Desktop\安静陪伴.apk")
ok = bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s  %s" % (name, extra))


z = zipfile.ZipFile(APK)
names = z.namelist()

dex_blob = b""
for n in names:
    if n.endswith(".dex"):
        dex_blob += z.read(n)
print("APK: %.2f MB, %d 个条目, dex %d 字节" % (
    APK.stat().st_size / 1048576, len(names), len(dex_blob)))

check("原生语音插件已编译进包（AuraSpeechPlugin）",
      b"AuraSpeechPlugin" in dex_blob)
check("插件注册名 SpeechRecognition 在包内",
      b"SpeechRecognition" in dex_blob)
check("TTS 插件仍在",
      b"AuraTtsPlugin" in dex_blob)

voice = z.read("assets/public/static/js/voice.js").decode("utf-8", "replace")
check("voice.js 是最新的（有 no-recognizer 分支）", "no-recognizer" in voice)
appjs = z.read("assets/public/static/js/app.js").decode("utf-8", "replace")
check("APK 判断了 Capacitor（不注册 SW）", "isNativePlatform" in appjs)
check("有密钥提示逻辑（key-bar）", "key-bar" in appjs)
upd = z.read("assets/public/static/js/updater.js").decode("utf-8", "replace")
check("updater 版本号 = 1.0.4", 'var CURRENT = "1.0.4"' in upd)
check("下载走 gh-proxy", "gh-proxy.com" in upd)

z.close()

# 权限用 aapt 单独验（脚本调用）
print("\nAPK 内容核对：通过 %d 项，失败 %d 项" % (ok, bad))
sys.exit(0 if bad == 0 else 1)
