"""
Factory + helpers for the Microsite document.
A microsite is auto-created 1:1 with the organizer on first access to the editor
(or when the organizer is approved). All defaults live here.
"""
import uuid
from datetime import datetime, timezone

DEFAULT_PRIMARY = "#4f46e5"   # indigo-600
DEFAULT_SECONDARY = "#f1f5f9"  # slate-100
DEFAULT_FONT = "Inter"

TEMPLATES = ("estandar", "galeria", "evento_unico")
FONTS = ("Inter", "Playfair Display", "Poppins")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_microsite(*, organizer_id: str, tenant_slug: str, company_name: str) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "organizer_id": organizer_id,
        "tenant_slug": tenant_slug,
        "template": "estandar",
        "branding": {
            "primary_color": DEFAULT_PRIMARY,
            "secondary_color": DEFAULT_SECONDARY,
            "logo_url": None,
            "banner_url": None,
            "font_family": DEFAULT_FONT,
        },
        "content": {
            "hero_title": company_name,
            "hero_subtitle": "Eventos en vivo, tickets sin complicaciones.",
            "hero_cta_text": "Ver eventos",
            "about_title": "Sobre nosotros",
            "about_body": (
                "Somos un equipo apasionado por crear experiencias inolvidables. "
                "Descubrí nuestros próximos eventos y unite a la comunidad."
            ),
            "contact_email": "",
            "contact_phone": "",
            "address": "",
        },
        "social_links": {
            "instagram": "",
            "facebook": "",
            "twitter": "",
            "tiktok": "",
            "youtube": "",
            "whatsapp": "",
        },
        "sections_enabled": {
            "hero": True,
            "about": True,
            "events": True,
            "contact": True,
            "social": True,
        },
        "published": False,
        "created_at": _now_iso(),
        "updated_at": _now_iso(),
    }
