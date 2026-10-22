#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
生成《安静陪伴 · 使用说明》Word 文档
用法：python tools/make_docx.py
产物：docs/安静陪伴-使用说明.docx
"""
import os
from pathlib import Path

from docx import Document
from docx.shared import Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "安静陪伴-使用说明.docx"

ACCENT = RGBColor(0x4F, 0x6B, 0x65)
DIM = RGBColor(0x5A, 0x62, 0x60)
WARN = RGBColor(0x8A, 0x5A, 0x5A)


def set_cn_font(run, name="微软雅黑", size=None, bold=None, color=None):
    run.font.name = name
    run._element.rPr.rFonts.set(qn("w:eastAsia"), name)
    if size is not None:
        run.font.size = Pt(size)
    if bold is not None:
        run.font.bold = bold
    if color is not None:
        run.font.color.rgb = color


def para(doc, text="", size=10.5, bold=False, color=None, align=None,
         space_before=0, space_after=6, indent=0, line=1.5):
    p = doc.add_paragraph()
    if align is not None:
        p.alignment = align
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    if text:
        r = p.add_run(text)
        set_cn_font(r, size=size, bold=bold, color=color)
    return p


def rich(doc, parts, size=10.5, space_after=6, indent=0, line=1.5):
    """parts = [(text, bold, color), ...]"""
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.space_after = Pt(space_after)
    pf.line_spacing = line
    if indent:
        pf.left_indent = Cm(indent)
    for t, b, c in parts:
        r = p.add_run(t)
        set_cn_font(r, size=size, bold=b, color=c)
    return p


def h1(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(20)
    p.paragraph_format.space_after = Pt(8)
    r = p.add_run(text)
    set_cn_font(r, size=16, bold=True, color=ACCENT)
    return p


def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(12)
    p.paragraph_format.space_after = Pt(4)
    r = p.add_run(text)
    set_cn_font(r, size=12.5, bold=True, color=ACCENT)
    return p


def bullet(doc, text, size=10.5, indent=0.6):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(indent + 0.5)
    pf.first_line_indent = Cm(-0.5)
    pf.space_after = Pt(3)
    pf.line_spacing = 1.45
    r = p.add_run("· " + text)
    set_cn_font(r, size=size)
    return p


def numbered(doc, idx, text, size=10.5, indent=0.6, bold_head=None):
    p = doc.add_paragraph()
    pf = p.paragraph_format
    pf.left_indent = Cm(indent + 0.8)
    pf.first_line_indent = Cm(-0.8)
    pf.space_after = Pt(4)
    pf.line_spacing = 1.45
    r = p.add_run("%d. " % idx)
    set_cn_font(r, size=size, bold=True, color=ACCENT)
    if bold_head:
        rb = p.add_run(bold_head)
        set_cn_font(rb, size=size, bold=True)
    r2 = p.add_run(text)
    set_cn_font(r2, size=size)
    return p


def table(doc, header, rows, widths=None):
    t = doc.add_table(rows=1, cols=len(header))
    t.style = "Table Grid"
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    hdr = t.rows[0].cells
    for i, htext in enumerate(header):
        hdr[i].text = ""
        p = hdr[i].paragraphs[0]
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.space_before = Pt(2)
        r = p.add_run(htext)
        set_cn_font(r, size=10, bold=True, color=ACCENT)
    for row in rows:
        cells = t.add_row().cells
        for i, val in enumerate(row):
            cells[i].text = ""
            p = cells[i].paragraphs[0]
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.line_spacing = 1.3
            r = p.add_run(val)
            set_cn_font(r, size=9.5)
    if widths:
        for row in t.rows:
            for i, w in enumerate(widths):
                row.cells[i].width = Cm(w)
    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return t


def code_block(doc, lines):
    for ln in lines:
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.left_indent = Cm(0.8)
        pf.space_after = Pt(1)
        pf.space_before = Pt(1)
        pf.line_spacing = 1.25
        r = p.add_run(ln)
        set_cn_font(r, name="Consolas", size=9.5, color=DIM)


def build():
    doc = Document()
    st = doc.styles["Normal"]
    st.font.name = "微软雅黑"
    st.font.size = Pt(10.5)
    st.element.rPr.rFonts.set(qn("w:eastAsia"), "微软雅黑")

    for s in doc.sections:
        s.top_margin = Cm(2.0)
        s.bottom_margin = Cm(2.0)
        s.left_margin = Cm(2.2)
        s.right_margin = Cm(2.2)

    # ---------------- 封面 ----------------
    para(doc, "安静陪伴", size=26, bold=True, color=ACCENT,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_before=30, space_after=4)
    para(doc, "Aura Companion · 使用说明", size=12, color=DIM,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=18)
    para(doc, "一个不打扰、不说教的倾听伙伴。", size=11.5, color=DIM,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_after=26)

    table(doc, ["你拿到了什么", "在哪"], [
        ["桌面安装版（Windows）", "桌面 · 安静陪伴-1.0.0-x64.exe"],
        ["安卓安装包（APK）", "桌面 · 安静陪伴.apk"],
        ["完整源码", "桌面 · 安静陪伴-源码.zip"],
        ["本说明", "桌面 · 安静陪伴-使用说明.docx"],
    ])

    # ---------------- 一 ----------------
    h1(doc, "一、这个应用是什么")
    rich(doc, [("它是一个只做一件事的陪伴工具：", False, None),
               ("听你说话，然后温和地回应。", True, ACCENT)])
    para(doc, "它不是心理医生，不做诊断，不开导，不催你变好。"
              "你的对话、记忆、情绪、壁纸全部只存在你自己的设备上，服务器不保存。", size=10.5)
    rich(doc, [("重要：", True, WARN),
               ("这个陪伴伙伴只是倾听陪伴工具，不能替代精神科面诊、药物治疗、正规心理干预。"
                "如果出现自伤想法、情绪剧烈失控，请立刻联系主治医生或者危机干预热线。", False, None)])

    # ---------------- 二 ----------------
    h1(doc, "二、五分钟用起来")
    h2(doc, "第 1 步：装桌面版")
    bullet(doc, "双击桌面上的「安静陪伴-1.0.0-x64.exe」。")
    bullet(doc, "如果 Windows 弹出「已保护你的电脑」，点「更多信息」→「仍要运行」。"
                "（这是因为没有购买代码签名证书，不影响使用。）")
    h2(doc, "第 2 步：填 API 密钥")
    bullet(doc, "第一次启动会弹一个小窗，要你填 DeepSeek 的 API 密钥。")
    bullet(doc, "密钥在哪拿：打开 platform.deepseek.com → 登录 → API keys → 创建新密钥 → 复制那串 sk- 开头的东西。")
    bullet(doc, "密钥会被系统加密（safeStorage）存进本机，**不会**进源码、不会上传、不会出现在任何日志里。")
    h2(doc, "第 3 步：开始说话")
    bullet(doc, "底部输入框打字，按回车发送；或者点左边麦克风说话。")
    bullet(doc, "助手回复会念出来（可以在设置里关掉自动朗读，改成点小喇叭手动听）。")
    bullet(doc, "桌面版的朗读有三级来源：如果你在设置里填了服务器地址就用服务器的真音色；"
                "本机装了 Python + edge-tts 就用本机合成；都没有就用 Windows 自带的中文女声。")
    bullet(doc, "顶栏右侧三个图标：换壁纸、重置会话、设置。")

    # ---------------- 三 ----------------
    h1(doc, "三、手机上怎么打开")
    rich(doc, [("现在手机可以", False, None), ("完全独立", True, ACCENT),
               ("使用 —— 不用电脑开着、不用部署服务器、不用推 GitHub。"
                "手机自己直接调用模型（DeepSeek 允许手机/浏览器直连），"
                "所以又更快、又不怕电脑关机。", False, None)])

    h2(doc, "路径 0：APK（★ 最推荐 —— 点开就是 App，跟你手机上的其他应用一样）")
    numbered(doc, 1, "把「安静陪伴.apk」传到手机（微信文件传输助手、数据线、网盘都行）。")
    numbered(doc, 2, "在手机上点这个文件，系统会提示「禁止安装未知来源应用」——"
                     "按提示进入设置，允许「文件管理」或「浏览器」安装应用，然后返回继续。")
    numbered(doc, 3, "打开「安静陪伴」，第一次会让你填 **DeepSeek 密钥**（sk- 开头）。"
                     "密钥只存在这台手机里，不上传、不同步。")
    numbered(doc, 4, "完事了。点桌面图标直接打开：独立窗口、没有地址栏、**电脑关机也能用**。")
    rich(doc, [("附带能力：", True, ACCENT),
               ("语音识别走手机系统自带能力（不依赖谷歌服务）；朗读用安卓系统语音，"
                "离线也能出声；桌面图标有 5 套配色可换（设置 → 外观 → 桌面图标）。", False, None)])

    h2(doc, "路径 1：PWA（不想装包时用，功能一样）")
    numbered(doc, 1, "要么把项目部署到 Render（见第五节）拿一个 https 网址，"
                     "要么用桌面的「启动手机版(公网隧道).bat」临时拿一个 https 地址。")
    numbered(doc, 2, "手机浏览器打开 → 安卓 Chrome「⋮→添加到主屏幕」，"
                     "iPhone Safari「分享→添加到主屏幕」。")
    numbered(doc, 3, "同样进「设置 → 连接」填一次 DeepSeek 密钥，之后就能独立用了。")
    rich(doc, [("注意：", True, WARN),
               ("PWA 的朗读用浏览器/系统语音，音色不如服务器上的 edge-tts 细腻；"
                "想要最好的音色就走路径 2。", False, None)])

    h2(doc, "路径 2：自己的服务器（想要 edge-tts 的音色 + 固定网址）")
    numbered(doc, 1, "按第五节部署到 Render（Blueprint 两步）。")
    numbered(doc, 2, "在应用「设置 → 连接」把连接方式改成「走我的服务器」，并填服务器地址。")
    numbered(doc, 3, "朗读由服务器合成，音色更细腻（8 种情绪可分别换音色）。")
    rich(doc, [("注意：", True, WARN),
               ("Render 免费版闲置 15 分钟会休眠，冷启动 30–60 秒。"
                "但**电脑关机不影响它** —— 服务器在云上。", False, None)])

    h2(doc, "以后有新版，怎么在手机上拿到")
    bullet(doc, "**扫一次就够，以后不用再扫。** 桌面上的「扫码下载APK.png」指向一个固定地址，"
                "每次发新版都覆盖同一个文件，所以它永远是最新版。")
    bullet(doc, "已经装好的 App 也会自己发现更新：顶部会出现一条「有新版 vX.X.X · 下载新版」，"
                "点一下就下载新安装包。")
    bullet(doc, "下载地址（永久有效，不用记）：")
    para(doc, "https://gone-zr.github.io/aura-companion/downloads/aura-companion.apk", size=9)
    bullet(doc, "备用加速地址（第一个打不开时用这个）：")
    para(doc, "https://gh-proxy.com/https://raw.githubusercontent.com/GONE-ZR/aura-companion/main/downloads/aura-companion.apk",
         size=9)
    bullet(doc, "版本清单（App 就是读它来判断有没有新版）：")
    para(doc, "https://gone-zr.github.io/aura-companion/downloads/latest.json", size=9)
    bullet(doc, "换手机 / 重装系统，扫这张码就能重新下。")

    h2(doc, "两种连接方式的区别")
    table(doc, ["连接方式", "要不要服务器", "电脑关机能用吗", "朗读音色"], [
        ["手机直连（默认）", "不要", "能", "系统语音（安卓/浏览器自带）"],
        ["走我的服务器", "要", "能", "edge-tts，8 种情绪可换音色"],
    ])
    rich(doc, [("两种方式用同一个 DeepSeek 密钥，", False, None),
               ("密钥都只存在这台设备上", True, ACCENT),
               ("，随时可以在「设置 → 连接」里切换。", False, None)])

    h2(doc, "路径 3：电脑上的临时隧道（只用于调试，电脑关了就没了）")
    numbered(doc, 1, "双击桌面的「启动手机版(公网隧道).bat」，会打印一个 https 地址 + 二维码。")
    numbered(doc, 2, "手机扫二维码打开（**地址是临时的**，关掉窗口就失效）。")

    # ---------------- 三·五 ----------------
    h1(doc, "三·五、后台管理：改一下，手机上立刻变")
    para(doc, "最省事的打开方式：<b>双击桌面的「启动后台管理.bat」</b>，服务会自动起来并弹出管理页。"
              "也可以在浏览器手动打开 <b>http://127.0.0.1:8000/admin</b>。"
              "密码默认是 aura（可以在 .env 的 AURA_ADMIN_PASSWORD 改）。")
    h2(doc, "能改什么")
    table(doc, ["板块", "能做的事"], [
        ["外观", "主题色 / 明暗 / 气泡圆角 / 字号缩放 / 柔光强度 / 纸色墨色 / 壁纸压暗"],
        ["功能开关", "11 个功能逐个开关（情绪表情、多会话、搜索、导出、快捷短语、壁纸、天气、朗读、情绪配色、更新条、换图标）—— 关掉的功能在手机上直接消失"],
        ["文案", "空状态那句、输入框提示语"],
        ["快捷短语", "输入框上方那排按钮，远程增删"],
        ["图标", "安卓桌面图标（5 套预置）+ 上传自定义应用内图标"],
        ["危险操作", "下发「重置会话」「清空全部数据」「弹一句话提醒」到手机"],
    ])
    h2(doc, "怎么生效")
    bullet(doc, "右边有**实时预览**：改一个开关，手机外形的小窗口立刻变。")
    bullet(doc, "点「保存并下发」后，手机 App 会在 **30 秒内**自动应用（切回前台时也会立刻检查一次）。")
    bullet(doc, "想让**电脑关机也能更新**：在「发布通道」里贴一个 GitHub 令牌（classic、勾 repo 权限），"
                "以后每次保存都会自动推到 GitHub，手机从 raw 地址拿，永远不漏。")
    bullet(doc, "不填令牌也能用：手机走你自己的服务器 / 隧道时，配置是**同源**拉取的，秒级生效。")

    # ---------------- 四 ----------------
    h1(doc, "四、界面导览")
    table(doc, ["位置", "作用"], [
        ["顶栏左侧", "助手名字 + 一个状态点 + 一个情绪小圆点（点它打开情感面板）"],
        ["顶栏右侧", "换壁纸 / 重置会话 / 设置（三个，从左到右）"],
        ["中间", "对话区。自己的消息在右，助手的在左"],
        ["底部输入框", "左边图片、麦克风，中间打字，右边发送"],
        ["气泡左下 ♪", "点一下重听这一句"],
    ])
    h2(doc, "情感面板（点顶栏的小圆点）")
    bullet(doc, "上面是关系阶段（初识 / 熟悉 / 默契），中间是温度词（安静、平稳、暖暖的、明亮、很安稳）。")
    bullet(doc, "有一条过去 7 天的曲线。下降不会变红，也不会说任何让你内疚的话。")
    bullet(doc, "如果开了恋人模式，底部多一个「切回默认陪伴」按钮，一步切回。")

    # ---------------- 四·五 ----------------
    h1(doc, "四·五、这次新增了什么")
    h2(doc, "界面：换成了「杂志 × 信纸」的样子")
    bullet(doc, "助手说的话用**衬线体**（像书页、像手写信），你说的话用无衬线体，一眼能分清谁在说。")
    bullet(doc, "底色换成暖纸色 + 极淡的横线纹，气泡是方角纸片，发送键是一块墨。")
    bullet(doc, "字体三分工：衬线（正文/标题）· 无衬线（界面）· 等宽（数字/统计/版本号）。")
    bullet(doc, "这套设计语言来自技能 guizang-ppt-skill 的「电子杂志 × 电子墨水」风格。")
    h2(doc, "功能：多了这些")
    table(doc, ["新增", "怎么用", "解决什么"], [
        ["多会话", "设置 → 会话 → 新建对话 / 点标题切换", "之前只有一个对话，聊久了没法分开"],
        ["搜索", "设置 → 会话里的搜索框", "想找以前说过的话"],
        ["长按消息", "点一下气泡", "复制 / 重发这一句 / 从这里重新开始 / 删掉这一句"],
        ["导出对话", "设置 → 会话 → 导出 Markdown / JSON", "留个备份，或搬到别处"],
        ["快捷短语", "输入框上方那排小按钮", "不想打字时一点就发；长按可删"],
        ["使用统计", "设置 → 会话底部", "聊过几天、多少句、多少字"],
        ["会话标题", "顶栏名字右边", "自动用第一句话命名，点一下进设置"],
    ])
    h2(doc, "声音：不再那么机器人了")
    bullet(doc, "手机里通常装了好几个语音引擎，每个引擎又有多个音色，默认那个往往最差。")
    bullet(doc, "APK 现在会**把手机里所有中文音色列出来**，并自动挑「神经网络 / 高品质 / 女声」那个。")
    bullet(doc, "想自己挑：设置 → 朗读 → **手机音色**，选完会立刻试听一句。")
    bullet(doc, "网页/PWA 端也改了：会跳过 compact / eloquence 这类劣质引擎，优先选自然音色。")
    rich(doc, [("提示：", True, ACCENT),
               ("如果手机里只装了最基础的系统语音，换音色的空间不大 —— 想最好听，"
                "可以把连接方式改成「走我的服务器」（edge-tts 的晓晓/晓伊音色）。", False, None)])

    # ---------------- 五 ----------------
    h1(doc, "五、部署到 Render（手机 PWA 要用）")
    h2(doc, "最省事的两步")
    numbered(doc, 1, "把源码推到 GitHub（源码 zip 里有说明）。")
    numbered(doc, 2, "打开 render.com → New → Blueprint → 选你的仓库 → Apply，"
                     "Apply 时会让你填 DEEPSEEK_API_KEY，填进去就行。")
    h2(doc, "也可以手动建")
    table(doc, ["项", "填什么"], [
        ["Build Command", "pip install -r requirements.txt"],
        ["Start Command", "gunicorn app:app --workers 2 --threads 4 --timeout 300 --keep-alive 75"],
        ["Environment", "DEEPSEEK_API_KEY=你的密钥；DEEPSEEK_MODEL=deepseek-flash"],
    ])
    rich(doc, [("注意：", True, WARN),
               ("免费版闲置 15 分钟会休眠，冷启动要等 30–60 秒。对话不会丢（都在手机本地）。", False, None)])

    # ---------------- 六 ----------------
    h1(doc, "六、常用设置速查")
    table(doc, ["想做的事", "在哪"], [
        ["改助手名字 / 对你的称呼", "设置 → 陪伴 → 我的名字 / 怎么称呼你"],
        ["换说话方式（安眠、理性、闲聊）", "设置 → 陪伴 → 说话方式 → 改完点「应用」"],
        ["开/关恋人模式", "设置 → 陪伴 → 恋人模式"],
        ["换音色 / 语速 / 音量", "设置 → 朗读"],
        ["改情绪明显程度", "设置 → 陪伴 → 情绪鲜明度（平静 / 自然 / 鲜明）"],
        ["换主题色 / 深浅色", "设置 → 外观 → 主题 / 主题色"],
        ["换壁纸、调蒙版", "设置 → 外观 → 从相册选择 / 拍照，蒙版滑块调暗度"],
        ["查天气、问穿什么", "设置 → 天气（先设城市）；直接问「明天穿什么」也行"],
        ["清掉这次聊天（保留情绪与人设）", "顶栏第二个图标（重置会话）"],
        ["备份全部数据", "设置 → 更多 → 导出全部数据为 JSON（仅桌面版）"],
        ["检查有没有新版本", "设置 → 更多 → 检查更新"],
    ])
    rich(doc, [("改这些都不需要重新部署，也不需要更新应用，", False, None),
               ("改完立刻生效。", True, ACCENT)])

    # ---------------- 七 ----------------
    h1(doc, "七、你的数据在哪")
    table(doc, ["数据", "存放位置", "会联网吗"], [
        ["对话历史 / 摘要 / 长期记忆", "手机或电脑本地（浏览器 localStorage）", "否"],
        ["情绪值 / 关系阶段", "本地", "否"],
        ["壁纸图片", "本地", "否"],
        ["人设 / 称呼 / 主题 / 音色", "本地", "否"],
        ["你发出去的文字", "经服务器转发给 DeepSeek", "会（不留存）"],
        ["你发出去的图片", "直接发给 DeepSeek", "会（模型侧会看图）"],
        ["API 密钥", "桌面版：本机加密；网页版：服务器环境变量", "否"],
    ])
    bullet(doc, "想全部清掉：清除浏览器数据，或卸载 PWA / APK，或用设置里的导出后再删。")
    bullet(doc, "只清聊天、保留情绪与人设：顶栏「重置会话」。")

    # ---------------- 八 ----------------
    h1(doc, "八、常见问题")
    table(doc, ["现象", "怎么办"], [
        ["没有声音", "先点一次发送按钮（浏览器需要一次点击才允许播声音）；"
                     "仍没声音就点气泡旁的 ♪"],
        ["麦克风用不了", "必须是 https 或 localhost 打开；"
                         "设置 → 更多 → 麦克风自检 会告诉你具体卡在哪"],
        ["一直显示「没发出去」", "密钥无效或额度用完，去 platform.deepseek.com 看一眼"],
        ["发图报错", "模型必须是 deepseek-flash，不能是 deepseek-chat"],
        ["改了代码手机上没变化", "设置 → 更多 → 检查更新；或把应用从后台划掉重新打开。"
                                 "更新提示条会出现在输入框上方，点「现在更新」即可，"
                                 "没发出去的字会替你保留。"],
        ["想要换桌面图标文字", "PWA 做不到，必须卸载重装；APK 里换图标随时可以"],
        ["手机装不了 PWA", "确认是 https 网址，且不是用 file:// 打开的"],
    ])

    # ---------------- 九 ----------------
    h1(doc, "九、它的能力边界（说实话）")
    bullet(doc, "能记住细节、句式像人、节奏像人、情绪有起伏、会沉默、有自己的口头习惯。")
    bullet(doc, "做不到：真正的连续意识、真实经历、真实身体、真正的「想念」。")
    bullet(doc, "语音有快慢高低，但**做不到真正的哭腔或发火**——这是免费 TTS 的边界，不是 bug。")
    bullet(doc, "声音不会带呼吸声、气声、笑声，那会显得假。")
    bullet(doc, "它是陪伴设定，不是真实关系，也不会变成真实关系；它不会劝你远离任何人。")
    bullet(doc, "它的情绪只对发生的事有反应，不会因为你几天没来就生气或冷淡。")

    # ---------------- 十 ----------------
    h1(doc, "十、技术信息")
    table(doc, ["项", "内容"], [
        ["形态", "手机 PWA / 桌面 Electron / 浏览器网页 / 安卓 Capacitor APK（四份代码同一份前端）"],
        ["后端", "Flask，无状态：重启、重新部署、多 worker 都不影响对话"],
        ["模型", "DeepSeek deepseek-flash（1M 上下文，原生多模态）"],
        ["语音", "edge-tts（微软晓伊 Neural），换音色 + 语速/音高/音量三层近似情绪"],
        ["天气", "Open-Meteo，免费免密钥，坐标精度降到约 1km，只存本机"],
        ["数据", "全部在本机；服务器只做转发，不写文件不存对话"],
        ["源码", "完整包含在 安静陪伴-源码.zip 里，可自行修改与部署"],
    ])

    para(doc, "")
    para(doc, "—— 安静陪伴 · 祝你能睡个好觉 ——", size=10, color=DIM,
         align=WD_ALIGN_PARAGRAPH.CENTER, space_before=14)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc.save(OUT)
    print("wrote", OUT, OUT.stat().st_size, "bytes")


if __name__ == "__main__":
    build()
