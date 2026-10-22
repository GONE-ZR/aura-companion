# -*- coding: utf-8 -*-
"""核对新 APK 里到底有没有：语音插件 / 新 voice.js / 权限"""
import io
import re
import sys
import zipfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
APK = Path(r"D:\opencode workspace\aura-companion\downloads\aura-companion.apk")
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
import re as _re
_local_upd = Path(r"D:\opencode workspace\aura-companion\static\js\updater.js").read_text(encoding="utf-8")
_m = _re.search(r'var CURRENT = "([0-9.]+)"', _local_upd)
_want = _m.group(1) if _m else "?"
check("updater 版本号与源码一致（%s）" % _want, ('var CURRENT = "%s"' % _want) in upd, upd[:40])
check("新模块都打进包了（engine/prompt/safety/memfacts/meta/emotion-ui）",
      all(("assets/public/static/js/%s.js" % n) in names for n in
          ["engine", "prompt", "safety", "memfacts", "meta", "emotion-ui", "review"]))
check("下载走 gh-proxy", "gh-proxy.com" in upd)

z.close()

# 权限用 aapt 单独验（脚本调用）
print("\nAPK 内容核对：通过 %d 项，失败 %d 项" % (ok, bad))
sys.exit(0 if bad == 0 else 1)
