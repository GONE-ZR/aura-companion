#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成全套图标（PWA / Electron / Android）
用法：python tools/make_icons.py
产物：
  icons/icon-192.png icon-512.png icon-maskable-192.png icon-maskable-512.png apple-touch-icon-180.png
  desktop/build/icon.png icon.ico icon.icns
  android/app/src/main/res/mipmap-*/ic_launcher.png / ic_launcher_foreground.png
"""
import os
import struct
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
DESKTOP_BUILD = ROOT / "desktop" / "build"
ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"

# 5 套配色（规格 21.5）
SCHEMES = {
    "green":  ("#8CA6A0", "#5E7A74"),
    "warm":   ("#B0A79E", "#8A8177"),
    "blue":   ("#90A4B0", "#6D8391"),
    "rose":   ("#C0A0A0", "#977878"),
    "violet": ("#9A9AB0", "#767690"),
}


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def hex2rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def vertical_gradient(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        d.point((0, y), fill=lerp(top, bottom, y / max(1, h - 1)))
    return img.resize((w, h), Image.BILINEAR)


def radial_glow(size, center, radius, color, alpha):
    """返回一张带柔和光晕的 RGBA 图层"""
    layer = Image.new("RGBA", size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    steps = 48
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        a = int(alpha * (1 - t) ** 2)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r],
                  fill=(color[0], color[1], color[2], a))
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.12))


def make_orb(size, fg_rgb, bg_rgb, orb_ratio=0.46, rounded=True, bleed=False):
    """画一个安静的柔光球 + 一弯月牙"""
    w = h = size
    base = vertical_gradient((w, h), fg_rgb, bg_rgb).convert("RGBA")

    if rounded and not bleed:
        # 圆角方底
        mask = Image.new("L", (w, h), 0)
        ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=int(w * 0.22), fill=255)
        base.putalpha(mask)

    # 柔光
    glow = radial_glow((w, h), (w * 0.5, h * 0.46), w * 0.42, (255, 255, 255), 120)
    base = Image.alpha_composite(base, glow)

    # 主球
    r = w * orb_ratio / 2
    cx, cy = w * 0.5, h * 0.46
    d = ImageDraw.Draw(base)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 235))

    # 内侧阴影（做出柔和的立体感，不是硬边）
    shade = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ds = ImageDraw.Draw(shade)
    ds.ellipse([cx - r * 1.02, cy - r * 1.02, cx + r * 1.02, cy + r * 1.02],
               fill=bg_rgb + (120,))
    shade = shade.filter(ImageFilter.GaussianBlur(r * 0.22))
    # 只保留球内区域
    inside = Image.new("L", (w, h), 0)
    ImageDraw.Draw(inside).ellipse([cx - r, cy - r, cx + r, cy + r], fill=255)
    base = Image.alpha_composite(base, Image.composite(shade, Image.new("RGBA", (w, h)), inside))

    # 高光
    hi = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(hi).ellipse([cx - r * 0.55, cy - r * 0.62, cx - r * 0.02, cy - r * 0.14],
                               fill=(255, 255, 255, 190))
    base = Image.alpha_composite(base, hi.filter(ImageFilter.GaussianBlur(r * 0.16)))

    return base


def save_png(img, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "PNG")
    return path


def write_icns(png_path, icns_path, sizes=((16, "icp4"), (32, "icp5"), (64, "icp6"), (128, "ic07"),
                                           (256, "ic08"), (512, "ic09"), (1024, "ic10"))):
    """用 PNG 拼一个 icns（Apple 支持 PNG 负载）"""
    entries = []
    for size, code in sizes:
        im = Image.open(png_path).convert("RGBA").resize((size, size), Image.LANCZOS)
        import io
        buf = io.BytesIO()
        im.save(buf, "PNG")
        data = buf.getvalue()
        entries.append((code, data))
    body = b""
    for code, data in entries:
        body += code.encode("ascii") + struct.pack(">I", len(data) + 8) + data
    out = b"icns" + struct.pack(">I", len(body) + 8) + body
    icns_path.parent.mkdir(parents=True, exist_ok=True)
    icns_path.write_bytes(out)
    return icns_path


def main():
    fg, bg = SCHEMES["green"]
    frgb, brgb = hex2rgb(fg), hex2rgb(bg)

    # PWA
    save_png(make_orb(192, frgb, brgb), ICONS / "icon-192.png")
    save_png(make_orb(512, frgb, brgb), ICONS / "icon-512.png")
    # maskable：满幅底 + 小图（安全区）
    save_png(make_orb(192, frgb, brgb, orb_ratio=0.30, rounded=False, bleed=True),
             ICONS / "icon-maskable-192.png")
    save_png(make_orb(512, frgb, brgb, orb_ratio=0.30, rounded=False, bleed=True),
             ICONS / "icon-maskable-512.png")
    # apple-touch-icon 必须不透明（21.3）
    save_png(make_orb(180, frgb, brgb, rounded=False, bleed=True),
             ICONS / "apple-touch-icon-180.png")

    # Electron
    src = make_orb(1024, frgb, brgb)
    save_png(src, DESKTOP_BUILD / "icon.png")
    src.save(DESKTOP_BUILD / "icon.ico", format="ICO",
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    write_icns(DESKTOP_BUILD / "icon.png", DESKTOP_BUILD / "icon.icns")

    # Android：5 套配色 × 5 个密度
    mip = {
        "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192
    }
    for name, (c_fg, c_bg) in SCHEMES.items():
        f, b = hex2rgb(c_fg), hex2rgb(c_bg)
        for dpi, size in mip.items():
            out = ANDROID_RES / ("mipmap-" + dpi)
            # 传统图标（每个配色一套，供 activity-alias 切换）
            legacy = make_orb(size, f, b, rounded=True)
            save_png(legacy, out / ("ic_launcher_%s.png" % name))
            # 圆形版
            circ = make_orb(size, f, b, rounded=False, bleed=True)
            mask = Image.new("L", (size, size), 0)
            ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
            circ.putalpha(mask)
            save_png(circ, out / ("ic_launcher_%s_round.png" % name))
            # 自适应图标的前景层（透明底，图形居中，留 66dp 安全区）
            fgim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
            d = ImageDraw.Draw(fgim)
            r = size * 0.17
            d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=(255, 255, 255, 240))
            save_png(fgim, out / ("ic_launcher_%s_fg.png" % name))
            # 背景层（纯色）
            bgim = Image.new("RGB", (size, size), b)
            save_png(bgim, out / ("ic_launcher_%s_bg.png" % name))

    # 默认图标（灰绿）
    for dpi, size in mip.items():
        out = ANDROID_RES / ("mipmap-" + dpi)
        save_png(make_orb(size, *map(hex2rgb, SCHEMES["green"]), rounded=True), out / "ic_launcher.png")
        circ = make_orb(size, *map(hex2rgb, SCHEMES["green"]), rounded=False, bleed=True)
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, size - 1, size - 1], fill=255)
        circ.putalpha(mask)
        save_png(circ, out / "ic_launcher_round.png")
        fgim = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        d = ImageDraw.Draw(fgim)
        r = size * 0.17
        d.ellipse([size / 2 - r, size / 2 - r, size / 2 + r, size / 2 + r], fill=(255, 255, 255, 240))
        save_png(fgim, out / "ic_launcher_foreground.png")
        save_png(Image.new("RGB", (size, size), hex2rgb(SCHEMES["green"][1])), out / "ic_launcher_background.png")

    # 自适应图标描述
    anydpi = ANDROID_RES / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n', encoding="utf-8")
    (anydpi / "ic_launcher_round.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
        '    <background android:drawable="@mipmap/ic_launcher_background"/>\n'
        '    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>\n'
        '</adaptive-icon>\n', encoding="utf-8")

    print("icons done")


if __name__ == "__main__":
    main()
