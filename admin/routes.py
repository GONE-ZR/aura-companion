# -*- coding: utf-8 -*-
"""
后台管理路由（挂到主 app 上）
  GET  /admin                 管理页面（登录）
  POST /admin/api/login       登录
  POST /admin/api/logout      退出
  GET  /admin/api/config      读取当前配置
  POST /admin/api/config      保存配置（自动 bump 版本号；若有 GitHub 令牌则自动推送）
  POST /admin/api/icon        上传图标（PNG/JPG）
  GET  /admin/api/status      状态（版本/更新时间/推送状态）
"""
import json
import os
import subprocess
import time
from pathlib import Path

from flask import request, jsonify, send_from_directory

ROOT = Path(__file__).resolve().parent.parent
REMOTE_DIR = ROOT / "remote"
CONFIG_FILE = REMOTE_DIR / "config.json"
UPLOAD_DIR = REMOTE_DIR / "uploads"

DEFAULT_PASSWORD = "aura"


def admin_password():
    return os.environ.get("AURA_ADMIN_PASSWORD") or _dotenv_password() or DEFAULT_PASSWORD


def _dotenv_password():
    env = ROOT / ".env"
    if not env.exists():
        return ""
    try:
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("AURA_ADMIN_PASSWORD="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


def github_token():
    env = ROOT / ".env"
    if not env.exists():
        return ""
    try:
        for line in env.read_text(encoding="utf-8").splitlines():
            if line.startswith("GITHUB_PAT="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""


def read_config():
    try:
        return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def write_config(cfg):
    REMOTE_DIR.mkdir(parents=True, exist_ok=True)
    # 单一版本源：configVersion（App 的 verOf 优先读它）。
    # 旧字段 version 只做删除，不再写入 —— 两个字段各写各的会导致“保存了但 App 不生效”。
    cfg.pop("version", None)
    cfg["configVersion"] = int(read_config().get("configVersion", 0) or 0) + 1
    cfg["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    cfg.pop("updatedAt", None)          # 时间同样只留一个字段
    CONFIG_FILE.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    return cfg


def push_to_github(extra_note=""):
    """把 remote/ 目录推到 GitHub（手机靠 raw 地址拿到最新配置）"""
    tok = github_token()
    if not tok:
        return {"ok": False, "reason": "没有 GitHub 令牌（.env 里的 GITHUB_PAT）"}
    try:
        owner = "GONE-ZR"
        repo = "aura-companion"
        env = dict(os.environ)
        env["GITHUB_PAT"] = tok
        # 令牌从环境变量读，不落到命令行里
        helper = ROOT / "tools" / "_git_push_helper.py"
        if not helper.exists():
            return {"ok": False, "reason": "缺少推送脚本"}
        r = subprocess.run(
            ["python", str(helper), "remote"],
            cwd=str(ROOT), capture_output=True, text=True,
            encoding="utf-8", errors="replace", env=env, timeout=300)
        out = (r.stdout or "") + (r.stderr or "")
        return {"ok": r.returncode == 0, "log": out[-800:], "note": extra_note}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "reason": str(e)}


def register(app):
    @app.route("/admin")
    def admin_page():
        return send_from_directory(str(ROOT / "admin"), "admin.html")

    @app.route("/admin/<path:filename>")
    def admin_asset(filename):
        return send_from_directory(str(ROOT / "admin"), filename)

    @app.post("/admin/api/login")
    def admin_login():
        body = request.get_json(silent=True) or {}
        pwd = str(body.get("password") or "")
        if pwd == admin_password():
            session = request.environ.get("werkzeug.session") if False else None
            # 用一个极简签名 cookie，避免额外依赖
            from flask import make_response
            resp = make_response(jsonify({"ok": True}))
            resp.set_cookie("aura_admin", _sign("ok"), httponly=True, samesite="Lax", max_age=7 * 24 * 3600)
            return resp
        return jsonify({"ok": False, "error": "密码不对"}), 403

    @app.post("/admin/api/logout")
    def admin_logout():
        from flask import make_response
        resp = make_response(jsonify({"ok": True}))
        resp.delete_cookie("aura_admin")
        return resp

    @app.get("/admin/api/config")
    def admin_get_config():
        if not _is_admin():
            return jsonify({"error": "未登录"}), 403
        return jsonify(read_config())

    @app.post("/admin/api/config")
    def admin_save_config():
        if not _is_admin():
            return jsonify({"error": "未登录"}), 403
        body = request.get_json(silent=True) or {}
        cfg = body.get("config")
        if not isinstance(cfg, dict):
            return jsonify({"error": "配置格式不对"}), 400
        saved = write_config(cfg)
        # 保存只写本地磁盘：不再自动 git add / commit / push（配置已移出版本库）
        return jsonify({"ok": True, "config": saved, "pushed": {"ok": False, "reason": "auto-push disabled"}})

    @app.post("/admin/api/save-secret")
    def admin_save_secret():
        """把令牌写进本机 .env（.env 已被 .gitignore 排除，不会进仓库）"""
        if not _is_admin():
            return jsonify({"error": "未登录"}), 403
        body = request.get_json(silent=True) or {}
        name = str(body.get("name") or "").strip()
        value = str(body.get("value") or "").strip()
        if name not in ("GITHUB_PAT", "AURA_ADMIN_PASSWORD"):
            return jsonify({"error": "只允许这两个名字"}), 400
        env = ROOT / ".env"
        lines = []
        if env.exists():
            lines = env.read_text(encoding="utf-8").splitlines()
        found = False
        for i, ln in enumerate(lines):
            if ln.startswith(name + "="):
                lines[i] = name + "=" + value
                found = True
        if not found:
            lines.append(name + "=" + value)
        env.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return jsonify({"ok": True, "name": name})

    @app.post("/admin/api/icon")
    def admin_upload_icon():
        if not _is_admin():
            return jsonify({"error": "未登录"}), 403
        f = request.files.get("file")
        if not f:
            return jsonify({"error": "没收到文件"}), 400
        ext = (Path(f.filename or "").suffix or ".png").lower()
        if ext not in (".png", ".jpg", ".jpeg", ".webp"):
            return jsonify({"error": "只支持 png / jpg / webp"}), 400
        UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
        name = "icon-%d%s" % (int(time.time()), ext)
        p = UPLOAD_DIR / name
        f.save(str(p))
        # 同步到 downloads/ 旁边，方便直接引用
        return jsonify({
            "ok": True,
            "name": name,
            "path": "/remote/uploads/" + name,
            "url": "https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/remote/uploads/" + name,
            "local": "/remote/uploads/" + name,
        })

    @app.get("/admin/api/status")
    def admin_status():
        cfg = read_config()
        return jsonify({
            "configVersion": cfg.get("configVersion"),
            "updated_at": cfg.get("updated_at"),
            "config_exists": CONFIG_FILE.exists(),
            "has_github_token": bool(github_token()),
            "admin_password_is_default": admin_password() == DEFAULT_PASSWORD,
            "uploads": [p.name for p in UPLOAD_DIR.glob("*")] if UPLOAD_DIR.exists() else [],
        })

    @app.get("/remote/<path:filename>")
    def remote_file(filename):
        return send_from_directory(str(REMOTE_DIR), filename)


def _sign(v):
    import hashlib
    return hashlib.sha256(("aura-admin:" + str(v) + ":" + admin_password()).encode()).hexdigest()[:24]


def _is_admin():
    c = request.cookies.get("aura_admin")
    return bool(c) and c == _sign("ok")
