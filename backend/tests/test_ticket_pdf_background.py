import io
import os
import struct
import zlib

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from services.pdf_service import _draw_cover_image


def _png_1x1() -> io.BytesIO:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    raw = zlib.compress(b"\x00\xff\x00\x00")
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", raw)
        + chunk(b"IEND", b"")
    )
    return io.BytesIO(png)


def test_draw_cover_image_does_not_raise():
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    _draw_cover_image(c, _png_1x1(), A4[0], A4[1])
    c.showPage()
    c.save()
    assert buf.getvalue().startswith(b"%PDF")
