# -*- coding: utf-8 -*-
"""检查 Chrome 密码库里有没有 github.com 的已存凭据（只看条目，不解出密码）"""
import io
import shutil
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

for name in ["Login Data", "Login Data For Account"]:
    p = Path(r"D:\tools\chrome-profile\Default") / name
    if not p.exists():
        continue
    tmp = Path(tempfile.gettempdir()) / ("ld_%s.db" % name.replace(" ", "_"))
    shutil.copy2(p, tmp)
    con = sqlite3.connect(str(tmp))
    rows = con.execute(
        "select origin_url, username_value, length(password_value) from logins "
        "where origin_url like '%github%' or signon_realm like '%github%'").fetchall()
    con.close()
    print("[%s] github 条目 %d 条" % (name, len(rows)))
    for r in rows:
        print("    origin=%s  username=%s  password长度=%s" % (r[0], r[1], r[2]))
    allrows = con.execute("select count(*) from logins").fetchall() if False else None
