# -*- coding: utf-8 -*-
"""用令牌查 GitHub 上的仓库状态（分支、提交数、可见性）"""
import io
import json
import sys
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

TOKEN = open(r"D:\opencode workspace\aura-companion\.gh_token", encoding="utf-8").read().strip()
OWNER, REPO = "GONE-ZR", "aura-companion"
H = {"Authorization": "Bearer " + TOKEN, "Accept": "application/vnd.github+json",
     "User-Agent": "aura-companion"}


def api(path, method="GET", body=None):
    req = urllib.request.Request(
        "https://api.github.com" + path, method=method,
        data=json.dumps(body).encode() if body else None,
        headers=dict(H, **({"Content-Type": "application/json"} if body else {})))
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")[:300]
    except Exception as e:
        return None, str(e)[:200]


if __name__ == "__main__":
    st, repo = api(f"/repos/{OWNER}/{REPO}")
    print("仓库:", st)
    if isinstance(repo, dict):
        print("   可见性 private=%s  默认分支=%s  克隆地址=%s" % (repo.get("private"), repo.get("default_branch"), repo.get("clone_url")))
    st, br = api(f"/repos/{OWNER}/{REPO}/branches")
    print("分支:", st, br if isinstance(br, str) else [b.get("name") for b in br])
    st, cm = api(f"/repos/{OWNER}/{REPO}/commits?per_page=5")
    print("提交:", st, cm if isinstance(cm, str) else [(c["sha"][:8], c["commit"]["message"][:40]) for c in cm])
    st, tree = api(f"/repos/{OWNER}/{REPO}/git/trees/master?recursive=1")
    print("文件树:", st, (len(tree.get("tree", [])) if isinstance(tree, dict) else tree))
