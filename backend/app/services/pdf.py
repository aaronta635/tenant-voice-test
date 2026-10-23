"""A small PDF writer: A4 pages of text in the standard Helvetica fonts.

Enough for a lease and its signing page (services/leases.py): headings,
wrapped paragraphs, label and value rows, rules and signature lines, with a
footer on every page. It has no dependency: it writes PDF 1.4 by hand.
Helvetica and Helvetica-Bold are two of the 14 fonts every PDF viewer has, so
nothing is embedded. Text is WinAnsi (cp1252) encoded: a Latin letter
outside it prints without its marks (encode), any other character as "?".

The same blocks always give the same bytes (no creation date, no random
id), so a preview's SHA-256 is the SHA-256 of the document sent after it.
"""

from __future__ import annotations

import re
import unicodedata

# A4, in points.
PAGE_WIDTH = 595.28
PAGE_HEIGHT = 841.89
MARGIN_X = 56.0
MARGIN_TOP = 64.0
MARGIN_BOTTOM = 72.0
FOOTER_Y = 40.0
CONTENT_WIDTH = PAGE_WIDTH - 2 * MARGIN_X
# The label column of a fields() row.
LABEL_WIDTH = 150.0

REGULAR = "F1"
BOLD = "F2"
_FONTS = {REGULAR: b"Helvetica", BOLD: b"Helvetica-Bold"}

