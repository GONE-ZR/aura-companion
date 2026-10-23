# -*- coding: utf-8 -*-
"""阶段六像素验收：bbox / 顶部栏 diff / 白沟 diff / 八状态静止一致 / 2.5s 归零"""
import io
import sys
import json
from pathlib import Path
from PIL import Image, ImageChops

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
E = Path(__file__).parent / "p6-evidence"
SCALE = 4          # CSS px → 截图物理 px（dpr 2 × clip scale 2）


def load(n):
    p = E / n
    return Image.open(p).convert("RGB") if p.exists() else None


def diff_bbox(a, b):
    return ImageChops.difference(a, b).getbbox()


def count_diff(a, b, box=None):
    d = ImageChops.difference(a, b)
    if box:
        d = d.crop(box)
    px = d.load()
    n = 0
    for y in range(d.height):
        for x in range(d.width):
            if px[x, y] != (0, 0, 0):
                n += 1
    return n


out = {}
for mode in ("light", "dark"):
    st, ac, af = load("p6-%s-static.png" % mode), load("p6-%s-active.png" % mode), load("p6-%s-after.png" % mode)
    if not (st and ac and af):
        out[mode] = {"missing": True}
        continue
    W, H = st.size
    bb = diff_bbox(st, ac)
    css_bb = None if not bb else (bb[0] // SCALE, bb[1] // SCALE, (bb[2] - 1) // SCALE, (bb[3] - 1) // SCALE)
    top_band = (0, 0, W, 4 * SCALE)              # 0~2 CSS
    bar = (0, 4 * SCALE, W, 52 * SCALE)          # 4~52 CSS（顶部栏其余像素）
    out[mode] = {
        "size": [W, H],
        "bbox_px": bb,
        "bbox_css": css_bb,
        "max_bbox_y_css": None if not bb else css_bb[3],
        "topbar_diff_px": count_diff(st, ac, bar),
        "whitegap_diff_px": count_diff(st, ac, (0, 4 * SCALE, W, H)),
        "after_vs_static_px": count_diff(st, af),
        "after_vs_static_bbox": diff_bbox(st, af),
    }

# 八状态静止态一致（浅/深各 8 张互比）
for mode in ("light", "dark"):
    imgs = []
    for name in ("soft", "smile", "calm", "low", "tired", "blank", "sulky", "serious"):
        im = load("p6-static-%s-%s.png" % (mode, name))
        if im:
            imgs.append((name, im))
    if len(imgs) < 2:
        continue
    base = imgs[0][1]
    diffs = {name: count_diff(base, im) for name, im in imgs[1:]}
    out.setdefault(mode, {})["eight_state_diff"] = diffs
    out[mode]["eight_state_max_diff"] = max(diffs.values())

print(json.dumps(out, ensure_ascii=False, indent=1))
Path(__file__).with_name("out-p6-pixels.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
