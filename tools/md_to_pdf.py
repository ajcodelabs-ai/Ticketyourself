"""
Generic Markdown → PDF converter using ReportLab.
Supports: headings (H1-H3), tables, bullet/numbered lists,
blockquotes, code blocks, horizontal rules, bold/inline-code.
Usage: python md_to_pdf.py <input.md> [output.pdf]
"""
import re
import sys
from pathlib import Path

from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether, Preformatted
)
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

# ── Palette ────────────────────────────────────────────────────────────────
ORANGE      = colors.HexColor("#E8500A")
DARK        = colors.HexColor("#1A1A1A")
GRAY_DARK   = colors.HexColor("#374151")
GRAY_MID    = colors.HexColor("#6B7280")
GRAY_LIGHT  = colors.HexColor("#F3F4F6")
GRAY_BORDER = colors.HexColor("#E5E7EB")
GREEN       = colors.HexColor("#16A34A")
GREEN_BG    = colors.HexColor("#F0FDF4")
RED         = colors.HexColor("#DC2626")
RED_BG      = colors.HexColor("#FEF2F2")
AMBER       = colors.HexColor("#D97706")
AMBER_BG    = colors.HexColor("#FFFBEB")
BLUE        = colors.HexColor("#2563EB")
WHITE       = colors.white

PAGE_W, PAGE_H = A4
MARGIN = 1.8 * cm
CONTENT_W = PAGE_W - 2 * MARGIN

# ── Styles ─────────────────────────────────────────────────────────────────
def S(name, **kw):
    return ParagraphStyle(name, **kw)

STYLES = {
    "h1": S("h1", fontSize=20, leading=26, textColor=ORANGE,
             fontName="Helvetica-Bold", spaceBefore=20, spaceAfter=6),
    "h2": S("h2", fontSize=14, leading=19, textColor=DARK,
             fontName="Helvetica-Bold", spaceBefore=16, spaceAfter=4),
    "h3": S("h3", fontSize=11, leading=15, textColor=GRAY_DARK,
             fontName="Helvetica-Bold", spaceBefore=12, spaceAfter=3),
    "body": S("body", fontSize=9.5, leading=14, textColor=GRAY_DARK,
               fontName="Helvetica"),
    "bullet": S("bullet", fontSize=9.5, leading=14, textColor=GRAY_DARK,
                 fontName="Helvetica", leftIndent=16),
    "bullet2": S("bullet2", fontSize=9, leading=13, textColor=GRAY_DARK,
                  fontName="Helvetica", leftIndent=32),
    "blockquote": S("bq", fontSize=9.5, leading=14, textColor=GRAY_MID,
                     fontName="Helvetica-Oblique", leftIndent=16,
                     borderPadding=(4, 4, 4, 8)),
    "code_inline": S("ci", fontSize=8.5, leading=12, textColor=DARK,
                      fontName="Courier"),
    "note": S("note", fontSize=8, leading=11, textColor=GRAY_MID,
               fontName="Helvetica-Oblique"),
    "meta": S("meta", fontSize=9, leading=13, textColor=GRAY_MID,
               fontName="Helvetica"),
    "toc_h2": S("toc_h2", fontSize=9.5, leading=14, textColor=GRAY_DARK,
                 fontName="Helvetica", leftIndent=0),
}

TABLE_BASE = [
    ("BACKGROUND", (0,0), (-1,0), DARK),
    ("TEXTCOLOR",  (0,0), (-1,0), WHITE),
    ("FONTNAME",   (0,0), (-1,0), "Helvetica-Bold"),
    ("FONTSIZE",   (0,0), (-1,-1), 8.5),
    ("LEADING",    (0,0), (-1,-1), 12),
    ("ROWBACKGROUNDS", (0,1), (-1,-1), [WHITE, GRAY_LIGHT]),
    ("GRID",       (0,0), (-1,-1), 0.4, GRAY_BORDER),
    ("VALIGN",     (0,0), (-1,-1), "TOP"),
    ("TOPPADDING", (0,0), (-1,-1), 5),
    ("BOTTOMPADDING", (0,0), (-1,-1), 5),
    ("LEFTPADDING", (0,0), (-1,-1), 7),
    ("RIGHTPADDING", (0,0), (-1,-1), 7),
]

# ── Inline markup ──────────────────────────────────────────────────────────
def escape(text):
    return (text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))

STATUS_COLORS = {
    "✅": GREEN, "⚠️": AMBER, "❌": RED,
    "🔴": RED, "🟡": AMBER, "🟢": GREEN,
}

