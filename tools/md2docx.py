#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Markdown → Word（.docx）通用转换器。

为什么自己写：项目里的文档都是 Markdown，但交付/答辩需要 Word。
自己写一份，保证 **Markdown 是唯一数据源**，Word 随时能重新生成，
不会出现"改了 md 忘了改 docx"的不一致。

用法：
    python tools/md2docx.py "docs/安静陪伴-软件开发应用说明.md"
    python tools/md2docx.py docs/xxx.md docs/输出.docx

支持语法：
    # / ## / ### / ####     标题
    **粗体**                行内加粗
    `代码`                  行内代码
    - / * 开头的无序列表
    1. 开头的有序列表
    | a | b |               表格（第二行是 |---|---| 分隔行）
    ``` 围栏代码块
    > 引用
    ---                     分隔线
    普通段落

生成的样式：微软雅黑 / 正文 10.5pt / 行距 1.5 / 标题分级加粗 / 表格带边框 / 代码灰底等宽。
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm, Emu

ROOT = Path(__file__).resolve().parent.parent

ACCENT = RGBColor(0x2F, 0x5D, 0x4F)   # 标题色（深绿）
DIM = RGBColor(0x55, 0x5D, 0x5A)      # 次要文字
CODE_BG = "F2F3F3"                    # 代码块底色
HEAD_BG = "EEF2F0"                    # 表头底色

CN_FONT = "微软雅黑"
MONO_FONT = "Consolas"


# ───────────────────────────── 字体与小工具

def set_font(run, name=CN_FONT, size=None, bold=None, color=None, italic=None):
    run.font.name = name
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), name)
    rfonts.set(qn("w:ascii"), name)
    rfonts.set(qn("w:hAnsi"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if italic is not None:
        run.font.italic = italic
    if color is not None:
        run.font.color.rgb = color


def shade(element, hex_color: str):
    """给段落/单元格加底色。"""
    pr = element.get_or_add_tcPr() if hasattr(element, "get_or_add_tcPr") else element.get_or_add_pPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_color)
    pr.append(shd)


def add_rich(paragraph, text: str, size=10.5, color=None, base_bold=False):
    """处理 **粗体** 和 `代码`，其余按普通文字。"""
    pattern = re.compile(r"(\*\*.+?\*\*|`.+?`)")
    pos = 0
    for m in pattern.finditer(text):
        if m.start() > pos:
            r = paragraph.add_run(text[pos:m.start()])
            set_font(r, size=size, color=color, bold=base_bold)
        token = m.group(0)
        if token.startswith("**"):
            r = paragraph.add_run(token[2:-2])
            set_font(r, size=size, bold=True, color=color or RGBColor(0x1A, 0x1A, 0x1A))
        else:
            r = paragraph.add_run(token[1:-1])
            set_font(r, name=MONO_FONT, size=size - 0.5,
                     color=RGBColor(0x8A, 0x3F, 0x3F), bold=base_bold)
        pos = m.end()
    if pos < len(text):
        r = paragraph.add_run(text[pos:])
        set_font(r, size=size, color=color, bold=base_bold)


def p(doc, text="", size=10.5, color=None, bold=False, align=None,
      before=0, after=6, indent=0.0, line=1.5):
    par = doc.add_paragraph()
    pf = par.paragraph_format
    pf.space_before = Pt(before)
    pf.space_after = Pt(after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    if align is not None:
        par.alignment = align
    if text:
        add_rich(par, text, size=size, color=color, base_bold=bold)
    return par


# ───────────────────────────── 块级元素

def add_heading(doc, text, level):
    sizes = {1: 20, 2: 15, 3: 12.5, 4: 11}
    colors = {1: ACCENT, 2: ACCENT, 3: RGBColor(0x33, 0x33, 0x33), 4: RGBColor(0x33, 0x33, 0x33)}
    par = doc.add_paragraph()
    pf = par.paragraph_format
    pf.space_before = Pt(16 if level <= 2 else 10)
    pf.space_after = Pt(8 if level <= 2 else 5)
    pf.keep_with_next = True
    # Word 大纲级别，方便生成目录
    if level <= 3:
        par.style = doc.styles[f"Heading {level}"]
        pf = par.paragraph_format
        pf.space_before = Pt(16 if level <= 2 else 10)
        pf.space_after = Pt(8 if level <= 2 else 5)
        pf.keep_with_next = True
    add_rich(par, text, size=sizes.get(level, 11),
             color=colors.get(level), base_bold=True)
    if level == 1:
        par.alignment = WD_ALIGN_PARAGRAPH.LEFT
    return par

def add_code_block(doc, lines):
    for i, ln in enumerate(lines):
        par = doc.add_paragraph()
        pf = par.paragraph_format
        pf.space_before = Pt(6 if i == 0 else 0)
        pf.space_after = Pt(6 if i == len(lines) - 1 else 0)
        pf.line_spacing = 1.15
        pf.left_indent = Cm(0.4)
        shade(par._p, CODE_BG)
        r = par.add_run(ln if ln.strip() else " ")
        set_font(r, name=MONO_FONT, size=8.5, color=RGBColor(0x2B, 0x2B, 0x2B))


def add_quote(doc, text):
    par = doc.add_paragraph()
    pf = par.paragraph_format
    pf.left_indent = Cm(0.6)
    pf.space_before = Pt(4)
    pf.space_after = Pt(4)
    pf.line_spacing = 1.5
    add_rich(par, text, size=9.5, color=DIM)
    return par


def add_list_item(doc, text, ordered=False, level=0):
    par = doc.add_paragraph()
    pf = par.paragraph_format
    pf.left_indent = Cm(0.6 + 0.5 * level)
    pf.first_line_indent = Cm(-0.4)
    pf.space_before = Pt(0)
    pf.space_after = Pt(3)
    pf.line_spacing = 1.45
    prefix = "" if ordered else "· "
    if ordered:
        prefix = ""      # 有序列表由调用方把序号写进 text
    r = par.add_run(prefix)
    set_font(r, size=10.5)
    add_rich(par, text, size=10.5)
    return par


def add_table(doc, rows):
    if not rows:
        return
    cols = max(len(r) for r in rows)
    table = doc.add_table(rows=len(rows), cols=cols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = True

    for ri, row in enumerate(rows):
        for ci in range(cols):
            cell = table.cell(ri, ci)
            cell.text = ""
            par = cell.paragraphs[0]
            pf = par.paragraph_format
            pf.space_before = Pt(2)
            pf.space_after = Pt(2)
            pf.line_spacing = 1.3
            text = row[ci] if ci < len(row) else ""
            if ri == 0:
                shade(cell._tc, HEAD_BG)
                add_rich(par, text, size=9.5, base_bold=True)
            else:
                add_rich(par, text, size=9.5)
    # 表后留一点空
    doc.add_paragraph().paragraph_format.space_after = Pt(2)


def add_image(doc, src: Path, alt: str = ""):
    """插入图片：按宽高比自动缩放（最宽 13cm、最高 19cm），居中。"""
    if not src.exists():
        p(doc, "[图片缺失: %s]" % src.name, size=9.5, color=DIM)
        return
    try:
        from PIL import Image
        w, h = Image.open(src).size
        scale = min(Cm(13) / w, Cm(19) / h)
        doc.add_picture(str(src), width=Emu(int(w * scale)))
    except Exception:
        doc.add_picture(str(src), width=Cm(12))
    par = doc.paragraphs[-1]
    par.alignment = WD_ALIGN_PARAGRAPH.CENTER
    par.paragraph_format.space_before = Pt(6)
    par.paragraph_format.space_after = Pt(4)
    if alt:
        cap = doc.add_paragraph()
        cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
        cap.paragraph_format.space_after = Pt(10)
        r = cap.add_run(alt)
        set_font(r, size=9, color=DIM)


def add_hr(doc):
    par = doc.add_paragraph()
    par.paragraph_format.space_before = Pt(4)
    par.paragraph_format.space_after = Pt(4)
    pPr = par._p.get_or_add_pPr()
    pbdr = OxmlElement("w:pBdr")
    bottom = OxmlElement("w:bottom")
    bottom.set(qn("w:val"), "single")
    bottom.set(qn("w:sz"), "6")
    bottom.set(qn("w:space"), "1")
    bottom.set(qn("w:color"), "D8D8D8")
    pbdr.append(bottom)
    pPr.append(pbdr)


# ───────────────────────────── 主解析

def split_row(line: str):
    body = line.strip()
    if body.startswith("|"):
        body = body[1:]
    if body.endswith("|"):
        body = body[:-1]
    return [c.strip() for c in body.split("|")]


def is_sep_row(line: str) -> bool:
    return bool(re.match(r"^\s*\|?[\s:\-|]+\|?\s*$", line)) and "-" in line


def convert(md_path: Path, out_path: Path):
    text = md_path.read_text(encoding="utf-8")
    lines = text.splitlines()

    doc = Document()
    # 页面：A4 + 适中页边距
    sec = doc.sections[0]
    sec.top_margin = Cm(2.2)
    sec.bottom_margin = Cm(2.2)
    sec.left_margin = Cm(2.4)
    sec.right_margin = Cm(2.4)

    # 正文默认字体
    normal = doc.styles["Normal"]
    normal.font.name = CN_FONT
    normal.font.size = Pt(10.5)
    normal.element.rPr.rFonts.set(qn("w:eastAsia"), CN_FONT)

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        raw = line.rstrip()
        stripped = raw.strip()

        # 空行
        if not stripped:
            i += 1
            continue

        # 围栏代码块
        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i].rstrip())
                i += 1
            i += 1  # 跳过结束围栏
            add_code_block(doc, buf if buf else [""])
            continue

        # 图片
        m = re.match(r"^!\[([^\]]*)\]\(([^)]+)\)\s*$", stripped)
        if m:
            src = Path(m.group(2))
            if not src.is_absolute():
                src = (md_path.parent / src).resolve()
            add_image(doc, src, m.group(1))
            i += 1
            continue

        # 分隔线
        if re.match(r"^-{3,}$", stripped):
            add_hr(doc)
            i += 1
            continue

        # 标题
        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            add_heading(doc, m.group(2).strip(), len(m.group(1)))
            i += 1
            continue

        # 引用
        if stripped.startswith(">"):
            add_quote(doc, stripped.lstrip("> ").strip())
            i += 1
            continue

        # 表格
        if stripped.startswith("|") and i + 1 < n and is_sep_row(lines[i + 1]):
            rows = [split_row(stripped)]
            i += 2
            while i < n and lines[i].strip().startswith("|"):
                rows.append(split_row(lines[i]))
                i += 1
            add_table(doc, rows)
            continue

        # 列表
        m = re.match(r"^(\s*)[-*+]\s+(.*)$", raw)
        if m:
            level = len(m.group(1)) // 2
            add_list_item(doc, m.group(2).strip(), ordered=False, level=level)
            i += 1
            continue

        m = re.match(r"^(\s*)(\d+[.)])\s+(.*)$", raw)
        if m:
            level = len(m.group(1)) // 2
            add_list_item(doc, m.group(2) + " " + m.group(3).strip(),
                          ordered=True, level=level)
            i += 1
            continue

        # 普通段落
        p(doc, stripped, size=10.5, after=6)
        i += 1

    out_path.parent.mkdir(parents=True, exist_ok=True)
    doc.save(out_path)
    return out_path


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    src = Path(sys.argv[1])
    if not src.is_absolute():
        src = (Path.cwd() / src).resolve()
    if not src.exists():
        print("找不到:", src)
        sys.exit(2)
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else src.with_suffix(".docx")
    if not dst.is_absolute():
        dst = (Path.cwd() / dst).resolve()
    out = convert(src, dst)
    print(f"wrote {out}  {out.stat().st_size} bytes")


if __name__ == "__main__":
    main()
