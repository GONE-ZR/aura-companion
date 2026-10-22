# -*- coding: utf-8 -*-
"""
后台管理接口自检（对着正在跑的服务打）
    python tests/check_admin.py
覆盖：密码校验 / 未登录拦截 / 读配置 / 存配置(版本自增) / 图标上传校验 / 远程配置可读
"""
import io
import json
import sys

import requests

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

BASE = "http://127.0.0.1:8000"
PWD = "aura"
ok = 0
bad = 0


def check(name, cond, extra=""):
    global ok, bad
    if cond:
        ok += 1
        print("  OK   %s" % name)
    else:
        bad += 1
        print("  FAIL %s  %s" % (name, extra))


def main():
    s = requests.Session()

    r = s.get(BASE + "/admin", timeout=10)
    check("管理页可访问", r.status_code == 200 and "后台管理" in r.text,
          str(r.status_code))

    r = s.get(BASE + "/admin/api/config", timeout=10)
    check("未登录读配置被拦", r.status_code == 403, str(r.status_code))

    r = s.post(BASE + "/admin/api/login", json={"password": "wrong-密码"}, timeout=10)
    check("错误密码被拒", r.status_code == 403, str(r.status_code))

    r = s.post(BASE + "/admin/api/login", json={"password": PWD}, timeout=10)
    check("正确密码可登录", r.status_code == 200 and r.json().get("ok") is True,
          r.text[:80])

    r = s.get(BASE + "/admin/api/status", timeout=10)
    st = r.json()
    check("状态接口含版本号", isinstance(st.get("version"), int), json.dumps(st)[:80])

    r = s.get(BASE + "/admin/api/config", timeout=10)
    cfg = r.json()
    check("登录后可读配置", r.status_code == 200 and "theme" in cfg and "features" in cfg)
    check("配置含 11 个功能开关", len(cfg.get("features", {})) >= 11,
          str(len(cfg.get("features", {}))))

    before = cfg.get("version", 0)
    cfg["text"]["hint"] = cfg["text"].get("hint") or "…"
    r = s.post(BASE + "/admin/api/config", json={"config": cfg}, timeout=15)
    saved = r.json()
    check("保存配置成功", r.status_code == 200 and saved.get("ok") is True, r.text[:100])
    check("版本号自增", saved.get("config", {}).get("version", 0) > before,
          "%s -> %s" % (before, saved.get("config", {}).get("version")))

    r = s.get(BASE + "/remote/config.json", timeout=10)
    pub = r.json()
    check("远程配置对外可读", r.status_code == 200 and pub.get("version") ==
          saved.get("config", {}).get("version"), str(pub.get("version")))
    check("远程配置不含敏感字段",
          not any(k in json.dumps(pub) for k in ("ghp_", "sk-", "DEEPSEEK_API_KEY")))

    r = s.post(BASE + "/admin/api/icon", timeout=10)
    check("空上传被拒", r.status_code == 400, str(r.status_code))

    r = requests.post(BASE + "/admin/api/save-secret",
                      json={"name": "EVIL", "value": "x"}, timeout=10)
    check("未登录写密钥被拦", r.status_code == 403, str(r.status_code))

    r = s.post(BASE + "/admin/api/logout", timeout=10)
    check("可退出登录", r.status_code == 200)
    r = s.get(BASE + "/admin/api/config", timeout=10)
    check("退出后重新被拦", r.status_code == 403, str(r.status_code))

    print("\n后台自检：通过 %d 项，失败 %d 项" % (ok, bad))
    return 0 if bad == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
