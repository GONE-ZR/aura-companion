# -*- coding: utf-8 -*-
"""GitHub 设备流：拿 OAuth 令牌（网络抖动自动重试）"""
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

CLIENT_ID = "Iv1.b507a08c87ecfe98"
SCOPE = "repo"
PROXY = os.environ.get("GITHUB_PROXY", "http://127.0.0.1:7897")
STATE = Path(r"D:\tools\gh_device_state.json")
TOKEN_FILE = Path(r"D:\tools\gh_token.txt")


def post(url, data, tries=6):
    last = None
    for i in range(tries):
        try:
            opener = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": PROXY, "https": PROXY}))
            req = urllib.request.Request(
                url, data=urllib.parse.urlencode(data).encode(),
                headers={"Accept": "application/json", "User-Agent": "aura-companion"},
                method="POST")
            with opener.open(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:
            last = e
            time.sleep(2 + i * 2)
    raise last


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "start"
    if mode == "start":
        d = post("https://github.com/login/device/code",
                 {"client_id": CLIENT_ID, "scope": SCOPE})
        STATE.write_text(json.dumps(d), encoding="utf-8")
        print("device_code:", d["device_code"])
        print("user_code  :", d["user_code"])
        print("打开这个地址并输入验证码：", d["verification_uri"])
        return
    if mode == "poll":
        d = json.loads(STATE.read_text(encoding="utf-8"))
        for i in range(90):
            try:
                r = post("https://github.com/login/oauth/access_token",
                         {"client_id": CLIENT_ID,
                          "device_code": d["device_code"],
                          "grant_type": "urn:ietf:params:oauth:grant-type:device_code"},
                         tries=3)
            except Exception as e:
                print("网络抖动，重试…", str(e)[:40])
                continue
            if "access_token" in r:
                TOKEN_FILE.write_text(r["access_token"], encoding="utf-8")
                print("✅ 拿到令牌:", TOKEN_FILE)
                print("scope:", r.get("scope"))
                return
            print("等待授权…", r.get("error") or "", "第 %d 次" % (i + 1))
            time.sleep(5)
        print("超时，没拿到令牌")


if __name__ == "__main__":
    main()