# Glyph widths (per 1000 units of the font size) of the printable ASCII
# characters, space (32) to tilde (126), from the fonts' AFM metrics.
_ASCII_WIDTHS = {
    REGULAR: [
        278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
        1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
        333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
        556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
    ],
    BOLD: [
        278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
        556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
        975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
        667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
        333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
        611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
    ],
}
# The WinAnsi punctuation people type most: quotes, dashes, bullet, ellipsis, euro.
_EXTRA_WIDTHS = {
    REGULAR: {0x80: 556, 0x85: 1000, 0x91: 222, 0x92: 222, 0x93: 333, 0x94: 333, 0x95: 350, 0x96: 556, 0x97: 1000},
    BOLD: {0x80: 556, 0x85: 1000, 0x91: 278, 0x92: 278, 0x93: 500, 0x94: 500, 0x95: 350, 0x96: 556, 0x97: 1000},
}
# Any other WinAnsi character (accented letters, symbols): as wide as a capital, so lines never overflow.
_OTHER_WIDTH = 722

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def clean(text: str | None) -> str:
    """text composed (NFC), with tabs as spaces and other control characters removed; line breaks stay.

    Composed first, so a letter typed or pasted as the letter and then its marks (NFD, as in a macOS
    file name) is one character, which WinAnsi has or encode() strips of its marks, not "e??".
    """
    text = unicodedata.normalize("NFC", text or "")
    return _CONTROL.sub("", text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", " "))


# Latin letters NFKD does not split into a letter and marks.
_LATIN_FALLBACK = str.maketrans({"đ": "d", "Đ": "D", "ł": "l", "Ł": "L", "ħ": "h", "Ħ": "H", "ı": "i"})


def _winansi(char: str) -> str:
    """char if WinAnsi has it, else its Latin letter without marks (ễ -> e, đ -> d), else "?"."""
    try:
        char.encode("cp1252")
        return char
    except UnicodeEncodeError:
        pass
    letters = "".join(part for part in unicodedata.normalize("NFKD", char.translate(_LATIN_FALLBACK))
                      if not unicodedata.combining(part))
    try:
        return letters.encode("cp1252").decode("cp1252") if letters else "?"
    except UnicodeEncodeError:
        return "?"


def encode(text: str) -> bytes:
    """text as WinAnsi bytes. A Latin letter WinAnsi lacks loses its marks, so "Nguyễn Văn An" prints as
    "Nguyen Van An"; a character of another script becomes "?"."""
    return "".join(_winansi(char) for char in clean(text).replace("\n", " ")).encode("cp1252")


def _char_width(code: int, font: str) -> int:
    if 32 <= code <= 126:
        return _ASCII_WIDTHS[font][code - 32]
    return _EXTRA_WIDTHS[font].get(code, _OTHER_WIDTH)


def text_width(text: str, size: float, font: str = REGULAR) -> float:
    """How wide text prints, in points."""
    return sum(_char_width(code, font) for code in encode(text)) * size / 1000


def wrap(text: str, width: float, size: float, font: str = REGULAR) -> list[str]:
    """text broken into lines no wider than width: at spaces, inside a word only when it alone is wider.

    Each line break in text starts a new line; an empty line stays one.
    """
    lines: list[str] = []
    for paragraph in clean(text).split("\n"):
        line = ""
        for word in paragraph.split():
            candidate = f"{line} {word}" if line else word
            if text_width(candidate, size, font) <= width:
                line = candidate
                continue
            if line:
                lines.append(line)
            line = ""
            while text_width(word, size, font) > width:  # a word wider than a line: cut it
                cut = 1
                while cut < len(word) and text_width(word[:cut + 1], size, font) <= width:
                    cut += 1
                lines.append(word[:cut])
                word = word[cut:]
            line = word
        lines.append(line)
    return lines


def _number(value: float) -> bytes:
    return (f"{value:.2f}".rstrip("0").rstrip(".") or "0").encode()


def _literal(text: str) -> bytes:
    """A PDF string literal of text in WinAnsi: parentheses and backslashes escaped, other bytes as octal."""
    out = bytearray(b"(")
    for code in encode(text):
        if code in (0x28, 0x29, 0x5C):
            out += b"\\" + bytes([code])
        elif 32 <= code <= 126:
            out.append(code)
        else:
            out += b"\\%03o" % code
    return bytes(out + b")")


def _text_string(text: str) -> bytes:
    """A PDF text string (document information) in UTF-16BE with its byte order mark, as hex."""
    return b"<FEFF" + clean(text).replace("\n", " ").encode("utf-16-be").hex().upper().encode() + b">"


def _text_op(x: float, baseline: float, size: float, text: str, font: str = REGULAR, gray: bool = False) -> bytes:
    colour = b"0.34 0.36 0.42 rg" if gray else b"0.09 0.10 0.12 rg"
    return b"BT %s /%s %s Tf %s %s Td %s Tj ET" % (
        colour, font.encode(), _number(size), _number(x), _number(baseline), _literal(text))


def _line_op(x1: float, y1: float, x2: float, y2: float, width: float = 0.6) -> bytes:
    return b"0.55 0.57 0.62 RG %s w %s %s m %s %s l S" % (
        _number(width), _number(x1), _number(y1), _number(x2), _number(y2))


class _Layout:
    """Pages of drawing operators, filled from the top; a block that does not fit starts a new page."""

    def __init__(self):
        self.pages: list[list[bytes]] = []
        self.new_page()

    def new_page(self) -> None:
        self.ops: list[bytes] = []
        self.pages.append(self.ops)
        self.y = PAGE_HEIGHT - MARGIN_TOP

    @property
    def at_top(self) -> bool:
        return self.y >= PAGE_HEIGHT - MARGIN_TOP

    def ensure(self, height: float) -> None:
        if self.y - height < MARGIN_BOTTOM and not self.at_top:
            self.new_page()

    def text(self, x: float, baseline: float, size: float, text: str, font: str = REGULAR, gray: bool = False) -> None:
        self.ops.append(_text_op(x, baseline, size, text, font, gray))

    def line(self, x1: float, y1: float, x2: float, y2: float, width: float = 0.6) -> None:
        self.ops.append(_line_op(x1, y1, x2, y2, width))

    def lines(self, lines: list[str], size: float, font: str, gray: bool, x: float = MARGIN_X) -> None:
        leading = size * 1.35
        for line in lines:
            self.ensure(leading)
            self.text(x, self.y - size, size, line, font, gray)
            self.y -= leading


class PdfDocument:
    """A document built block by block, then rendered with render()."""

    def __init__(self, title: str, footer: str = ""):
        self.title = clean(title).strip() or "Document"
        self.footer = clean(footer).strip()
        self._blocks: list[tuple] = []

    def heading(self, text: str, size: float = 18) -> PdfDocument:
        self._blocks.append(("heading", text, size))
        return self

    def subheading(self, text: str, size: float = 12) -> PdfDocument:
        self._blocks.append(("subheading", text, size))
        return self

    def paragraph(self, text: str, size: float = 10, bold: bool = False, gray: bool = False) -> PdfDocument:
        self._blocks.append(("paragraph", text, size, BOLD if bold else REGULAR, gray))
        return self

    def fields(self, rows: list[tuple[str, str]], size: float = 10) -> PdfDocument:
        """Label and value rows: the label in bold on the left, the value wrapped beside it."""
        self._blocks.append(("fields", list(rows), size))
        return self

    def rule(self) -> PdfDocument:
        self._blocks.append(("rule",))
        return self

    def signature(self, role: str, name: str, caption: str) -> PdfDocument:
        """A signature block, kept on one page: who signs, a line for the signature and one for the date."""
        self._blocks.append(("signature", role, name, caption))
        return self

    def page_break(self) -> PdfDocument:
        self._blocks.append(("page_break",))
        return self

    def _lay_out(self) -> list[list[bytes]]:
        layout = _Layout()
        for block in self._blocks:
            kind = block[0]
            if kind == "heading":
                _, text, size = block
                layout.lines(wrap(text, CONTENT_WIDTH, size, BOLD), size, BOLD, False)
                layout.y -= 8
            elif kind == "subheading":
                _, text, size = block
                layout.ensure(size * 1.35 * 3)  # never alone at the foot of a page
                layout.y -= 6
                layout.lines(wrap(text, CONTENT_WIDTH, size, BOLD), size, BOLD, False)
                layout.y -= 2
            elif kind == "paragraph":
                _, text, size, font, gray = block
                layout.lines(wrap(text, CONTENT_WIDTH, size, font), size, font, gray)
                layout.y -= 6
            elif kind == "fields":
                _, rows, size = block
                leading = size * 1.35
                for label, value in rows:
                    labels = wrap(label, LABEL_WIDTH - 10, size, BOLD)
                    values = wrap(value, CONTENT_WIDTH - LABEL_WIDTH, size, REGULAR)
                    for index in range(max(len(labels), len(values))):
                        layout.ensure(leading)
                        baseline = layout.y - size
                        if index < len(labels):
                            layout.text(MARGIN_X, baseline, size, labels[index], BOLD)
                        if index < len(values):
                            layout.text(MARGIN_X + LABEL_WIDTH, baseline, size, values[index])
                        layout.y -= leading
                    layout.y -= 3
                layout.y -= 4
            elif kind == "rule":
                layout.ensure(12)
                layout.y -= 6
                layout.line(MARGIN_X, layout.y, PAGE_WIDTH - MARGIN_X, layout.y)
                layout.y -= 8
            elif kind == "signature":
                _, role, name, caption = block
                layout.ensure(110)
                layout.y -= 8
                layout.text(MARGIN_X, layout.y - 11, 11, role, BOLD)
                layout.text(MARGIN_X + LABEL_WIDTH, layout.y - 11, 11, name)
                layout.y -= 52
                layout.line(MARGIN_X, layout.y, MARGIN_X + 300, layout.y)
                layout.line(MARGIN_X + 330, layout.y, PAGE_WIDTH - MARGIN_X, layout.y)
                layout.text(MARGIN_X, layout.y - 11, 8, caption, gray=True)
                layout.text(MARGIN_X + 330, layout.y - 11, 8, "Date", gray=True)
                layout.y -= 30
            elif kind == "page_break":
                if not layout.at_top:
                    layout.new_page()
        return layout.pages

    def render(self) -> bytes:
        pages = self._lay_out()
        total = len(pages)
        left = " · ".join(part for part in (self.title, self.footer) if part)
        left = wrap(left, CONTENT_WIDTH - 80, 8)[0]
        for number, ops in enumerate(pages, start=1):
            label = f"Page {number} of {total}"
            ops.append(_line_op(MARGIN_X, FOOTER_Y + 14, PAGE_WIDTH - MARGIN_X, FOOTER_Y + 14, width=0.4))
            ops.append(_text_op(MARGIN_X, FOOTER_Y, 8, left, gray=True))
            ops.append(_text_op(PAGE_WIDTH - MARGIN_X - text_width(label, 8), FOOTER_Y, 8, label, gray=True))
        return _serialize(self.title, pages)


def _serialize(title: str, pages: list[list[bytes]]) -> bytes:
    """The file: a catalog, the page tree, two fonts, the document information and each page's content."""
    objects: list[bytes] = [b"", b""]  # 1: catalog, 2: page tree, both written once the pages are numbered
    for name in (REGULAR, BOLD):
        objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding >>" % _FONTS[name])
    objects.append(b"<< /Title %s /Producer (TenantVoice) >>" % _text_string(title))
    kids = []
    for ops in pages:
        content = b"\n".join(ops)
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))
        objects.append(
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %s %s] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> "
            b"/Contents %d 0 R >>" % (_number(PAGE_WIDTH), _number(PAGE_HEIGHT), len(objects))
        )
        kids.append(len(objects))
    objects[0] = b"<< /Type /Catalog /Pages 2 0 R >>"
    objects[1] = b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % kid for kid in kids), len(kids))

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n%s\nendobj\n" % (number, body)
    start = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    out += b"".join(b"%010d 00000 n \n" % offset for offset in offsets)
    out += b"trailer\n<< /Size %d /Root 1 0 R /Info 5 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, start)
    return bytes(out)
