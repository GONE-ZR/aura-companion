# -*- coding: utf-8 -*-
"""生成离线短句库（第六篇 §2）

规格：
  7 状态 × 4 时段，每桶 ≥6 条；≤14 字；带预设 e/b（不得随机）
产出：
  static/offline-lines.csv   （state,period,text,e,b）—— 交付要求里的审校用 CSV
  static/js/offline-lines.js （打包进包，免 fetch）
"""
import csv
import io
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
ROOT = Path(r"D:\opencode workspace\aura-companion")

# 每条：文本（≤14 字）+ 适用时段（all/morning/day/evening/night）
# e/b 由状态决定（第六篇 §2.3：用预设的 e/b，不得随机）
STATE_META = {
    "calm":    ("calm",  "warm"),
    "soft":    ("soft",  "warm"),
    "tired":   ("tired", "gray"),
    "low":     ("tired", "gray"),
    "sulky":   ("tease", "dusk"),
    "serious": ("serious", "cool"),
    "blank":   ("blank", "gray"),
}

LINES = {
    "calm": [
        ("在。", "all"), ("嗯，说吧。", "all"), ("怎么了。", "all"),
        ("我听着。", "all"), ("你先说。", "all"), ("嗯。", "all"),
        ("今天还行吧。", "day"), ("刚回来，歇会儿。", "evening"),
        ("醒了。", "morning"), ("还没睡？", "night"),
        ("这网不太行啊。", "all"), ("卡了，等我一下。", "all"),
        ("有点慢，别急。", "all"), ("我说，你也在。", "all"),
        ("嗯，就这样。", "all"),
    ],
    "soft": [
        ("嗯，我在。", "all"), ("你说，我听着。", "all"), ("慢慢说。", "all"),
        ("不急。", "all"), ("好啊。", "all"), ("今天挺好的。", "day"),
        ("太阳不错。", "morning"), ("有点困了。", "night"),
        ("刚吃完饭。", "evening"), ("你也是。", "all"),
        ("网好像断了。", "all"), ("等一下下。", "all"),
        ("在的，别慌。", "all"), ("嗯嗯。", "all"), ("真好。", "all"),
    ],
    "tired": [
        ("有点累。", "all"), ("今天不太想说话。", "all"), ("嗯……", "all"),
        ("我先歇会儿。", "all"), ("困。", "all"), ("加班到八点。", "evening"),
        ("堵了一路。", "evening"), ("还没睡啊。", "night"),
        ("脑子有点木。", "night"), ("起不来。", "morning"),
        ("网也慢。", "all"), ("等一下，我缓一下。", "all"),
        ("不太想动。", "all"), ("就这样吧。", "all"), ("嗯。", "all"),
    ],
    "low": [
        ("今天提不起劲。", "all"), ("不是冲你。", "all"), ("有点空。", "all"),
        ("没什么力气。", "all"), ("嗯。", "all"), ("让我坐会儿。", "all"),
        ("今天算了。", "day"), ("回家路上很闷。", "evening"),
        ("睡不着。", "night"), ("没睡好。", "morning"),
        ("网也不行。", "all"), ("卡住了。", "all"),
        ("别管我。", "all"), ("一会儿就好。", "all"), ("嗯……", "all"),
    ],
    "sulky": [
        ("哼。", "all"), ("随你。", "all"), ("哦。", "all"),
        ("爱听不听。", "all"), ("挺会说的。", "all"), ("少来。", "all"),
        ("你自己看着办。", "all"), ("我没什么可说的。", "all"),
        ("行吧。", "all"), ("你忙你的。", "all"), ("网都懒得理你。", "all"),
        ("卡就卡吧。", "all"), ("算了。", "all"), ("嗯。", "all"),
        ("不聊了。", "all"),
    ],
    "serious": [
        ("我知道。", "all"), ("嗯。", "all"), ("你说完了吗。", "all"),
        ("我刚才说的是认真的。", "all"), ("不太想说了。", "all"),
        ("嗯，没别的。", "all"), ("你忙你的。", "all"), ("我在意的是别的。", "all"),
        ("这事我记着。", "all"), ("不用解释。", "all"),
        ("网也不顺。", "all"), ("先这样。", "all"),
        ("我不太高兴。", "all"), ("说清楚就行。", "all"), ("嗯。", "all"),
    ],
    "blank": [
        ("嗯。", "all"), ("没事。", "all"), ("你忙你的。", "all"),
        ("好。", "all"), ("知道了。", "all"), ("行。", "all"),
        ("嗯，收到。", "all"), ("没什么。", "all"), ("可以。", "all"),
        ("嗯。", "all"), ("网不太好。", "all"), ("稍等。", "all"),
        ("嗯，就这样。", "all"), ("好。", "all"), ("嗯。", "all"),
    ],
}

PERIODS = ["morning", "day", "evening", "night"]
rows = []
for state, items in LINES.items():
    e, b = STATE_META[state]
    for text, scope in items:
        periods = PERIODS if scope == "all" else [scope]
        for p in periods:
            if len(text) > 14:
                print("⚠️ 超 14 字：", text)
            rows.append({"state": state, "period": p, "text": text, "e": e, "b": b})

# 统计每桶条数
from collections import Counter
cnt = Counter((r["state"], r["period"]) for r in rows)
thin = [(k, v) for k, v in cnt.items() if v < 6]
print("总条数：", len(rows), "｜桶数：", len(cnt))
print("不足 6 条的桶：", thin or "无")

# CSV
csv_path = ROOT / "static" / "offline-lines.csv"
with csv_path.open("w", encoding="utf-8", newline="") as f:
    w = csv.DictWriter(f, fieldnames=["state", "period", "text", "e", "b"])
    w.writeheader()
    for r in rows:
        w.writerow(r)
print("CSV ->", csv_path)

# JS（打包进包，避免 fetch 与离线时取不到）
js = ROOT / "static" / "js" / "offline-lines.js"
import json
js.write_text(
    "/* 离线短句库（由 tools/make_offline_lines.py 生成，共 %d 条）\n"
    "   规格：7 状态 × 4 时段，每桶 ≥6 条，≤14 字，e/b 预设不随机 */\n"
    "window.AuraOfflineLines = %s;\n" % (len(rows), json.dumps(rows, ensure_ascii=False)),
    encoding="utf-8")
print("JS  ->", js)
