# -*- coding: utf-8 -*-
"""
通过 Clash Verge Rev 的命名管道控制器操作 mihomo
（config.yaml 里的 external-controller-pipe）
"""
import io
import json
import re
import sys
import urllib.parse
import urllib.request

if not getattr(sys.stdout, "_aura_utf8", False):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
    try:
        sys.stdout._aura_utf8 = True
    except Exception:
        pass

CFG = r"C:\Users\27748\AppData\Roaming\io.github.clash-verge-rev.clash-verge-rev\config.yaml"


def read_cfg():
    txt = open(CFG, encoding="utf-8").read()
    pipe = re.search(r"external-controller-pipe:\s*'?([^'\r\n]+)'?", txt)
    secret = re.search(r"secret:\s*(\S+)", txt)
    name = pipe.group(1).strip() if pipe else None
    # 实际管道名带 "production" 且每次启动都变 —— 直接问系统要当前活着的那个
    try:
        import os
        import glob
        live = []
        for d in glob.glob(r"\\.\pipe\*"):
            if "verge-mihomo" in d:
                live.append(d)
        # glob 对 \\.\pipe 支持有限，退回用 os.listdir
        if not live:
            import ctypes
            buf = ctypes.create_unicode_buffer(32768)
            ctypes.windll.kernel32.GetNamedPipeInfo  # 触发导入
            for d in os.listdir(r"\\.\pipe"):
                if "verge-mihomo" in d:
                    live.append(r"\\.\pipe\\" + d)
        if live:
            name = live[0]
    except Exception:
        pass
    return (name, secret.group(1).strip() if secret else "")


def pipe_request(pipe, method, path, body=None):
    import win32pipe, win32file
    handle = win32file.CreateFile(
        pipe, win32file.GENERIC_READ | win32file.GENERIC_WRITE, 0, None,
        win32file.OPEN_EXISTING, 0, None)
    try:
        req = "%s %s HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer %s\r\n" % (method, path, SECRET)
        req += "Content-Type: application/json\r\nContent-Length: %d\r\nConnection: close\r\n\r\n" % (
            len(body) if body else 0)
        if body:
            req += body
        win32file.WriteFile(handle, req.encode("utf-8"))
        chunks = []
        while True:
            try:
                rc, data = win32file.ReadFile(handle, 65536)
            except Exception:
                break
            if not data:
                break
            chunks.append(data)
            if b"\r\n0\r\n\r\n" in b"".join(chunks):
                break
        raw = b"".join(chunks)
    finally:
        handle.Close()
    head, _, payload = raw.partition(b"\r\n\r\n")
    status = head.split(b"\r\n")[0].decode("latin1")
    # chunked?
    if b"Transfer-Encoding: chunked" in head:
        out, data = b"", payload
        while True:
            line, _, rest = data.partition(b"\r\n")
            try:
                size = int(line.strip(), 16)
            except Exception:
                break
            if size == 0:
                break
            out += rest[:size]
            data = rest[size + 2:]
        payload = out
    try:
        return status, json.loads(payload.decode("utf-8")) if payload.strip() else {}
    except Exception:
        return status, payload.decode("utf-8", "replace")


PIPE, SECRET = read_cfg()
print("管道:", PIPE, "| secret:", SECRET)


def api(method, path, body=None):
    st, data = pipe_request(PIPE, method, path, json.dumps(body) if body is not None else None)
    return data


def main():
    try:
        print("版本:", api("GET", "/version"))
    except Exception as e:
        print("管道请求失败:", e)
        return

    cfg = api("GET", "/configs")
    print("当前模式:", cfg.get("mode"), "| 允许局域网:", cfg.get("allow-lan"))

    proxies = api("GET", "/proxies")
    groups = {k: v for k, v in proxies.get("proxies", {}).items()
              if v.get("type") in ("Selector", "URLTest", "Fallback", "LoadBalance")}
    print("\n策略组:")
    for name, g in groups.items():
        print("  %-24s 现在=%-28s 共 %d 个" % (name, g.get("now"), len(g.get("all", []))))

    print("\n测各节点到 github.com 的延迟：")
    ok = []
    for gname, g in groups.items():
        for n in g.get("all", []):
            try:
                q = urllib.parse.urlencode({"url": "https://github.com/", "timeout": 5000})
                st, d = pipe_request(PIPE, "GET", "/proxies/%s/delay?%s" % (urllib.parse.quote(n), q))
                if isinstance(d, dict) and d.get("delay"):
                    ok.append((n, d["delay"], gname))
                    print("  ✅ %-44s %6d ms  (组:%s)" % (n, d["delay"], gname))
            except Exception:
                pass
    ok.sort(key=lambda x: x[1])
    print("\n最快可用节点:", ok[:3] if ok else "无")


if __name__ == "__main__":
    main()
