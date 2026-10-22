# -*- coding: utf-8 -*-
"""1) 从 Chrome 历史里找 GitHub 用户名  2) 在常见应用配置里找已存的 GitHub 令牌（只看是否存在，不打印内容）"""
import glob
import io
import json
import os
import re
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

PROFILE = Path(r"D:\tools\chrome-profile\Default")

# ---------- 1) 用户名 ----------
hist = PROFILE / "History"
if hist.exists():
    tmp = Path(tempfile.gettempdir()) / "hist.db"
    shutil.copy2(hist, tmp)
    con = sqlite3.connect(str(tmp))
    rows = con.execute("select url from urls where url like '%github.com%' limit 4000").fetchall()
    con.close()
    users = {}
    for (u,) in rows:
        m = re.match(r"https?://(?:www\.)?github\.com/([A-Za-z0-9-]+)(/|$)", u)
        if m and m.group(1).lower() not in (
                "settings", "features", "explore", "notifications", "pulls", "issues",
                "marketplace", "codespaces", "apps", "orgs", "users", "about", "pricing",
                "login", "logout", "join", "new", "search", "topics", "collections",
                "sponsors", "site", "customer-stories", "security", "readme", "dashboard",
                "account", "session", "organizations", "organizationss"):
            users[m.group(1)] = users.get(m.group(1), 0) + 1
    top = sorted(users.items(), key=lambda kv: -kv[1])[:8]
    print("Chrome 历史里的 GitHub 候选用户名:", top)

# ---------- 2) 已存的令牌 ----------
PAT = re.compile(rb"(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})")
targets = []
for base in [os.environ.get("APPDATA", ""), os.environ.get("LOCALAPPDATA", ""),
             r"D:\tools", r"D:\clash verge"]:
    if not base or not os.path.isdir(base):
        continue
    for pat in ["*github*", "*verge*", "*copilot*", "*watt*", "*steam*"]:
        targets.extend(glob.glob(os.path.join(base, pat)))
        targets.extend(glob.glob(os.path.join(base, "**", pat), recursive=False))
hits = []
for t in set(targets):
    p = Path(t)
    if p.is_file() and p.suffix.lower() in (".json", ".yaml", ".yml", ".txt", ".db", ".log", ".cfg", ".conf"):
        try:
            if p.stat().st_size > 4 * 1024 * 1024:
                continue
            data = p.read_bytes()
        except Exception:
            continue
        for m in PAT.finditer(data):
            hits.append((str(p), m.group(0)[:12].decode()))
    elif p.is_dir():
        for f in list(p.glob("*.json")) + list(p.glob("*.yaml")) + list(p.glob("*.db")):
            try:
                if f.stat().st_size > 4 * 1024 * 1024:
                    continue
                data = f.read_bytes()
            except Exception:
                continue
            for m in PAT.finditer(data):
                hits.append((str(f), m.group(0)[:12].decode()))
print("\n找到疑似 GitHub 令牌的��置:")
seen = set()
for path, pref in hits:
    k = (path, pref)
    if k in seen:
        continue
    seen.add(k)
    print("   ", path, "→", pref + "…")
if not hits:
    print("    （没找到）")
