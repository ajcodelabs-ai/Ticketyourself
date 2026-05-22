"""
Email service with dual-mode delivery:
  - Resend API when RESEND_API_KEY is configured (production).
  - Filesystem mock at /app/backend/email_log/{timestamp}_{email}.html otherwise
    (development / preview).

The mock log is intentionally simple so we can browse the actual rendered HTML
during testing without setting up a real provider.
"""
import asyncio
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import resend

logger = logging.getLogger("tys.email")

EMAIL_LOG_DIR = Path(__file__).resolve().parent.parent / "email_log"
EMAIL_LOG_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SENDER = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")
_API_KEY = os.environ.get("RESEND_API_KEY", "").strip()
if _API_KEY:
    resend.api_key = _API_KEY


def _sanitize_filename(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]", "_", value)[:80]


def _is_real_resend() -> bool:
    return bool(_API_KEY)


async def _send_resend(to: str, subject: str, html: str, text: Optional[str] = None) -> dict:
    params = {
        "from": DEFAULT_SENDER,
        "to": [to],
        "subject": subject,
        "html": html,
    }
    if text:
        params["text"] = text
    # Resend SDK is sync — run in thread to keep FastAPI non-blocking.
    return await asyncio.to_thread(resend.Emails.send, params)


async def _send_mock(to: str, subject: str, html: str) -> dict:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    safe_email = _sanitize_filename(to)
    fname = EMAIL_LOG_DIR / f"{ts}_{safe_email}.html"
    wrapper = (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{subject}</title>"
        f"<style>body{{font-family:system-ui,sans-serif;background:#f5f5fa;padding:24px;}}"
        f".meta{{background:#fff7ed;border:1px solid #fdba74;padding:12px;border-radius:8px;margin-bottom:16px;font-size:13px;color:#7c2d12;}}"
        f".email{{background:#fff;border-radius:8px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.1);}}"
        f"</style></head><body>"
        f"<div class='meta'><strong>MOCK EMAIL</strong> · "
        f"to: {to} · subject: {subject} · ts: {ts}<br>"
        f"<em>This file exists because RESEND_API_KEY is not configured. "
        f"Set it in /app/backend/.env to send real emails.</em></div>"
        f"<div class='email'>{html}</div>"
        f"</body></html>"
    )
    fname.write_text(wrapper, encoding="utf-8")
    logger.info("Mock email written → %s", fname.name)
    return {"id": f"mock_{ts}", "mock_file": str(fname)}


async def send_email(to: str, subject: str, html: str, text: Optional[str] = None) -> dict:
    """
    Public entrypoint. Returns a dict {"id": "...", "mock_file"?: "..."}.
    Never raises — errors are logged. Callers should NOT block their flow on emails.
    """
    try:
        if _is_real_resend():
            result = await _send_resend(to, subject, html, text)
            logger.info("Resend → %s subject=%r id=%s", to, subject, result.get("id"))
            return {"id": result.get("id", "")}
        return await _send_mock(to, subject, html)
    except Exception as exc:  # noqa: BLE001
        logger.error("Email send failed to=%s subject=%r err=%s", to, subject, exc)
        return {"id": "", "error": str(exc)}


