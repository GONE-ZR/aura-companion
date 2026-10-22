# -*- coding: utf-8 -*-
"""bake —— 把局域网验证通过的配置固化进包体（第七篇 §5）

拦截三条（§5.1）：
  · lanUrl / assetBaseUrl     固化进包体 = 每个用户都在请求你家路由器
  · killSwitch: true          固化了就是把全站关掉装进包里
  · rollout                   运行时决策，不属于默认值

用法：python tools/bake.py [源文件]（默认 remote/config.json）
"""
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(r"D:\opencode workspace\aura-companion")
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "remote" / "config.json"
DST = ROOT / "static" / "config.bundled.json"


def fail(msg):
    print("✗ " + msg)
    sys.exit(1)


def main():
    try:
        c = json.loads(SRC.read_text(encoding="utf-8"))
    except Exception as e:
        fail("源配置读不出来：%s" % e)

    if c.get("schemaVersion") != 1:
        fail("schemaVersion 必须为 1（现在是 %r）" % c.get("schemaVersion"))
    if not isinstance(c.get("configVersion"), int):
        fail("configVersion 必须是整数")
    if c.get("configVersion") < 1:
        fail("configVersion 必须 ≥ 1")

    # 2. 剥掉开发期字段
    c.pop("note", None)
    c.pop("rollout", None)
    c.pop("lanUrl", None)
    if isinstance(c.get("appearance"), dict):
        c["appearance"].pop("assetBaseUrl", None)

    # 3. killSwitch 不许固化
    if (c.get("features") or {}).get("killSwitch"):
        fail("killSwitch=true 不能固化进包体（一发版就是全站关闭）")

    # lanUrl 残留检查（剥完还有就说明结构变了）
    raw = json.dumps(c, ensure_ascii=False)
    for bad in ("lanUrl", "assetBaseUrl", "rollout"):
        if bad in raw:
            fail("配置里仍残留开发字段：%s" % bad)

    DST.write_text(json.dumps(c, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("✓ 已固化 configVersion=%s → %s" % (c["configVersion"], DST.relative_to(ROOT)))
    print("  下一步：node tools/check_assets.js  （缺图会让构建失败）")


if __name__ == "__main__":
    main()
