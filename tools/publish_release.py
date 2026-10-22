# -*- coding: utf-8 -*-
"""
把新版推到 GitHub 并发 Release（永久下载地址）
用法：python tools/publish_release.py [版本号] [APK路径]
"""
import hashlib
import io
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

ROOT = Path(r"D:\opencode workspace\aura-companion")
PROXY = "http://127.0.0.1:7897"
OWNER, REPO = "GONE-ZR", "aura-companion"
TOKEN = Path(r"D:\tools\gh_token.txt").read_text(encoding="utf-8").strip()


def api(method, path, body=None, raw=None, ctype="application/json", timeout=180):
    url = "https://api.github.com" + path
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + TOKEN,
        "Accept": "application/vnd.github+json",
        "User-Agent": "aura-companion",
        "Content-Type": ctype,
    })
    with opener.open(req, timeout=timeout) as r:
        raw_out = r.read()
        return r.status, (json.loads(raw_out) if raw_out and "json" in r.headers.get("Content-Type", "") else raw_out)


def main():
    ver = sys.argv[1] if len(sys.argv) > 1 else "1.0.1"
    apk = Path(sys.argv[2]) if len(sys.argv) > 2 else (ROOT / "downloads" / ("aura-companion-%s.apk" % ver))
    tag = "v" + ver
    data = apk.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    size = len(data)
    print("APK:", apk, "%.2f MB" % (size / 1048576), "sha256:", sha[:16])

    # 1) latest.json
    latest = json.loads((ROOT / "downloads" / "latest.json").read_text(encoding="utf-8"))
    latest.update({"version": ver, "size": size, "sha256": sha,
                   "url": "https://github.com/%s/%s/releases/download/%s/%s" % (OWNER, REPO, tag, apk.name),
                   "published": time.strftime("%Y-%m-%d")})
    (ROOT / "downloads" / "latest.json").write_text(
        json.dumps(latest, ensure_ascii=False, indent=2), encoding="utf-8")
    print("latest.json 已更新")

    # 2) git 推送
    print("--- git push ---")
    subprocess.run(["git", "add", "-A"], cwd=str(ROOT))
    subprocess.run(["git", "-c", "user.name=GONE", "-c", "user.email=2774889909@qq.com",
                    "commit", "-q", "-m",
                    "feat: 情绪表情系统 + 杂志风界面 + 多会话/搜索/导出 + 应用内检查更新"],
                   cwd=str(ROOT))
    remote = "https://%s:%s@github.com/%s/%s.git" % (OWNER, TOKEN, OWNER, REPO)
    subprocess.run(["git", "remote", "remove", "origin"], cwd=str(ROOT))
    subprocess.run(["git", "remote", "add", "origin", remote], cwd=str(ROOT))
    r = subprocess.run(["git", "-c", "http.proxy=" + PROXY, "-c", "http.version=HTTP/1.1",
                        "-c", "http.postBuffer=524288000", "-c", "http.lowSpeedLimit=0",
                        "-c", "http.lowSpeedTime=999999",
                        "push", "-u", "origin", "main"], cwd=str(ROOT),
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    print((r.stdout or "")[-600:], (r.stderr or "")[-600:])
    # 立刻把 token 从 remote 里抹掉
    subprocess.run(["git", "remote", "set-url", "origin",
                    "https://github.com/%s/%s.git" % (OWNER, REPO)], cwd=str(ROOT))

    # 3) 创建 Release
    print("--- 创建 Release ---")
    body = {
        "tag_name": tag,
        "name": "安静陪伴 v" + ver,
        "body": (latest.get("notes") or "") +
                "\n\n- 下载：`aura-companion-%s.apk`（%.2f MB）\n- SHA-256：`%s`\n" % (ver, size / 1048576, sha),
        "draft": False, "prerelease": False,
    }
    st, rel = api("POST", "/repos/%s/%s/releases" % (OWNER, REPO), body)
    if st == 422 and isinstance(rel, dict):
        # tag 已存在 → 取现有 release
        st, rel = api("GET", "/repos/%s/%s/releases/tags/%s" % (OWNER, REPO, tag))
    print("release id:", rel.get("id"), "| url:", rel.get("html_url"))

    # 4) 上传资产
    print("--- 上传 APK ---")
    st2, out = api("POST", "/repos/%s/%s/releases/%s/assets?name=%s" %
                   (OWNER, REPO, rel["id"], apk.name),
                   raw=data, ctype="application/vnd.android.package-archive", timeout=600)
    if st2 in (201, 422):
        # 已存在同名资产 → 先删再传
        for a in rel.get("assets", []):
            if a.get("name") == apk.name:
                api("DELETE", "/repos/%s/%s/releases/assets/%s" % (OWNER, REPO, a["id"]))
        st2, out = api("POST", "/repos/%s/%s/releases/%s/assets?name=%s" %
                       (OWNER, REPO, rel["id"], apk.name),
                       raw=data, ctype="application/vnd.android.package-archive", timeout=600)
    print("上传:", st2, (out.get("browser_download_url") if isinstance(out, dict) else str(out)[:120]))

    # 5) 校验永久地址
    url = "https://github.com/%s/%s/releases/download/%s/%s" % (OWNER, REPO, tag, apk.name)
    print("永久下载地址:", url)
    try:
        opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
        req = urllib.request.Request(url, headers={"User-Agent": "aura"})
        with opener.open(req, timeout=120) as resp:
            body_out = resp.read()
        print("校验: HTTP %s  下载 %d 字节  sha256 一致=%s"
              % (resp.status, len(body_out),
                 hashlib.sha256(body_out).hexdigest() == sha))
    except Exception as e:
        print("校验失败:", str(e)[:120])


if __name__ == "__main__":
    main()
