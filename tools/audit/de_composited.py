# -*- coding: utf-8 -*-
"""ΔE 两种口径：原色 vs 合成到背景后（含 alpha）。看族内/族间是否达标。"""
import io, sys, json, math
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")


LIGHT = {"soft":"#D6A063","smile":"#D98E3F","calm":"#1A1A1A","low":"#5B6B7A",
         "tired":"#857C8C","blank":"#6E7276","sulky":"#C9504A","serious":"#8E3B3B"}
DARK = {"soft":"#D8A56B","smile":"#E09A4E","calm":"#F0EDE6","low":"#8FA1B2",
        "tired":"#9C93A2","blank":"#8B8F93","sulky":"#D96761","serious":"#B85C5C"}
FAM = {"soft":"暖","smile":"暖","calm":"墨","low":"冷","tired":"冷","blank":"冷","sulky":"红","serious":"红"}
BG_L = {"warm":"#FDF6E8","dusk":"#FBE8D3","cool":"#E9EEF2","gray":"#E4E6E8"}
BG_D = {"warm":"#2A2E33","dusk":"#332C26","cool":"#252B31","gray":"#2C2C2C"}

def rgb(h):
    h=h.lstrip("#"); return tuple(int(h[i:i+2],16) for i in (0,2,4))
def comp(f,b,a): return tuple(round(x*a+y*(1-a)) for x,y in zip(f,b))
def lab(c):
    def f(v):
        v/=255.0
        return v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4
    r,g,b=f(c[0]),f(c[1]),f(c[2])
    x=(r*0.4124+g*0.3576+b*0.1805)/0.95047
    y=(r*0.2126+g*0.7152+b*0.0722)
    z=(r*0.0193+g*0.1192+b*0.9505)/1.08883
    g2=lambda t: t**(1/3) if t>0.008856 else 7.787*t+16/116
    fx,fy,fz=g2(x),g2(y),g2(z)
    return (116*fy-16,500*(fx-fy),200*(fy-fz))
def de(a,b):
    la,lb=lab(a),lab(b); return math.sqrt(sum((x-y)**2 for x,y in zip(la,lb)))

def analyse(pal, bgs, mode, alphas):
    print("\n===== %s =====" % mode)
    for bgname,bg in bgs.items():
        comps={k:comp(rgb(v),rgb(bg),alphas.get((k,bgname),0.7)) for k,v in pal.items()}
        intra=0; inter=99; worst=None
        for a in pal:
            for b in pal:
                if a>=b: continue
                v=de(comps[a],comps[b])
                if FAM[a]==FAM[b]:
                    if v>intra: intra=v; worst=(a,b)
                else:
                    inter=min(inter,v)
        print("  背景 %-4s 族内最大 %.1f (%s) | 族间最小 %.1f" % (bgname,intra,worst,inter))

# 读数
m=json.load(open("palette-metrics.json",encoding="utf-8"))
alL={(r[0],r[1]):r[3] for r in m["light"]}
alD={(r[0],r[1]):r[3] for r in m["dark"]}
analyse(LIGHT,BG_L,"浅色（合成后）",alL)
analyse(DARK,BG_D,"深色（合成后）",alD)
