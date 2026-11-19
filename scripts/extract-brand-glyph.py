"""生成品牌字形资产：把「寒」的字形轮廓写成路径，供图标脚本与界面印记共用。

来源字体 Noto Serif SC（SIL Open Font License）。抽两档字重：
- 600：常规展示用（32px 以上）
- 850：小尺寸用（24px 以下），笔画更厚，缩到 16px 才不会散成一堆点
路径已归一化到 1000×1000 视口、居中、占 68%，所以图标与界面都可以直接按 size 缩放，
不用依赖运行环境里有没有这枚字体。

用法：python scripts/extract-brand-glyph.py
产出：assets/han-glyph.txt、assets/han-glyph-bold.txt、src/renderer/hanchuang/hanGlyph.ts
"""
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.boundsPen import BoundsPen

FONT = r"C:\Windows\Fonts\NotoSerifSC-VF.ttf"
CHAR = "寒"
TARGET = 680.0  # 字形占 1000 视口的比例


def outline(weight):
    font = TTFont(FONT)
    if "fvar" in font:
        axes = {a.axisTag: a for a in font["fvar"].axes}
        if "wght" in axes:
            font = instantiateVariableFont(font, {"wght": min(weight, axes["wght"].maxValue)}, inplace=False)
    glyph_name = font.getBestCmap()[ord(CHAR)]
    glyph_set = font.getGlyphSet()
    bp = BoundsPen(glyph_set)
    glyph_set[glyph_name].draw(bp)
    xmin, ymin, xmax, ymax = bp.bounds
    w, h = xmax - xmin, ymax - ymin
    scale = TARGET / max(w, h)
    tx = (1000 - w * scale) / 2 - xmin * scale
    ty = (1000 - h * scale) / 2 + ymax * scale
    pen = SVGPathPen(glyph_set)
    glyph_set[glyph_name].draw(TransformPen(pen, (scale, 0, 0, -scale, tx, ty)))
    return pen.getCommands()


regular = outline(600.0)
bold = outline(850.0)

with open("assets/han-glyph.txt", "w", encoding="utf-8", newline="\n") as f:
    f.write(regular)
with open("assets/han-glyph-bold.txt", "w", encoding="utf-8", newline="\n") as f:
    f.write(bold)

with open("src/renderer/hanchuang/hanGlyph.ts", "w", encoding="utf-8", newline="\n") as f:
    f.write("// 由 scripts/extract-brand-glyph.py 从 Noto Serif SC（OFL）生成，勿手改。\n")
    f.write("// 1000×1000 视口内居中、占 68%；与应用图标共用同一份轮廓。\n")
    f.write("// HAN_GLYPH 用于常规尺寸，HAN_GLYPH_BOLD 用于 24px 以下的小图标。\n")
    f.write(f"export const HAN_GLYPH =\n  '{regular}'\n\n")
    f.write(f"export const HAN_GLYPH_BOLD =\n  '{bold}'\n")

print("glyph written:", len(regular), len(bold))



