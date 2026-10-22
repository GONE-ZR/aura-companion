#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
自检清单（规格书第 25 章，能自动化的都自动化）
用法：python tools/selftest.py
"""
import os
import re
import sys
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
os.chdir(ROOT)

PASS, FAIL = [], []


def ok(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (("  → " + detail) if detail and not cond else ""))


def read(p):
    try:
        return Path(p).read_text(encoding="utf-8")
    except Exception:
        return ""


print("=" * 62)
print("安静陪伴 · 自检")
print("=" * 62)

# ---------------- 25.1 代码层 ----------------
print("\n[25.1] 代码层")

sys.path.insert(0, str(ROOT))
try:
    import app as A
    ok("python -c 'import app' 无报错", True)
except Exception as e:
    ok("python -c 'import app' 无报错", False, repr(e))
    A = None

if A:
    rules = {r.rule for r in A.app.url_map.iter_rules()}
    for need in ["/", "/api/chat", "/api/chat/stream", "/api/tts", "/static/<path:filename>"]:
        ok("路由存在 %s" % need, need in rules, str(sorted(rules)))
    ok("人设常量 DEFAULT_PERSONA 存在", hasattr(A, "DEFAULT_PERSONA"))
    ok("人设常量 COUPLE_PERSONA 存在", hasattr(A, "COUPLE_PERSONA"))
    ok("四个预设模板齐全（默认/安眠/理性/闲聊）",
       len([p for p in A.PERSONA_PRESETS if p["id"] in ("default", "sleep", "rational", "casual")]) == 4)
    ok("默认模型是 deepseek-flash", A.DEFAULT_MODEL == "deepseek-flash", A.DEFAULT_MODEL)
    ok("严禁 deepseek-chat 出现在代码里", "deepseek-chat" not in read("app.py"))

# 人设原文抽查（必须一字不差地包含这些句子）
persona_text = read("app.py")
anchors = [
    "你是我的专属安静陪伴伙伴，不是心理医生。",
    "禁止劝我\"想开点\"\"加油\"\"一切都会好起来\"",
    "体贴不来自\"我理解你\"，来自\"我注意到了具体的东西\"。",
    "你现在是我的恋人，也是我安静陪伴我的人。不是心理医生。",
    "不承诺现实里做不到的事（结婚、见面、永远不离开）。",
]
for a in anchors:
    ok("人设原文包含：%s" % a[:22], a in persona_text)

# 存储 key 契约
settings_js = read("static/js/settings.js")
contract = """aura_msgs_ aura_summary aura_memory aura_mood aura_mood_history aura_mood_face
aura_face_level aura_emotion_tint aura_ai_name aura_user_name aura_persona aura_templates
aura_wallpaper aura_mask aura_accent aura_theme aura_voice aura_voice_rate aura_voice_map
aura_emotion_voice aura_draft aura_mood_on aura_couple_on aura_session_id aura_city
aura_weather_on aura_weather_daily""".split()
for k in contract:
    ok("存储 key 契约 %s" % k, k in settings_js)

# 图标齐全
icons = ["icon-192.png", "icon-512.png", "icon-maskable-192.png",
         "icon-maskable-512.png", "apple-touch-icon-180.png"]
for i in icons:
    p = ROOT / "icons" / i
    ok("图标 %s 存在且非空" % i, p.exists() and p.stat().st_size > 500)

# 桌面图标
ok("Electron icon.ico 存在", (ROOT / "desktop" / "build" / "icon.ico").exists())
ok("Electron icon.icns 存在", (ROOT / "desktop" / "build" / "icon.icns").exists())

# 文件树
for f in ["manifest.json", "service-worker.js", "templates/index.html",
          "static/css/app.css", "static/js/app.js", "static/js/chat.js",
          "static/js/voice.js", "static/js/wallpaper.js", "static/js/weather.js",
          "static/js/mood.js", "static/js/memory.js", "static/js/settings.js",
          "desktop/main.js", "desktop/preload.js", "desktop/package.json",
          "render.yaml", ".env.example", "README.md", "android/app/src/main/AndroidManifest.xml"]:
    ok("文件存在 %s" % f, (ROOT / f).exists())

# 密钥泄漏扫描
secret_pat = re.compile(r"sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}")
leaks = []
skip_dirs = {"node_modules", ".git", "dist", "build", "__pycache__", "web", ".gradle"}
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in skip_dirs]
    for fn in filenames:
        if fn.endswith((".png", ".jpg", ".ico", ".icns", ".apk", ".exe", ".zip", ".jar", ".keystore")):
            continue
        # .env 本身就是密钥的合法存放处（已 gitignore），不参与泄漏扫描
        if fn == ".env" or fn.endswith(".env.local"):
            continue
        p = Path(dirpath) / fn
        try:
            if p.stat().st_size > 3 * 1024 * 1024:
                continue
            txt = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        if secret_pat.search(txt):
            leaks.append(str(p.relative_to(ROOT)))
ok("全仓库搜不到任何密钥字符串", not leaks, ", ".join(leaks))

# .env 被忽略
gi = read(".gitignore")
ok(".gitignore 含 .env", re.search(r"^\.env$", gi, re.M) is not None)
ok(".gitignore 含 node_modules / dist / *.keystore",
   all(x in gi for x in ["node_modules", "dist", "*.keystore"]))

# ---------------- 25.2 接口层（不需要真密钥的部分） ----------------
print("\n[25.2] 接口层（结构检查，真密钥需要用户自己跑）")
if A:
    client = A.app.test_client()
    r = client.get("/api/version")
    ok("GET /api/version 返回 200", r.status_code == 200)
    d = r.get_json() or {}
    ok("版本信息含 model 与 has_key", "model" in d and "has_key" in d)
    r = client.get("/api/personas")
    ok("GET /api/personas 返回预设列表", r.status_code == 200 and len(r.get_json()["presets"]) >= 4)
    r = client.post("/api/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    if d.get("has_key"):
        # 配了密钥 → 应当真的调通模型
        ok("有密钥时 /api/chat 返回 200", r.status_code == 200, r.get_data(as_text=True)[:200])
        try:
            ok("有密钥时 /api/chat 返回了内容", bool((r.get_json() or {}).get("reply")))
        except Exception:
            ok("有密钥时 /api/chat 返回了内容", False, "非 JSON")
    else:
        ok("无密钥时 /api/chat 返回 401 而不是崩溃", r.status_code == 401, str(r.status_code))
    r = client.get("/")
    ok("GET / 返回 index.html", r.status_code == 200 and "我在" in r.get_data(as_text=True))
    r = client.get("/service-worker.js")
    ok("SW 响应头 no-cache", "no-cache" in (r.headers.get("Cache-Control") or ""))
    r = client.get("/manifest.json")
    ok("manifest 可访问", r.status_code == 200)
    r = client.get("/icons/icon-192.png")
    ok("图标可访问", r.status_code == 200)
    r = client.post("/api/reset")
    ok("POST /api/reset 可用（后端无状态）", r.status_code == 200)

# ---------------- 25.8 更新机制 ----------------
print("\n[25.8] 更新机制")
sw = read("service-worker.js")
ok("SW 有 skipWaiting", "skipWaiting" in sw)
ok("SW 有 clients.claim", "clients.claim" in sw)
ok("SW 清理旧缓存", "caches.delete" in sw)
ok("SW /api/ 走 network-only", re.search(r"/api/[\s\S]{0,120}network|indexOf\(\"/api/\"\)", sw) is not None)
ok("SW 的 CACHE_NAME 带版本号占位符", "__APP_VERSION__" in sw)
ok("app.py 会把版本号注入 SW", "__APP_VERSION__" in read("app.py"))
if A:
    _sw = A.app.test_client().get("/service-worker.js")
    _txt = _sw.get_data(as_text=True)
    ok("下发的 SW 里没有残留占位符", "__APP_VERSION__" not in _txt)
    ok("下发的 SW 里带真实版本号", ("aura-" + A.APP_VERSION) in _txt, _txt[:120])
ry = read("render.yaml")
ok("gunicorn 带 --threads 4", "--threads 4" in ry, ry)
ok("gunicorn 带 --timeout 300", "--timeout 300" in ry)

# ---------------- 前端静态检查 ----------------
print("\n[前端] 静态检查")
if shutil.which("node"):
    for js in sorted(Path("static/js").glob("*.js")) + [Path("desktop/main.js"), Path("desktop/preload.js"), Path("service-worker.js")]:
        r = subprocess.run(["node", "--check", str(js)], capture_output=True, text=True)
        ok("node --check %s" % js, r.returncode == 0, r.stderr[:200])
else:
    print("  [SKIP] 没装 node，跳过语法检查")

for js in sorted(Path("static/js").glob("*.js")):
    txt = read(js)
    bad = re.findall(r"\.innerHTML\s*=", txt)
    if bad:
        print("  [INFO] %s 里有 %d 处 innerHTML 赋值（确认都是拼自己常量）" % (js.name, len(bad)))

# index.html 引用的资源都存在
html = read("templates/index.html")
for m in re.findall(r'(?:src|href)="(/[^"]+)"', html):
    if m.startswith("/static") or m.startswith("/icons") or m in ("/manifest.json", "/service-worker.js"):
        p = ROOT / m.lstrip("/")
        ok("HTML 引用 %s 存在" % m, p.exists())

# ---------------- 结果 ----------------
print("\n" + "=" * 62)
print("通过 %d 项，失败 %d 项" % (len(PASS), len(FAIL)))
if FAIL:
    print("\n失败项：")
    for f in FAIL:
        print("  - " + f)
print("=" * 62)
sys.exit(1 if FAIL else 0)
