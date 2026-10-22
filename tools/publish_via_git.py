# -*- coding: utf-8 -*-
"""
发布新版（走 git push，绕开只读令牌）：
  · downloads/aura-companion.apk    ← 固定文件名，每次发版覆盖 ⇒ 二维码永远不用重扫
  · downloads/latest.json           ← 版本号 / 大小 / sha256 / 备注（应用内检查更新读它）
  · downloads/index.html            ← 给人看的下载页
用法：python tools/publish_via_git.py [版本号]
"""
import hashlib
import io
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(r"D:\opencode workspace\aura-companion")
DL = ROOT / "downloads"
PROXY = "http://127.0.0.1:7897"
OWNER, REPO = "GONE-ZR", "aura-companion"
RAW = "https://raw.githubusercontent.com/%s/%s/main/downloads" % (OWNER, REPO)

PAGE = """<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>下载 · 安静陪伴</title>
<style>
 body{margin:0;min-height:100dvh;display:flex;flex-direction:column;align-items:center;
      justify-content:center;gap:16px;background:#f1efea;color:#14140f;
      font-family:"Noto Serif SC","Songti SC",Georgia,serif;padding:28px}
 h1{font-size:26px;font-weight:400;letter-spacing:.14em;margin:0}
 .sub{font-family:ui-monospace,Consolas,monospace;font-size:11px;letter-spacing:.12em;
      text-transform:uppercase;color:#6b665d}
 .btn{display:block;width:100%%;max-width:320px;text-align:center;padding:16px 18px;
      border:1px solid rgba(10,10,11,.2);border-radius:4px;background:#0a0a0b;color:#f1efea;
      font-family:ui-monospace,Consolas,monospace;font-size:12px;letter-spacing:.14em;
      text-transform:uppercase;text-decoration:none}
 .meta{font-family:ui-monospace,Consolas,monospace;font-size:11px;color:#6b665d;line-height:2}
 .note{font-family:"Noto Serif SC","Songti SC",serif;font-size:13px;line-height:1.9;
       color:#4a4842;max-width:340px;text-align:center}
</style></head><body>
<h1>安静陪伴</h1>
<div class="sub">__VER__ · __SIZE__ MB</div>
<a class="btn" href="aura-companion.apk">下载 APK</a>
<div class="meta">SHA-256 __SHA__</div>
<div class="note">__NOTES__<br><br>装完第一次打开会让你填 DeepSeek 密钥（只存在这台手机上）。<br>
如果提示「禁止安装未知来源应用」，去设置里允许「浏览器 / 文件管理」安装即可。</div>
</body></html>
"""


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else "1.0.1"
    apk = DL / ("aura-companion-%s.apk" % ver)
    if not apk.exists():
        apk = Path(r"C:\Users\27748\Desktop\安静陪伴.apk")
    data = apk.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    size = len(data)
    stable = DL / "aura-companion.apk"
    stable.write_bytes(data)
    print("固定名副本:", stable.name, "%.2f MB" % (size / 1048576))

    latest = json.loads((DL / "latest.json").read_text(encoding="utf-8"))
    latest.update({
        "version": ver,
        "published": time.strftime("%Y-%m-%d"),
        "apk": "aura-companion.apk",
        "url": RAW + "/aura-companion.apk",
        "size": size,
        "sha256": sha,
        "notes": "手机直连模式 · 杂志风界面 · 情绪表情（会生气/高兴/兴奋）· 多会话/搜索/导出 · 手机原生语音可挑音色 · 应用内检查更新",
    })
    (DL / "latest.json").write_text(json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")

    html = (PAGE.replace("__VER__", ver)
                .replace("__SIZE__", "%.2f" % (size / 1048576))
                .replace("__SHA__", sha[:32] + "…")
                .replace("__NOTES__", latest["notes"].replace("\n", "<br>")))
    (DL / "index.html").write_text(html, encoding="utf-8")
    print("latest.json + index.html 已生成")

    # git 提交并推送
    subprocess.run(["git", "add", "-A"], cwd=str(ROOT))
    subprocess.run(["git", "-c", "user.name=GONE", "-c", "user.email=2774889909@qq.com",
                    "commit", "-q", "-m", "release: v%s（固定名 APK + latest.json + 下载页）" % ver],
                   cwd=str(ROOT))
    r = subprocess.run(["git", "-c", "http.proxy=" + PROXY, "-c", "http.version=HTTP/1.1",
                        "-c", "http.postBuffer=524288000", "-c", "http.lowSpeedLimit=0",
                        "-c", "http.lowSpeedTime=999999", "push", "origin", "main"],
                       cwd=str(ROOT), capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    print((r.stdout or "").strip()[-300:], (r.stderr or "").strip()[-300:])

    # 校验永久地址
    url = RAW + "/aura-companion.apk"
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    for _ in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "aura"})
            with opener.open(req, timeout=120) as resp:
                body = resp.read()
            print("永久地址校验: HTTP %s  %d 字节  sha256 一致=%s"
                  % (resp.status, len(body), hashlib.sha256(body).hexdigest() == sha))
            print("下载地址:", url)
            print("下载页:", RAW + "/index.html")
            print("清单:", RAW + "/latest.json")
            break
        except Exception as e:
            print("重试…", str(e)[:70])
            time.sleep(5)


if __name__ == "__main__":
    main()
