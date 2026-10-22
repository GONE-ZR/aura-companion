#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""统一控制台初始化 —— 只能包一次。

坑（2026-10-22 实测）：launch.py / tunnel_qr.py / lan_info.py 各自执行
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, ...)
结果：第二个 wrapper 又包了同一个底层 buffer，任一 wrapper 被回收 → 底层 buffer 被 close
→ 另一个再 print 就炸 "ValueError: I/O operation on closed file"。

所以：统一走这里，用 sys 上的标记位保证只包一次。
"""
import io
import sys

_FLAG = "_aura_utf8_stdout"


def setup():
    """把 stdout/stderr 换成 UTF-8 + 行缓冲（只生效一次）"""
    if getattr(sys, _FLAG, False):
        return
    try:
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
        sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8",
                                      errors="replace", line_buffering=True)
    except Exception:
        # 没有 buffer（被重定向成 StringIO 之类）就保持原样
        pass
    setattr(sys, _FLAG, True)


setup()
