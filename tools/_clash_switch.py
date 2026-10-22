# -*- coding: utf-8 -*-
"""
把 Clash 切到 global 模式并选一个能通 github.com 的最快节点。
（结束后可用 restore 切回 rule 模式）
"""
import json
import sys
import time
import urllib.parse
import urllib.request

sys.path.insert(0, r"D:\opencode workspace\aura-companion\tools")

# ⚠️ 必须先 import：_clash_pipe 会把 stdout 包成 UTF-8，
#    两个模块各包一次会把同一个底层 buffer 关掉（ValueError: I/O operation on closed file）
from _clash_pipe import pipe_request, PIPE, SECRET  # noqa


def api(method, path, body=None):
    st, data = pipe_request(PIPE, method, path, json.dumps(body) if body is not None else None)
    return data


def test(url, proxy="http://127.0.0.1:7897", timeout=25):
    opener = urllib.request.build_opener(
        urllib.request.ProxyHandler({"https": proxy, "http": proxy}))
    req = urllib.request.Request(url, headers={"User-Agent": "curl/8"})
    try:
        with opener.open(req, timeout=timeout) as r:
            return r.status, len(r.read())
    except Exception as e:
        return None, str(e)[:80]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "global"
    if mode == "restore":
        api("PATCH", "/configs", {"mode": "rule"})
        print("已切回 rule 模式")
        return

    cfg = api("GET", "/configs")
    print("原模式:", cfg.get("mode"))

    # 1) 找到 GLOBAL 组里能通 github.com 的最快节点
    proxies = api("GET", "/proxies")
    g = proxies.get("proxies", {}).get("GLOBAL", {})
    cands = g.get("all", [])
    print("GLOBAL 组候选:", len(cands))

    ok = []
    for n in cands:
        try:
            q = urllib.parse.urlencode({"url": "https://github.com/", "timeout": 5000})
            st, d = pipe_request(PIPE, "GET", "/proxies/%s/delay?%s" % (urllib.parse.quote(n), q))
            if isinstance(d, dict) and d.get("delay") and d["delay"] < 1500:
                ok.append((n, d["delay"]))
        except Exception:
            pass
    ok.sort(key=lambda x: x[1])
    if not ok:
        print("没有可用节点")
        return
    best = ok[0][0]
    print("最快节点: %s (%d ms)" % (best, ok[0][1]))

    # 2) 选中它 + 切 global
    api("PUT", "/proxies/GLOBAL", {"name": best})
    api("PATCH", "/configs", {"mode": "global"})
    time.sleep(1.5)

    cur = api("GET", "/proxies").get("proxies", {}).get("GLOBAL", {}).get("now")
    print("已切到 global，当前节点:", cur)

    # 3) 验证
    for u in ["https://github.com/", "https://api.github.com/zen", "https://www.google.com/generate_204"]:
        st, info = test(u)
        print("  %-42s -> %s %s" % (u, st, info))


if __name__ == "__main__":
    main()
