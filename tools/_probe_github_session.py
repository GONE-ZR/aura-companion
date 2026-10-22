# -*- coding: utf-8 -*-
"""
检查本机浏览器里是否存在已登录的 GitHub 会话（只读，不打印 cookie 明文）
用于：判断能否由 Agent 全自动完成「建仓 + 推送」。
支持 Chrome / Edge（Windows DPAPI + AES-GCM 解密）。
"""
import ctypes
import io
import json
import os
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BROWSERS = {
    "Chrome": Path(os.environ["LOCALAPPDATA"]) / "Google/Chrome/User Data/Default",
    "Edge": Path(os.environ["LOCALAPPDATA"]) / "Microsoft/Edge/User Data/Default",
}


class DATA_BLOB(ctypes.Structure):
    _fields_ = [("cbData", ctypes.c_uint32), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def dpapi_decrypt(blob: bytes) -> bytes:
    """Windows DPAPI 解密（用 pywin32，最省事）"""
    import win32crypt
    return win32crypt.CryptUnprotectData(blob, None, None, None, 0)[1]


def chrome_key(profile: Path):
    """从 Local State 取 AES 主密钥"""
    import base64
    ls = profile.parent / "Local State"
    if not ls.exists():
        return None
    data = json.loads(ls.read_text(encoding="utf-8"))
    enc = data.get("os_crypt", {}).get("encrypted_key")
    if not enc:
        return None
    raw = base64.b64decode(enc)
    if raw[:5] == b"v10":
        raw = raw[5:]
    return dpapi_decrypt(raw)


def decrypt_value(key, host_key, value):
    import base64
    if value[:3] in (b"v10", b"v11"):
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        raw = base64.b64decode(value[3:])
        nonce, ct = raw[:12], raw[12:]
        aes = AESGCM(key)
        return aes.decrypt(nonce, ct, host_key)
    return value


def main():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa
    except Exception:
        print("缺少 cryptography，先装")
        return
    try:
        import win32crypt  # noqa
    except Exception:
        pass

    for name, profile in BROWSERS.items():
        ck = profile / "Network/Cookies"
        if not ck.exists():
            ck = profile / "Cookies"
        if not ck.exists():
            print("[%s] 没有 cookie 库" % name)
            continue
        tmp = Path(tempfile.gettempdir()) / ("ck_%s.db" % name)
        try:
            shutil.copy2(ck, tmp)
        except Exception as e:
            print("[%s] 复制 cookie 库失败：%s（浏览器在运行且文件被锁）" % (name, e))
            continue
        key = chrome_key(profile)
        con = sqlite3.connect(str(tmp))
        rows = con.execute(
            "select host_key, name, value, encrypted_value from cookies where host_key like '%github%'").fetchall()
        con.close()
        print("[%s] github 相关 cookie %d 条" % (name, len(rows)))
        names = {}
        for host, cname, value, enc in rows:
            names[cname] = (host, len(value or ""), len(enc or b""))
            if key and enc:
                try:
                    plain = decrypt_value(key, host.encode(), enc)
                    names[cname] = (host, len(plain), "decrypt_ok")
                except Exception as e:
                    names[cname] = (host, 0, "decrypt_fail:%s" % type(e).__name__)
        for cname, info in names.items():
            print("    %-34s %s" % (cname, info))
        has_session = any(n in names for n in
                          ("user_session", "__Host-user_session_same_site", "user_session_csrf_token"))
        print("    => 已登录 GitHub：%s" % ("是" if has_session else "否"))


if __name__ == "__main__":
    main()
