# -*- coding: utf-8 -*-
"""八色表：合成对比度（按 0.05 递增求最小达标 alpha）+ 两两 ΔE（CIE76 与 CIEDE2000）"""
import io
import sys
import math
import json

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

LIGHT = {
    "soft": ("#D6A063", "暖/蜜杏"),
    "smile": ("#D98E3F", "暖/暖琥珀"),
    "calm": ("#1A1A1A", "墨"),
    "low": ("#5B6B7A", "冷/灰蓝"),
    "tired": ("#857C8C", "冷/雾灰紫"),
    "blank": ("#6E7276", "冷/冷灰"),
    "sulky": ("#C9504A", "红/强调红"),
    "serious": ("#8E3B3B", "红/深绛"),
}
DARK = {
    "soft": "#D8A56B", "smile": "#E09A4E", "calm": "#F0EDE6", "low": "#8FA1B2",
    "tired": "#9C93A2", "blank": "#8B8F93", "sulky": "#D96761", "serious": "#B85C5C",
}
FAMILY = {
    "soft": "暖", "smile": "暖", "calm": "墨", "low": "冷", "tired": "冷",
    "blank": "冷", "sulky": "红", "serious": "红",
}
BG_LIGHT = {"warm": "#FDF6E8", "dusk": "#FBE8D3", "cool": "#E9EEF2", "gray": "#E4E6E8"}
BG_DARK = {"warm": "#2A2E33", "dusk": "#332C26", "cool": "#252B31", "gray": "#2C2C2C"}


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lum(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2])


def ratio(a, b):
    la, lb = lum(a), lum(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)


def comp(fg, bg, a):
    return tuple(round(f * a + b * (1 - a)) for f, b in zip(fg, bg))


def to_lab(c):
    def f(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = f(c[0]), f(c[1]), f(c[2])
    x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
    y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0
    z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883

    def g2(t):
        return t ** (1 / 3) if t > 0.008856 else 7.787 * t + 16 / 116
    fx, fy, fz = g2(x), g2(y), g2(z)
    return (116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz))


def de76(a, b):
    la, lb = to_lab(rgb(a)), to_lab(rgb(b))
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(la, lb)))


def de2000(a, b):
    L1, a1, b1 = to_lab(rgb(a))
    L2, a2, b2 = to_lab(rgb(b))
    C1 = math.hypot(a1, b1)
    C2 = math.hypot(a2, b2)
    Cb = (C1 + C2) / 2
    G = 0.5 * (1 - math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7))) if Cb else 0
    a1p, a2p = (1 + G) * a1, (1 + G) * a2
    C1p, C2p = math.hypot(a1p, b1), math.hypot(a2p, b2)
    h1p = math.degrees(math.atan2(b1, a1p)) % 360 if C1p else 0
    h2p = math.degrees(math.atan2(b2, a2p)) % 360 if C2p else 0
    dL = L2 - L1
    dC = C2p - C1p
    if C1p * C2p == 0:
        dh = 0
    else:
        dh = h2p - h1p
        if dh > 180: dh -= 360
        elif dh < -180: dh += 360
    dH = 2 * math.sqrt(C1p * C2p) * math.sin(math.radians(dh) / 2)
    Lb = (L1 + L2) / 2
    Cbp = (C1p + C2p) / 2
    if C1p * C2p == 0:
        hb = h1p + h2p
    else:
        if abs(h1p - h2p) <= 180:
            hb = (h1p + h2p) / 2
        elif h1p + h2p < 360:
            hb = (h1p + h2p + 360) / 2
        else:
            hb = (h1p + h2p - 360) / 2
    T = (1 - 0.17 * math.cos(math.radians(hb - 30)) + 0.24 * math.cos(math.radians(2 * hb))
         + 0.32 * math.cos(math.radians(3 * hb + 6)) - 0.20 * math.cos(math.radians(4 * hb - 63)))
    dth = 30 * math.exp(-(((hb - 275) / 25) ** 2))
    Rc = 2 * math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7)) if Cbp else 0
    Sl = 1 + 0.015 * (Lb - 50) ** 2 / math.sqrt(20 + (Lb - 50) ** 2)
    Sc = 1 + 0.045 * Cbp
    Sh = 1 + 0.015 * Cbp * T
    Rt = -math.sin(math.radians(2 * dth)) * Rc
    return math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh))


def solve_alpha(fg, bg):
    """基准 0.70，按 0.05 递增到 0.95；返回 (alpha, ratio)"""
    a = 0.70
    while a <= 0.9501:
        c = comp(rgb(fg), rgb(bg), a)
        r = ratio(c, rgb(bg))
        if r >= 2.2:
            return round(a, 2), round(r, 2)
        a += 0.05
    a = 0.95
    return a, round(ratio(comp(rgb(fg), rgb(bg), a), rgb(bg)), 2)


def matrix_report(palette, bgs, mode):
    print("\n===== %s =====" % mode)
    rows = []
    for name, fg in palette.items():
        if isinstance(fg, tuple):
            fg = fg[0]
        for bg_name, bg in bgs.items():
            a, r = solve_alpha(fg, bg)
            rows.append((name, bg_name, fg, a, r))
    print("  %-8s %-5s %-8s %-5s %s" % ("状态", "背景", "色", "alpha", "对比度"))
    worst = 99
    for name, bg_name, fg, a, r in rows:
        flag = "" if r >= 2.2 else "  ← 不达标"
        worst = min(worst, r)
        print("  %-8s %-5s %-8s %-5s %.2f%s" % (name, bg_name, fg, a, r, flag))
    print("  最低 = %.2f" % worst)
    return rows, worst


def pair_report(palette, mode):
    keys = list(palette.keys())
    print("\n----- %s 两两 ΔE -----" % mode)
    print("      " + " ".join("%6s" % k[:6] for k in keys))
    min_inter, max_intra = 99, 0
    for k1 in keys:
        line = "%6s" % k1[:6]
        for k2 in keys:
            if k1 == k2:
                line += "      -"
                continue
            v = de2000(palette[k1] if not isinstance(palette[k1], tuple) else palette[k1][0],
                       palette[k2] if not isinstance(palette[k2], tuple) else palette[k2][0])
            line += "%7.1f" % v
            if FAMILY[k1] == FAMILY[k2]:
                max_intra = max(max_intra, v)
            else:
                min_inter = min(min_inter, v)
        print(line)
    print("  族内最大 ΔE2000 = %.1f（要求 ≤8）" % max_intra)
    print("  族间最小 ΔE2000 = %.1f（要求 ≥12）" % min_inter)
    return min_inter, max_intra


LIGHT_SIMPLE = {k: v[0] for k, v in LIGHT.items()}
rowsL, worstL = matrix_report(LIGHT_SIMPLE, BG_LIGHT, "浅色 8 色 × 4 背景")
rowsD, worstD = matrix_report(DARK, BG_DARK, "深色 8 色 × 4 背景")
iL, aL = pair_report(LIGHT_SIMPLE, "浅色")
iD, aD = pair_report(DARK, "深色")

print("\n===== 汇总 =====")
print("浅色最低对比度 %.2f / 深色最低对比度 %.2f" % (worstL, worstD))
print("浅色 族间最小ΔE %.1f / 族内最大ΔE %.1f" % (iL, aL))
print("深色 族间最小ΔE %.1f / 族内最大ΔE %.1f" % (iD, aD))

json.dump({"light": rowsL, "dark": rowsD, "de": {"light": [iL, aL], "dark": [iD, aD]}},
          open("palette-metrics.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
