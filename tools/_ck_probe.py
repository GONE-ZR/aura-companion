# -*- coding: utf-8 -*-
"""检查复制出来的 Chrome 资料里有没有 github 的 cookie（只看名字，不打印值）"""
import io
import sqlite3
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
p = Path(r"D:\tools\chrome-profile\Default\Network\Cookies")
print("cookies 存在:", p.exists(), p.stat().st_size if p.exists() else 0)
if p.exists():
    con = sqlite3.connect(str(p))
    rows = con.execute("select host_key, name from cookies where host_key like '%github%'").fetchall()
    con.close()
    print("github cookie 条数:", len(rows))
    for r in rows[:10]:
        print("   ", r)