# ── Welcome email template ───────────────────────────────────────────────────
def render_welcome_html(*, company_name: str, continue_url: str) -> str:
    """Inline-CSS HTML email body. No external assets — best email-client support."""
    return f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f4f4f9;padding:32px 0;font-family:Helvetica,Arial,sans-serif;color:#1f1f33;">
  <tr>
    <td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="560"
             style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6f0;">
        <tr>
          <td style="background:#4f46e5;padding:24px 32px;color:#ffffff;">
            <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">
              Ticket Yourself
            </div>
            <div style="font-size:22px;font-weight:600;margin-top:4px;">
              Bienvenido a TYS, {company_name}.
            </div>
          </td>
        </tr>
        <tr>
          <td style="padding:32px;line-height:1.55;font-size:15px;color:#33334a;">
            <p style="margin:0 0 12px;">Gracias por crear tu cuenta de organizador.</p>
            <p style="margin:0 0 16px;">Para activarla, completá estos pasos:</p>
            <ol style="margin:0 0 20px 22px;padding:0;color:#33334a;">
              <li style="margin-bottom:6px;">Subí tus documentos (cédula o RUC).</li>
              <li style="margin-bottom:6px;">Elegí un plan que se adapte a tus eventos.</li>
              <li>Completá el pago con Stripe y tu cuenta queda lista.</li>
            </ol>
            <table cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td align="center" style="background:#4f46e5;border-radius:10px;">
                  <a href="{continue_url}"
                     style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;
                            font-weight:600;font-size:15px;">
                    Continuar configuración
                  </a>
                </td>
              </tr>
            </table>
            <p style="margin:24px 0 0;color:#6e6e84;font-size:13px;">
              El link es válido por 7 días. Si tenés dudas, respondé este correo y te ayudamos.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f4f4f9;padding:16px 32px;color:#8c8ca6;font-size:12px;text-align:center;">
            Ticket Yourself · Ecuador
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
""".strip()


async def send_welcome_email(*, to: str, company_name: str, continue_url: str) -> dict:
    html = render_welcome_html(company_name=company_name, continue_url=continue_url)
    text = (
        f"Bienvenido a Ticket Yourself, {company_name}.\n\n"
        "Para activar tu cuenta:\n"
        "1. Subí tus documentos.\n"
        "2. Elegí un plan.\n"
        "3. Pagá la suscripción.\n\n"
        f"Continuar: {continue_url}\n"
    )
    return await send_email(
        to=to,
        subject="Bienvenido a Ticket Yourself — tu cuenta está casi lista",
        html=html,
        text=text,
    )


# ── Ticket purchase confirmation ─────────────────────────────────────────────
def render_purchase_html(
    *,
    order: dict,
    event: dict,
    organizer: dict,
    tickets: list[dict],
    primary_color: str,
    frontend_base: str,
) -> str:
    rows = "".join(
        f"""
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #e6e6f0;">
            <div style="font-weight:600;color:#1f1f33;">{ t.get('holder', {}).get('name','Asistente') }</div>
            <div style="font-size:13px;color:#6e6e84;">{ t.get('holder', {}).get('email','') }</div>
          </td>
          <td align="right" style="padding:10px 0;border-bottom:1px solid #e6e6f0;">
            <a href="{frontend_base}/api/public/orders/{order['order_number']}/tickets/{t['id']}/pdf"
               style="color:{primary_color};text-decoration:none;font-weight:600;font-size:13px;">
              Descargar PDF →
            </a>
          </td>
        </tr>
        """
        for t in tickets
    )

    qty = order["quantity_total"]
    total = f"${(order['total_cents'] / 100):.2f} {order.get('currency', 'USD')}"
    success_url = f"{frontend_base}/o/{organizer['slug']}/orden/{order['order_number']}"

    return f"""
<table cellpadding="0" cellspacing="0" border="0" width="100%"
       style="background:#f4f4f9;padding:32px 0;font-family:Helvetica,Arial,sans-serif;color:#1f1f33;">
  <tr><td align="center">
    <table cellpadding="0" cellspacing="0" border="0" width="560"
           style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e6e6f0;">
      <tr><td style="background:{primary_color};padding:24px 32px;color:#ffffff;">
        <div style="font-size:13px;letter-spacing:2px;text-transform:uppercase;opacity:.8;">
          {organizer.get('company_name', 'Ticket Yourself')}
        </div>
        <div style="font-size:22px;font-weight:600;margin-top:4px;">
          ¡Tu entrada está lista!
        </div>
      </td></tr>
      <tr><td style="padding:32px;line-height:1.55;font-size:15px;color:#33334a;">
        <p style="margin:0 0 6px;font-size:18px;font-weight:600;">{event.get('title','')}</p>
        <p style="margin:0 0 16px;color:#6e6e84;">{event.get('venue_name','')}</p>
        <p style="margin:0 0 4px;color:#6e6e84;font-size:13px;">Orden</p>
        <p style="margin:0 0 16px;font-weight:600;">{order['order_number']} · {qty} entrada{'s' if qty != 1 else ''} · {total}</p>

        <table cellpadding="0" cellspacing="0" border="0" width="100%">{rows}</table>

        <table cellpadding="0" cellspacing="0" border="0" style="margin-top:24px;">
          <tr><td align="center" style="background:{primary_color};border-radius:10px;">
            <a href="{success_url}"
               style="display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;">
              Ver tickets en línea
            </a>
          </td></tr>
        </table>
        <p style="margin:24px 0 0;color:#6e6e84;font-size:13px;">
          Cada ticket es único e incluye un código QR. Presentalo en la entrada del evento.
        </p>
      </td></tr>
      <tr><td style="background:#f4f4f9;padding:16px 32px;color:#8c8ca6;font-size:12px;text-align:center;">
        Ticket Yourself · {organizer.get('company_name', '')}
      </td></tr>
    </table>
  </td></tr>
</table>
""".strip()


async def send_purchase_confirmation(
    *,
    order: dict,
    event: dict,
    organizer: dict,
    tickets: list,
) -> dict:
    frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
    primary = "#4f46e5"
    try:
        microsite = await __import__("db", fromlist=["db"]).db.microsites.find_one(
            {"organizer_id": order["organizer_id"]},
            {"_id": 0, "branding": 1},
        )
        if microsite and microsite.get("branding", {}).get("primary_color"):
            primary = microsite["branding"]["primary_color"]
    except Exception:  # noqa: BLE001
        pass

    html = render_purchase_html(
        order=order,
        event=event,
        organizer=organizer,
        tickets=tickets,
        primary_color=primary,
        frontend_base=frontend or "",
    )
    subject = f"Tu entrada para {event.get('title','el evento')} — TYS"
    return await send_email(to=order["buyer"]["email"], subject=subject, html=html)