def inline(text):
    """Convert markdown inline markup to ReportLab XML."""
    text = escape(text)
    # Bold-italic ***text***
    text = re.sub(r'\*\*\*(.+?)\*\*\*',
                  r'<b><i>\1</i></b>', text)
    # Bold **text**
    text = re.sub(r'\*\*(.+?)\*\*',
                  r'<b>\1</b>', text)
    # Italic *text*
    text = re.sub(r'(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)',
                  r'<i>\1</i>', text)
    # Inline code `text`
    text = re.sub(r'`([^`]+)`',
                  r'<font face="Courier" size="8" color="#1A1A1A">\1</font>', text)
    # Color status icons
    for icon, color in STATUS_COLORS.items():
        hex_c = color.hexval() if hasattr(color, 'hexval') else "#000000"
        text = text.replace(escape(icon),
                            f'<font color="{color.hexval()}">{escape(icon)}</font>')
    return text

def para(text, style="body"):
    return Paragraph(inline(text), STYLES[style])

def cell_para(text, bold=False, align="left", size=8.5):
    a = {"left": TA_LEFT, "center": TA_CENTER, "right": TA_RIGHT}[align]
    fn = "Helvetica-Bold" if bold else "Helvetica"
    s = ParagraphStyle("cp", fontSize=size, leading=size+3,
                        fontName=fn, alignment=a, textColor=GRAY_DARK)
    return Paragraph(inline(text), s)

# ── Table helpers ──────────────────────────────────────────────────────────
def parse_table(lines):
    """
    Parse markdown table lines into a list of rows (list of strings).
    Returns (header_row, data_rows).
    """
    rows = []
    for line in lines:
        if re.match(r'^\s*\|[-:| ]+\|\s*$', line):
            continue  # separator row
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        rows.append(cells)
    if not rows:
        return [], []
    return rows[0], rows[1:]

def col_widths(n_cols, hints=None):
    """Distribute CONTENT_W across n_cols, optionally with hints (fractions)."""
    if hints and len(hints) == n_cols:
        return [CONTENT_W * h for h in hints]
    return [CONTENT_W / n_cols] * n_cols

def table_col_hints(header):
    """Heuristic: first col narrower, last col wider for desc-type tables."""
    n = len(header)
    if n == 2:
        return [0.3, 0.7]
    if n == 3:
        h0 = header[0].lower()
        if any(k in h0 for k in ("id", "fase", "módulo", "método", "proveedor")):
            return [0.18, 0.52, 0.30]
        return [0.25, 0.45, 0.30]
    if n == 4:
        h0 = header[0].lower()
        if "id" in h0 or "como" in h0:
            return [0.08, 0.18, 0.42, 0.32]
        if "fase" in h0 or "#" in h0:
            return [0.10, 0.55, 0.15, 0.20]
        return [0.20, 0.40, 0.20, 0.20]
    if n == 5:
        return [0.12, 0.30, 0.15, 0.20, 0.23]
    if n == 6:
        return [0.08, 0.25, 0.15, 0.15, 0.15, 0.22]
    return None

def color_for_cell(text):
    """Return (bg, fg) hint for a cell based on its content."""
    t = text.strip()
    if t in ("✅", "✅ Implementado", "✅ Completo"):
        return GREEN_BG, GREEN
    if t in ("❌", "❌ No implementado"):
        return RED_BG, RED
    if t in ("⚠️", "⚠️ Parcial"):
        return AMBER_BG, AMBER
    if t in ("🔴 Alta", "P1", "Alta"):
        return RED_BG, RED
    if t in ("🟡 Media", "P2", "Media"):
        return AMBER_BG, AMBER
    if t in ("Baja",):
        return GRAY_LIGHT, GRAY_MID
    return None, None

def build_table(header, data_rows):
    n = len(header)
    hints = table_col_hints(header)
    widths = col_widths(n, hints)

    rows = [[cell_para(h, bold=True, align="center") for h in header]]
    style_cmds = list(TABLE_BASE)

    for ri, row in enumerate(data_rows):
        # Pad/trim row to match column count
        row = (row + [""] * n)[:n]
        built = []
        for ci, cell in enumerate(row):
            bg, fg = color_for_cell(cell)
            p = cell_para(cell)
            built.append(p)
            if bg:
                style_cmds.append(("BACKGROUND", (ci, ri+1), (ci, ri+1), bg))
                style_cmds.append(("TEXTCOLOR",  (ci, ri+1), (ci, ri+1), fg))
                style_cmds.append(("FONTNAME",   (ci, ri+1), (ci, ri+1), "Helvetica-Bold"))
        rows.append(built)

    t = Table(rows, colWidths=widths, repeatRows=1)
    t.setStyle(TableStyle(style_cmds))
    return t

