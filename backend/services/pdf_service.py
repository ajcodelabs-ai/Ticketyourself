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


def _format_dt(value, tz_hint: str = "America/Guayaquil") -> str:
    """Accepts either an ISO string or a native `datetime` (row_to_dict
    returns raw datetimes straight from the ORM, not serialized strings)."""
    if not value:
        return ""
    if isinstance(value, datetime):
        return value.strftime("%d/%m/%Y · %H:%M")
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y · %H:%M")
    except Exception:
        return str(value)


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


# ── M4 — diseñador visual de tickets ────────────────────────────────────────
# Real output size per format. Elements are stored as fractions [0,1] of the
# canvas, so the same design renders correctly at any of these sizes.
FORMAT_PAGE_SIZES = {
    "digital": (800.0, 360.0),       # wide ticket banner, no print constraint
    "a4": (A4[0], A4[1]),            # standard printable page
    "pvc": (85.6 * mm, 54.0 * mm),   # CR80 card (kiosk badge)
}


def _resolve_field_text(
    field: str, *, event: dict, order: dict, ticket: dict, organizer: dict,
) -> str:
    if field == "title":
        return event.get("title") or ""
    if field == "starts_at":
        return _format_dt(event.get("starts_at"), event.get("timezone", "America/Guayaquil"))
    if field == "venue":
        parts = [event.get("venue_name"), event.get("venue_city")]
        return " · ".join(p for p in parts if p)
    if field == "holder_name":
        return (ticket.get("holder") or {}).get("name") or "Sin nombre"
    if field == "holder_email":
        return (ticket.get("holder") or {}).get("email") or ""
    if field == "order_number":
        return order.get("order_number") or ""
    if field == "organizer_name":
        return organizer.get("company_name") or "Ticket Yourself"
    if field == "seat_or_raffle":
        seat_label = ticket.get("seat_label")
        if seat_label:
            return str(seat_label)
        raffle_number = ticket.get("raffle_number")
        return f"#{raffle_number}" if raffle_number else ""
    if field == "price":
        pricing = (event.get("pricing_type") or "free").lower()
        if pricing == "free":
            return "Gratis"
        if pricing == "donation":
            amt = (order.get("donation_amount_cents") or 0) / 100
            return f"Aporte ${amt:.2f}" if amt > 0 else "Aporte voluntario"
        unit = (event.get("base_price_cents") or 0) / 100
        return f"${unit:.2f} {event.get('currency', 'USD')}"
    return ""


def _draw_text_element(c, el: dict, *, x: float, y: float, w: float, h: float, value: str) -> None:
    font_size = int(el.get("font_size") or 14)
    c.setFont("Helvetica-Bold" if font_size >= 16 else "Helvetica", font_size)
    c.setFillColor(_hex_to_color(el.get("color") or "#1f1f33"))
    # Vertically center within the element's box; reportlab draws from baseline.
    baseline_y = y + (h - font_size) / 2 + font_size * 0.2
    align = el.get("align") or "left"
    text = value[:120]
    if align == "center":
        c.drawCentredString(x + w / 2, baseline_y, text)
    elif align == "right":
        c.drawRightString(x + w, baseline_y, text)
    else:
        c.drawString(x, baseline_y, text)


async def render_ticket_pdf_from_design(
    *, design: dict, event: dict, order: dict, ticket: dict, organizer: dict,
) -> bytes:
    """Renders a ticket from an organizer-defined visual design (M4). Element
    coordinates are fractions of the canvas — flip y (PDF origin is bottom-left,
    the designer's canvas origin is top-left)."""
    from services.assets import open_event_asset

    fmt = design.get("format") or "digital"
    page_w, page_h = FORMAT_PAGE_SIZES.get(fmt, FORMAT_PAGE_SIZES["digital"])

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(page_w, page_h))

    bg_color = design.get("background_color") or "#ffffff"
    c.setFillColor(_hex_to_color(bg_color) if bg_color != "#ffffff" else colors.white)
    c.rect(0, 0, page_w, page_h, fill=1, stroke=0)

    bg_url = design.get("background_url")
    if bg_url:
        try:
            img = await open_event_asset(bg_url)
            if img:
                c.drawImage(ImageReader(img), 0, 0, page_w, page_h, mask="auto")
        except Exception:
            logger.exception("Failed to draw ticket background %s", bg_url)

    for el in design.get("elements") or []:
        frac_x, frac_y = float(el.get("x") or 0), float(el.get("y") or 0)
        frac_w, frac_h = float(el.get("width") or 0), float(el.get("height") or 0)
        x = frac_x * page_w
        w = frac_w * page_w
        h = frac_h * page_h
        y = page_h - (frac_y * page_h) - h  # flip: canvas y-down → PDF y-up

        kind = el.get("type")
        if kind == "qr":
            qr_img = qrcode.make(ticket.get("qr_token", ""))
            qr_buf = io.BytesIO()
            qr_img.save(qr_buf, format="PNG")
            qr_buf.seek(0)
            c.drawImage(ImageReader(qr_buf), x, y, w, h)
        elif kind == "logo":
            url = el.get("image_url")
            if url:
                try:
                    img = await open_event_asset(url)
                    if img:
                        c.drawImage(ImageReader(img), x, y, w, h, mask="auto")
                except Exception:
                    logger.exception("Failed to draw ticket logo %s", url)
        elif kind == "text":
            field = el.get("field") or "custom"
            value = (
                el.get("text") or ""
                if field == "custom"
                else _resolve_field_text(field, event=event, order=order, ticket=ticket, organizer=organizer)
            )
            _draw_text_element(c, el, x=x, y=y, w=w, h=h, value=value)

    c.showPage()
    c.save()
    buf.seek(0)
    return buf.getvalue()


async def render_ticket_pdf(
    *,
    event: dict,
    order: dict,
    ticket: dict,
    organizer: dict,
    microsite: dict | None = None,
) -> bytes:
    """Return raw PDF bytes for a single ticket. Uses the organizer's M4
    visual design when set, falling back to the fixed default layout below."""
    design = event.get("ticket_design")
    if design and design.get("elements"):
        return await render_ticket_pdf_from_design(
            design=design, event=event, order=order, ticket=ticket, organizer=organizer,
        )

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

    # Phase 7 — numbered tickets show the seat label prominently
    seat_label = ticket.get("seat_label")
    has_seat = bool(seat_label)
    # §4.2.1 — donation events with raffle enabled show the raffle number
    raffle_number = ticket.get("raffle_number")
    has_raffle = bool(raffle_number) and not has_seat
    if has_seat:
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(colors.HexColor("#8c8ca6"))
        c.drawString(info_x, body_top - 192, "ASIENTO")
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(primary)
        c.drawString(info_x, body_top - 213, str(seat_label)[:42])
    elif has_raffle:
        c.setFont("Helvetica-Bold", 10)
        c.setFillColor(colors.HexColor("#8c8ca6"))
        c.drawString(info_x, body_top - 192, "N° DE RIFA")
        c.setFont("Helvetica-Bold", 16)
        c.setFillColor(primary)
        c.drawString(info_x, body_top - 213, f"#{raffle_number}")

    # Precio block — shift down when seat/raffle row is present
    has_extra_row = has_seat or has_raffle
    price_y_label = body_top - (245 if has_extra_row else 195)
    price_y_value = body_top - (263 if has_extra_row else 213)

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
    c.drawString(info_x, price_y_label, "PRECIO")
    c.setFont("Helvetica-Bold", 13)
    c.setFillColor(primary)
    c.drawString(info_x, price_y_value, price_label)

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
