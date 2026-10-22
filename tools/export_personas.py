#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 app.py 导出人设模板 → static/personas.json
桌面版（Electron）与网页版共用同一份前端，Electron 没有 Flask，
所以人设模板走这个静态 JSON，避免两处各抄一份。
用法：python tools/export_personas.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

import app as A  # noqa: E402


def main():
    data = {
        "presets": A.PERSONA_PRESETS,
        "tts_guide": A.TTS_GUIDE,
        "couple_notice": A.COUPLE_NOTICE,
        "img_notice": A.IMG_NOTICE
    }
    out = ROOT / "static" / "personas.json"
    out.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out, out.stat().st_size, "bytes")


if __name__ == "__main__":
    main()