# ── Cover page ─────────────────────────────────────────────────────────────
def cover(title, subtitle, meta_lines):
    elems = []
    cover_data = [[Paragraph(
        f'<font color="white"><b>{escape(title)}</b></font>',
        ParagraphStyle("ct", fontSize=24, leading=30,
                        fontName="Helvetica-Bold", textColor=WHITE)
    )]]
    ct = Table(cover_data, colWidths=[CONTENT_W])
    ct.setStyle(TableStyle([
        ("BACKGROUND", (0,0), (-1,-1), ORANGE),
        ("TOPPADDING", (0,0), (-1,-1), 24),
        ("BOTTOMPADDING", (0,0), (-1,-1), 24),
        ("LEFTPADDING", (0,0), (-1,-1), 18),
    ]))
    elems.append(ct)
    elems.append(Spacer(1, 0.3*cm))

    if subtitle:
        st_data = [[Paragraph(escape(subtitle),
            ParagraphStyle("cs", fontSize=13, leading=17,
                            fontName="Helvetica", textColor=GRAY_DARK))]]
        st = Table(st_data, colWidths=[CONTENT_W])
        st.setStyle(TableStyle([
            ("BACKGROUND", (0,0), (-1,-1), GRAY_LIGHT),
            ("TOPPADDING", (0,0), (-1,-1), 12),
            ("BOTTOMPADDING", (0,0), (-1,-1), 12),
            ("LEFTPADDING", (0,0), (-1,-1), 18),
        ]))
        elems.append(st)
        elems.append(Spacer(1, 0.4*cm))

    for m in meta_lines:
        elems.append(para(m, "meta"))
        elems.append(Spacer(1, 0.1*cm))

    elems.append(Spacer(1, 0.4*cm))
    elems.append(HRFlowable(width="100%", thickness=1.5, color=ORANGE))
    return elems

# ── Main parser ─────────────────────────────────────────────────────────────
class State:
    NORMAL = "normal"
    TABLE  = "table"
    CODE   = "code"
    LIST   = "list"

