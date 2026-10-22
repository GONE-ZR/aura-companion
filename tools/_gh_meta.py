# -*- coding: utf-8 -*-
"""给 GitHub 仓库补简介与标签（并校验密钥没进仓库）"""
import io
import json
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = open(r"D:\opencode workspace\aura-companion\.gh_token", encoding="utf-8").read().strip()
OWNER, REPO = "GONE-ZR", "aura-companion"
H = {"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json",
     "User-Agent": "aura-companion", "Content-Type": "application/json"}

DESC = "安静的陪伴 · Aura Companion —— 四形态个人情感陪伴应用（手机直连 / 桌面 Electron / PWA / 安卓 APK）。后端无状态，对话只在本机。"
TOPICS = ["personal-companion", "pwa", "electron", "capacitor", "android", "flask",
          "deepseek", "edge-tts", "privacy", "local-first"]


def api(path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.github.com" + path, method=method,
        data=json.dumps(body).encode("utf-8") if body is not None else None, headers=H)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:200]


st, r = api(f"/repos/{OWNER}/{REPO}", "PATCH",
            {"description": DESC, "topics": TOPICS, "has_issues": True,
             "homepage": "", "license_template": "mit"})
print("更新仓库信息:", st)
if isinstance(r, dict):
    print("   description:", r.get("description"))
    print("   topics:", r.get("topics"))
    print("   private:", r.get("private"), "| stars:", r.get("stargazers_count"))

st, r = api(f"/repos/{OWNER}/{REPO}/contents/README.md")
print("README 可访问:", st)
