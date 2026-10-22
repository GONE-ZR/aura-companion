# -*- coding: utf-8 -*-
"""
用 Clash 的控制接口找出能访问 github.com 的节点，并（可选）切到全局模式。
"""
import io
import json
import sys
import urllib.parse
import urllib.request

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CTRL = "http://127.0.0.1:9097"
SECRET = "set-your-secret"
TEST_URL = "https://github.com/"


def api(path, method="GET", body=None):
    url = CTRL + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + SECRET)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        return json.loads(raw) if raw else {}


def main():
    try:
        ver = api("/version")
        print("Clash 版本:", ver)
    except Exception as e:
        print("控制器连不上:", e)
        return

    cfg = api("/configs")
    print("当前模式:", cfg.get("mode"))

    proxies = api("/proxies")
    nodes = []
    for name, info in proxies.get("proxies", {}).items():
        if info.get("type") in ("Selector", "URLTest", "Fallback", "LoadBalance"):
            continue
        if not info.get("all"):
            continue
        nodes.append(name)
    print("候选节点:", len(nodes))

    good = []
    for n in nodes:
        try:
            q = urllib.parse.urlencode({"url": TEST_URL, "timeout": 4000})
            req = urllib.request.Request(f"{CTRL}/proxies/{urllib.parse.quote(n)}/delay?{q}")
            req.add_header("Authorization", "Bearer " + SECRET)
            with urllib.request.urlopen(req, timeout=8) as r:
                d = json.loads(r.read())
                delay = d.get("delay")
                if delay and delay < 6000:
                    good.append((n, delay))
                    print("  ✅ %-40s %d ms" % (n, delay))
        except Exception:
            pass

    if not good:
        print("没有节点能直连 github.com（可能全部走不通，或 github 被整体封锁）")
        # 换个测试目标，看看节点本身通不通
        for n in nodes[:5]:
            try:
                q = urllib.parse.urlencode({"url": "https://www.google.com/generate_204", "timeout": 4000})
                req = urllib.request.Request(f"{CTRL}/proxies/{urllib.parse.quote(n)}/delay?{q}")
                req.add_header("Authorization", "Bearer " + SECRET)
                with urllib.request.urlopen(req, timeout=8) as r:
                    print("  [google] %-40s %s" % (n, json.loads(r.read()).get("delay")))
            except Exception as e:
                print("  [google] %-40s 失败 %s" % (n, type(e).__name__))
    else:
        good.sort(key=lambda x: x[1])
        print()
        print("最快可用:", good[0][0], good[0][1], "ms")


if __name__ == "__main__":
    main()