def parse_md(text):
    lines = text.splitlines()
    story = []
    state = State.NORMAL
    buf   = []          # line buffer for multi-line blocks
    list_depth = 0

    def flush_table():
        if not buf:
            return
        header, data = parse_table(buf)
        if header:
            t = build_table(header, data)
            story.append(KeepTogether([t, Spacer(1, 0.3*cm)]))
        buf.clear()

    def flush_code():
        if not buf:
            return
        code_text = "\n".join(buf)
        p = Preformatted(code_text, ParagraphStyle(
            "pre", fontSize=7.5, leading=10, fontName="Courier",
            backColor=GRAY_LIGHT, textColor=DARK,
            leftIndent=8, rightIndent=8, spaceBefore=4, spaceAfter=4,
            borderPadding=(6, 6, 6, 6)))
        story.append(p)
        story.append(Spacer(1, 0.2*cm))
        buf.clear()

    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.rstrip()

        # ── Code fence ──────────────────────────────────────
        if stripped.startswith("```"):
            if state == State.CODE:
                flush_code()
                state = State.NORMAL
            else:
                if state == State.TABLE:
                    flush_table()
                state = State.CODE
            i += 1
            continue

        if state == State.CODE:
            buf.append(stripped)
            i += 1
            continue

        # ── Horizontal rule ──────────────────────────────────
        if re.match(r'^[-*_]{3,}\s*$', stripped):
            if state == State.TABLE:
                flush_table()
                state = State.NORMAL
            story.append(HRFlowable(width="100%", thickness=0.8,
                                     color=GRAY_BORDER, spaceBefore=6, spaceAfter=6))
            i += 1
            continue

        # ── Table row ───────────────────────────────────────
        if stripped.startswith("|") and stripped.endswith("|"):
            if state != State.TABLE:
                state = State.TABLE
                buf = []
            buf.append(stripped)
            i += 1
            continue
        else:
            if state == State.TABLE:
                flush_table()
                state = State.NORMAL

        # ── Blank line ──────────────────────────────────────
        if not stripped:
            story.append(Spacer(1, 0.2*cm))
            i += 1
            continue

        # ── Headings ────────────────────────────────────────
        m = re.match(r'^(#{1,3})\s+(.*)', stripped)
        if m:
            level = len(m.group(1))
            text  = m.group(2).strip()
            # Strip markdown from heading text for cleanliness
            text  = re.sub(r'\*+', '', text)
            skey  = {1: "h1", 2: "h2", 3: "h3"}[min(level, 3)]
            if level == 1:
                story.append(HRFlowable(width="100%", thickness=1.5,
                                         color=ORANGE, spaceBefore=8, spaceAfter=4))
            story.append(para(text, skey))
            i += 1
            continue

        # ── Blockquote ──────────────────────────────────────
        if stripped.startswith("> "):
            content = stripped[2:]
            data = [[Paragraph(inline(content),
                ParagraphStyle("bq2", fontSize=9, leading=13,
                                fontName="Helvetica-Oblique", textColor=GRAY_MID))]]
            t = Table(data, colWidths=[CONTENT_W])
            t.setStyle(TableStyle([
                ("BACKGROUND", (0,0), (-1,-1), GRAY_LIGHT),
                ("LEFTPADDING", (0,0), (-1,-1), 12),
                ("RIGHTPADDING", (0,0), (-1,-1), 12),
                ("TOPPADDING", (0,0), (-1,-1), 6),
                ("BOTTOMPADDING", (0,0), (-1,-1), 6),
                ("LINEBEFORE", (0,0), (0,-1), 3, ORANGE),
            ]))
            story.append(t)
            story.append(Spacer(1, 0.15*cm))
            i += 1
            continue

        # ── Bullet list ─────────────────────────────────────
        m2 = re.match(r'^(\s*)[-*+]\s+(.*)', line)
        if m2:
            indent = len(m2.group(1))
            content = m2.group(2)
            skey = "bullet2" if indent >= 2 else "bullet"
            bullet_char = "–" if indent >= 2 else "•"
            story.append(Paragraph(
                f'<font color="{ORANGE.hexval()}">{bullet_char}</font> {inline(content)}',
                STYLES[skey]))
            i += 1
            continue

        # ── Numbered list ────────────────────────────────────
        mn = re.match(r'^\s*(\d+)\.\s+(.*)', stripped)
        if mn:
            num = mn.group(1)
            content = mn.group(2)
            story.append(Paragraph(
                f'<font color="{ORANGE.hexval()}"><b>{num}.</b></font> {inline(content)}',
                STYLES["bullet"]))
            i += 1
            continue

        # ── Normal paragraph ─────────────────────────────────
        story.append(para(stripped, "body"))
        i += 1

    # Flush any open table
    if state == State.TABLE:
        flush_table()
    if state == State.CODE:
        flush_code()

    return story

# ── Document metadata extraction ────────────────────────────────────────────
def extract_meta(lines):
    """Pull title (first H1), subtitle (first H3 or bold line), meta (> lines)."""
    title, subtitle, meta = "", "", []
    for line in lines[:20]:
        s = line.strip()
        if not title and s.startswith("# "):
            title = s[2:].strip()
        elif not subtitle and s.startswith("### "):
            subtitle = s[4:].strip()
        elif s.startswith("> **") or (s.startswith("> ") and ("Versión" in s or "Estado" in s or "fecha" in s.lower() or "junio" in s.lower())):
            meta.append(s[2:])
    return title, subtitle, meta

# ── Build PDF ───────────────────────────────────────────────────────────────
def build(md_path: str, pdf_path: str = None):
    src = Path(md_path)
    if not src.exists():
        print(f"Error: {md_path} not found")
        sys.exit(1)

    if pdf_path is None:
        pdf_path = src.with_suffix(".pdf").name

    text  = src.read_text(encoding="utf-8")
    lines = text.splitlines()
    title, subtitle, meta = extract_meta(lines)

    doc = SimpleDocTemplate(
        pdf_path,
        pagesize=A4,
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
        title=title or src.stem,
        author="Ticket Yourself",
    )

    story = []
    story += cover(title or src.stem, subtitle, meta)
    story.append(Spacer(1, 0.5*cm))
    story += parse_md(text)

    doc.build(story)
    print(f"✓  {pdf_path}  ({Path(pdf_path).stat().st_size // 1024} KB)")

# ── Entry point ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python md_to_pdf.py <file.md> [output.pdf]")
        sys.exit(1)
    inp = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    build(inp, out)
