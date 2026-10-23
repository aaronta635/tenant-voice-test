"""services/pdf.py: a valid, deterministic PDF of wrapped text pages, with nothing outside WinAnsi breaking it."""

import re
import unicodedata

from app.services import pdf


def _document(**extra) -> pdf.PdfDocument:
    document = pdf.PdfDocument("Residential tenancy agreement", footer="Agreement 1 · PDF version 1")
    document.heading("Residential tenancy agreement").paragraph("Prepared in TenantVoice (by the owner).")
    document.subheading("1. Parties").fields([("Landlord", "Olivia Owner"), ("Tenant", "Tanya Tenant")])
    document.paragraph(extra.get("text", "None."))
    document.page_break().heading("Signing page").signature("Tenant", "Tanya Tenant", "Signed electronically")
    return document


def _objects(data: bytes) -> dict[int, bytes]:
    """Each object's body by number, found through the cross-reference table the file ends with."""
    start = int(re.search(rb"startxref\n(\d+)\n%%EOF\n$", data).group(1))
    assert data[start:].startswith(b"xref\n0 ")
    offsets = [int(offset) for offset in re.findall(rb"(\d{10}) 00000 n \n", data[start:])]
    objects = {}
    for number, offset in enumerate(offsets, start=1):
        assert data[offset:].startswith(b"%d 0 obj\n" % number)
        objects[number] = data[offset:data.index(b"\nendobj\n", offset)]
    return objects


def test_a_document_is_a_pdf_whose_cross_references_point_at_its_objects():
    data = _document().render()

    assert data.startswith(b"%PDF-1.4\n")
    objects = _objects(data)
    assert b"/Type /Catalog /Pages 2 0 R" in objects[1]
    assert b"/Type /Pages" in objects[2] and b"/Count 2" in objects[2]
    assert b"/BaseFont /Helvetica " in objects[3] and b"/BaseFont /Helvetica-Bold " in objects[4]
    assert re.search(rb"/Size %d /Root 1 0 R" % (len(objects) + 1), data)


def test_each_content_streams_length_is_its_byte_count():
    for body in _objects(_document().render()).values():
        match = re.match(rb"<< /Length (\d+) >>\nstream\n", body)
        if match:
            content = body[match.end():body.rindex(b"\nendstream")]
            assert len(content) == int(match.group(1))


def test_the_same_blocks_give_the_same_bytes():
    assert _document().render() == _document().render()
    assert _document(text="Changed.").render() != _document().render()


def test_text_is_escaped_and_winansi_encoded():
    data = _document(text="Rent (weekly) \\ “quoted” café — 中").render()

    assert b"(Rent \\(weekly\\) \\\\ \\223quoted\\224 caf\\351 \\227 ?)" in data


def test_a_vietnamese_name_keeps_its_letters_without_their_marks():
    data = _document(text="Nguyễn Văn An, Trần Thị Đào and Łukasz").render()

    # WinAnsi has à, so it stays (\340); ễ, ă, ầ, ị, Đ and Ł lose their marks.
    assert b"(Nguyen Van An, Tran Thi D\\340o and Lukasz)" in data
    assert pdf.encode("Hợp đồng — 中") == b"Hop dong \x97 ?"


def test_decomposed_text_prints_as_its_composed_letters():
    """A name pasted as letters then their marks (NFD, as macOS file names are) prints as typed composed."""
    def nfd(text):
        return unicodedata.normalize("NFD", text)

    assert nfd("José") != "José"
    assert pdf.encode(nfd("José")) == pdf.encode("José") == b"Jos\xe9"
    assert pdf.encode(nfd("Nguyễn Văn An")) == b"Nguyen Van An"
    assert pdf.text_width(nfd("Nguyễn Văn An"), 12) == pdf.text_width("Nguyen Van An", 12)
    assert b"(Tran Thi D\\340o)" in _document(text=nfd("Trần Thị Đào")).render()


def test_long_text_wraps_within_the_page_and_flows_onto_more_pages():
    text = " ".join(["tenancy"] * 2500)
    data = _document(text=text).render()

    pages = int(re.search(rb"/Count (\d+)", data).group(1))
    assert pages > 3
    for line in pdf.wrap(text, pdf.CONTENT_WIDTH, 10):
        assert pdf.text_width(line, 10) <= pdf.CONTENT_WIDTH
    assert b"(Page 1 of %d)" % pages in data and b"(Page %d of %d)" % (pages, pages) in data


def test_a_word_wider_than_a_line_is_cut():
    lines = pdf.wrap("x" * 400, 100, 10)

    assert "".join(lines) == "x" * 400
    assert all(pdf.text_width(line, 10) <= 100 for line in lines)


def test_line_breaks_start_new_lines_and_control_characters_go():
    assert pdf.wrap("First line\nSecond\x07 line\n\nAfter a blank", 400, 10) == [
        "First line", "Second line", "", "After a blank"]
