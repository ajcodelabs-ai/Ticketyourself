"""
Ticket PDF renderer using reportlab.
Generates A4 single-page tickets with branding from the organizer's microsite.
QR code embeds the ticket JWT for offline-friendly validation.
"""
import io
import logging
from datetime import datetime

import qrcode
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

logger = logging.getLogger("tys.pdf")


def _hex_to_color(hex_str: str) -> colors.Color:
    if not hex_str or not hex_str.startswith("#") or len(hex_str) != 7:
        return colors.HexColor("#4f46e5")
    return colors.HexColor(hex_str)


def _format_dt(iso: str | None, tz_hint: str = "America/Guayaquil") -> str:
    if not iso:
        return ""
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y · %H:%M")
    except Exception:
        return iso


def _wrap(text: str, max_chars: int) -> list[str]:
    """Simple word-wrap for short fields."""
    if not text:
        return []
    words = text.split()
    lines: list[str] = []
    current = ""
    for w in words:
        if len(current) + len(w) + 1 <= max_chars:
            current = (current + " " + w).strip()
        else:
            if current:
                lines.append(current)
            current = w
    if current:
        lines.append(current)
    return lines


def render_ticket_pdf(
    *,
    event: dict,
    order: dict,
    ticket: dict,
    organizer: dict,
    microsite: dict | None = None,
) -> bytes:
    """Return raw PDF bytes for a single ticket."""
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    page_w, page_h = A4

    primary_hex = (
        (microsite or {}).get("branding", {}).get("primary_color") or "#4f46e5"
    )
    primary = _hex_to_color(primary_hex)

    # ── Header band ─────────────────────────────────────────────────────────
    c.setFillColor(primary)
    c.rect(0, page_h - 80, page_w, 80, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont("Helvetica-Bold", 22)
    company = (organizer.get("company_name") or "Ticket Yourself")[:48]
    c.drawString(20 * mm, page_h - 35, company)
    c.setFont("Helvetica", 10)
    c.drawString(20 * mm, page_h - 55, "Ticket digital · Ticket Yourself")
    c.setFont("Helvetica-Bold", 12)
    order_num = order.get("order_number", "")
    c.drawRightString(page_w - 20 * mm, page_h - 35, f"Orden {order_num}")
    c.setFont("Helvetica", 9)
    c.drawRightString(page_w - 20 * mm, page_h - 55, f"Ticket {ticket['id'][:8]}")

    # ── Event title ─────────────────────────────────────────────────────────
    c.setFillColor(colors.HexColor("#1f1f33"))
    c.setFont("Helvetica-Bold", 26)
    title_lines = _wrap(event.get("title", ""), 32)
    y = page_h - 130
    for line in title_lines[:2]:
        c.drawString(20 * mm, y, line)
        y -= 32

    # ── Body 2 columns ──────────────────────────────────────────────────────
    body_top = y - 20
    info_x = 20 * mm
    qr_x = page_w - 95 * mm
    qr_size = 75 * mm

    # Left column: event + holder
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#8c8ca6"))
    c.drawString(info_x, body_top, "FECHA")
    c.setFont("Helvetica", 13)
    c.setFillColor(colors.HexColor("#1f1f33"))
    c.drawString(info_x, body_top - 18, _format_dt(event.get("starts_at"), event.get("timezone", "America/Guayaquil")))

    venue_lines = [event.get("venue_name") or "", event.get("venue_address") or "", event.get("venue_city") or ""]
    venue_lines = [v for v in venue_lines if v]
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#8c8ca6"))
    c.drawString(info_x, body_top - 50, "LUGAR")
    c.setFont("Helvetica", 12)
    c.setFillColor(colors.HexColor("#1f1f33"))
    for i, vl in enumerate(venue_lines[:3]):
        c.drawString(info_x, body_top - 68 - i * 14, vl[:40])

    holder = ticket.get("holder") or {}
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#8c8ca6"))
    c.drawString(info_x, body_top - 130, "ASISTENTE")
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(colors.HexColor("#1f1f33"))
    c.drawString(info_x, body_top - 148, (holder.get("name") or "Sin nombre")[:36])
    c.setFont("Helvetica", 10)
    c.setFillColor(colors.HexColor("#6e6e84"))
    c.drawString(info_x, body_top - 162, (holder.get("email") or "")[:42])

    pricing = (event.get("pricing_type") or "free").lower()
    if pricing == "free":
        price_label = "Gratis"
    elif pricing == "donation":
        amt = (order.get("donation_amount_cents") or 0) / 100
        price_label = f"Aporte ${amt:.2f}" if amt > 0 else "Aporte voluntario"
    else:
        unit = (event.get("base_price_cents") or 0) / 100
        price_label = f"${unit:.2f} {event.get('currency', 'USD')}"
    c.setFont("Helvetica-Bold", 10)
    c.setFillColor(colors.HexColor("#8c8ca6"))
    c.drawString(info_x, body_top - 195, "PRECIO")
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(primary)
    c.drawString(info_x, body_top - 213, price_label)

    # Right column: QR
    qr_img = qrcode.make(ticket.get("qr_token", ""))
    qr_buf = io.BytesIO()
    qr_img.save(qr_buf, format="PNG")
    qr_buf.seek(0)
    c.drawImage(ImageReader(qr_buf), qr_x, body_top - 245, qr_size, qr_size)
    c.setFont("Helvetica", 9)
    c.setFillColor(colors.HexColor("#6e6e84"))
    c.drawCentredString(
        qr_x + qr_size / 2,
        body_top - 260,
        "Presentá este QR en la entrada del evento.",
    )

    # ── Footer ──────────────────────────────────────────────────────────────
    c.setStrokeColor(colors.HexColor("#e6e6f0"))
    c.line(20 * mm, 30 * mm, page_w - 20 * mm, 30 * mm)
    c.setFont("Helvetica", 8)
    c.setFillColor(colors.HexColor("#8c8ca6"))
    c.drawString(20 * mm, 22 * mm, "Ticket Yourself · powered by ajcodelabs.ai")
    c.drawRightString(
        page_w - 20 * mm, 22 * mm, f"Emitido {_format_dt(ticket.get('issued_at'))}"
    )

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()
