"""Dátil electronic invoicing (SRI Ecuador).

Docs: https://datil.dev/#introduccion
  POST https://link.datil.co/invoices/issue
  Headers: X-Key, X-Password, Idempotency-key
  ambiente: 1 = pruebas, 2 = producción
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("tys.datil")

DEFAULT_API_BASE = "https://link.datil.co"
CONSUMIDOR_FINAL_ID = "9999999999999"

# SRI IVA percentage → (codigo_porcentaje, tarifa)
IVA_PERCENT_CODES: dict[int, tuple[str, float]] = {
    0: ("0", 0.0),
    5: ("5", 5.0),
    12: ("2", 12.0),
    13: ("10", 13.0),
    14: ("3", 14.0),
    15: ("4", 15.0),
}

PAYMENT_MEDIO: dict[str, str] = {
    "stripe": "tarjeta_credito",
    "nuvei": "tarjeta_credito",
    "deuna": "tarjeta_credito",
    "paypal": "tarjeta_credito",
    "transfer": "transferencia",
    "cash": "efectivo",
    "demo": "otros",
    "season_pass": "otros",
}

ID_TYPE_ALIASES: dict[str, str] = {
    "04": "04",
    "ruc": "04",
    "05": "05",
    "cedula": "05",
    "cédula": "05",
    "06": "06",
    "pasaporte": "06",
    "passport": "06",
    "07": "07",
    "consumidor_final": "07",
    "consumidor final": "07",
    "final": "07",
    "08": "08",
    "exterior": "08",
    "identificacion_exterior": "08",
}


class DatilError(RuntimeError):
    def __init__(self, message: str, *, status_code: int | None = None, body: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


def _cfg() -> dict[str, str]:
    return {
        "api_key": os.environ.get("DATIL_API_KEY", "").strip(),
        "cert_password": os.environ.get("DATIL_CERT_PASSWORD", "").strip(),
        "api_base": (
            os.environ.get("DATIL_API_BASE", "").strip().rstrip("/") or DEFAULT_API_BASE
        ),
        "ambiente": os.environ.get("DATIL_AMBIENTE", "1").strip() or "1",
        "emisor_ruc": os.environ.get("DATIL_EMISOR_RUC", "").strip(),
        "emisor_razon_social": os.environ.get("DATIL_EMISOR_RAZON_SOCIAL", "").strip(),
        "emisor_nombre_comercial": os.environ.get(
            "DATIL_EMISOR_NOMBRE_COMERCIAL", ""
        ).strip(),
        "emisor_direccion": os.environ.get("DATIL_EMISOR_DIRECCION", "").strip(),
        "establecimiento": os.environ.get("DATIL_ESTABLECIMIENTO", "001").strip()
        or "001",
        "punto_emision": os.environ.get("DATIL_PUNTO_EMISION", "001").strip() or "001",
        "contribuyente_especial": os.environ.get(
            "DATIL_CONTRIBUYENTE_ESPECIAL", ""
        ).strip(),
        "obligado_contabilidad": os.environ.get(
            "DATIL_OBLIGADO_CONTABILIDAD", "true"
        ).strip(),
        "iva_percent": os.environ.get("DATIL_IVA_PERCENT", "15").strip() or "15",
    }


def is_configured() -> bool:
    """Platform Dátil credentials (API key + certificate password).

    Emisor RUC / razón social / dirección live on the organizer (registro),
    not in env. ``DATIL_EMISOR_*`` remains a last-resort fallback for tests.
    """
    c = _cfg()
    return bool(c["api_key"] and c["cert_password"])


def ambiente() -> int:
    """SRI environment. Tests/staging default to 1; prod sets DATIL_AMBIENTE=2."""
    raw = _cfg()["ambiente"]
    try:
        value = int(raw)
    except (TypeError, ValueError):
        value = 1
    return 2 if value == 2 else 1


def normalize_iva_percent(raw, default: int = 15) -> int:
    if raw is None or raw == "":
        fallback = default if default in IVA_PERCENT_CODES else 15
        return fallback
    try:
        pct = int(float(raw))
    except (TypeError, ValueError):
        pct = default if default in IVA_PERCENT_CODES else 15
    if pct not in IVA_PERCENT_CODES:
        return default if default in IVA_PERCENT_CODES else 15
    return pct


def default_event_iva_percent(
    *,
    pricing_type: str | None = None,
    optional_donation_enabled: bool = False,
    country_code: str | None = None,
) -> int:
    """IVA of the *product* (the event), not of the issuer.

    Paid / donation / optional-donation events in Ecuador default to 15%.
    Free events (no money collected) default to 0%.
    """
    paid_like = (pricing_type or "") in {"paid", "donation"} or bool(
        optional_donation_enabled
    )
    if not paid_like:
        return 0
    if (country_code or "EC").upper() == "EC":
        return 15
    return 0


def iva_percent(
    event: dict | None = None,
    organizer_config: dict | None = None,
) -> int:
    """Resolve IVA: event override → organizer default → env fallback (15)."""
    for raw in (
        (event or {}).get("iva_percent"),
        (organizer_config or {}).get("iva_percent"),
        _cfg()["iva_percent"],
    ):
        if raw is None or raw == "":
            continue
        return normalize_iva_percent(raw, default=15)
    return 15


def cents_to_amount(cents: int) -> float:
    return round(max(0, int(cents or 0)) / 100.0, 2)


def split_iva_inclusive(total_cents: int, percent: int) -> tuple[int, int]:
    """Split an IVA-inclusive amount into (base_cents, iva_cents) that sum to total."""
    total = max(0, int(total_cents or 0))
    if percent <= 0 or total == 0:
        return total, 0
    base = int(round(total / (1 + percent / 100.0)))
    iva = total - base
    return base, iva


def infer_id_type(
    document_id: str | None, document_type: str | None = None
) -> tuple[str, str]:
    """Return (tipo_identificacion SRI, identificacion)."""
    explicit = (document_type or "").strip().lower()
    digits = re.sub(r"\D", "", document_id or "")
    raw = (document_id or "").strip()

    if explicit in ID_TYPE_ALIASES:
        code = ID_TYPE_ALIASES[explicit]
        if code == "07" or not raw:
            return "07", CONSUMIDOR_FINAL_ID
        if code == "04":
            return "04", digits or raw
        if code == "05":
            return "05", digits or raw
        return code, raw or digits or CONSUMIDOR_FINAL_ID

    if not raw:
        return "07", CONSUMIDOR_FINAL_ID
    if len(digits) == 13:
        return "04", digits
    if len(digits) == 10:
        return "05", digits
    return "06", raw


def payment_medio(payment_method: str | None) -> str:
    return PAYMENT_MEDIO.get((payment_method or "").lower(), "otros")


def _pad3(value: str | None, default: str = "001") -> str:
    raw = re.sub(r"\D", "", value or "") or default
    return raw[-3:].zfill(3)


def einvoice_config_from_registration(
    *,
    company_name: str,
    legal_id: str,
    org_type: str = "company",
    country_code: str | None = None,
    legal_name: str | None = None,
    legal_address: str | None = None,
    establecimiento: str | None = None,
    punto_emision: str | None = None,
    iva_percent_value: int | None = None,
) -> dict | None:
    """Build ``organizer.einvoice_config`` from signup / seed data.

    Only Ecuador issuers are stored; other countries skip SRI invoicing.
    """
    code = (country_code or "").upper().strip()
    if code and code != "EC":
        return None
    ruc = re.sub(r"\D", "", legal_id or "")
    if not ruc:
        return None
    razon = (legal_name or "").strip() or (company_name or "").strip()
    return {
        "enabled": True,
        "ruc": ruc,
        "razon_social": razon[:300],
        "nombre_comercial": (company_name or "").strip()[:300],
        "direccion": (legal_address or "").strip()[:300],
        "establecimiento": _pad3(establecimiento or "001"),
        "punto_emision": _pad3(punto_emision or "001"),
        "obligado_contabilidad": org_type == "company",
        "iva_percent": normalize_iva_percent(iva_percent_value, default=15),
    }


def _truthy(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "si", "sí"}


def resolve_credentials(organizer_config: dict | None = None) -> dict[str, str]:
    """Organizer Datil keys override platform env when both present."""
    c = _cfg()
    org = organizer_config or {}
    api_key = (org.get("api_key") or "").strip() or c["api_key"]
    cert_password = (org.get("cert_password") or "").strip() or c["cert_password"]
    return {
        "api_key": api_key,
        "cert_password": cert_password,
        "api_base": c["api_base"],
    }


def credentials_ready(organizer_config: dict | None = None) -> bool:
    creds = resolve_credentials(organizer_config)
    emisor = build_emisor(organizer=None, organizer_config=organizer_config)
    return bool(creds["api_key"] and creds["cert_password"] and emisor.get("ruc"))


def build_emisor(
    *, organizer: dict | None = None, organizer_config: dict | None = None
) -> dict[str, Any]:
    c = _cfg()
    org = organizer or {}
    cfg = organizer_config or org.get("einvoice_config") or {}
    if not isinstance(cfg, dict):
        cfg = {}

    ruc = (
        (cfg.get("ruc") or "").strip()
        or c["emisor_ruc"]
        or re.sub(r"\D", "", str(org.get("legal_id") or ""))
    )
    razon = (
        (cfg.get("razon_social") or "").strip()
        or c["emisor_razon_social"]
        or (org.get("company_name") or "").strip()
        or "Ticket Yourself"
    )
    comercial = (
        (cfg.get("nombre_comercial") or "").strip()
        or c["emisor_nombre_comercial"]
        or razon
    )
    direccion = (
        (cfg.get("direccion") or "").strip() or c["emisor_direccion"] or "Ecuador"
    )
    establecimiento = _pad3(cfg.get("establecimiento") or c["establecimiento"])
    punto = _pad3(cfg.get("punto_emision") or c["punto_emision"])
    contrib = (
        cfg.get("contribuyente_especial")
        if cfg.get("contribuyente_especial") is not None
        else c["contribuyente_especial"]
    )
    obligado = cfg.get("obligado_contabilidad")
    if obligado is None:
        obligado = _truthy(c["obligado_contabilidad"])
    else:
        obligado = _truthy(obligado)

    return {
        "ruc": ruc,
        "obligado_contabilidad": bool(obligado),
        "contribuyente_especial": str(contrib or ""),
        "nombre_comercial": comercial[:300],
        "razon_social": razon[:300],
        "direccion": direccion[:300],
        "establecimiento": {
            "codigo": establecimiento,
            "punto_emision": punto,
            "direccion": direccion[:300],
        },
    }


def issuer_key(emisor: dict[str, Any]) -> str:
    est = emisor.get("establecimiento") or {}
    return f"{emisor.get('ruc')}:{est.get('codigo')}:{est.get('punto_emision')}"


def _item_tax(base_cents: int, iva_cents: int, percent: int) -> dict[str, Any]:
    code, tarifa = IVA_PERCENT_CODES[percent]
    return {
        "codigo": "2",
        "codigo_porcentaje": code,
        "tarifa": tarifa,
        "base_imponible": cents_to_amount(base_cents),
        "valor": cents_to_amount(iva_cents),
    }


def _line_item(
    *,
    description: str,
    code: str,
    quantity: int,
    line_total_cents: int,
    discount_cents: int,
    percent: int,
) -> dict[str, Any]:
    qty = max(1, int(quantity or 1))
    taxable = max(0, int(line_total_cents or 0))
    disc = min(max(0, int(discount_cents or 0)), taxable)
    net = taxable - disc
    base, iva = split_iva_inclusive(net, percent)
    unit_base = round(cents_to_amount(base) / qty, 6) if qty else 0.0
    return {
        "cantidad": float(qty),
        "codigo_principal": (code or "ENT")[:25],
        "descripcion": (description or "Entrada")[:300],
        "precio_unitario": unit_base,
        "descuento": cents_to_amount(disc),
        "precio_total_sin_impuestos": cents_to_amount(base),
        "impuestos": [_item_tax(base, iva, percent)],
    }


def build_invoice_payload(
    *,
    order: dict,
    event: dict,
    organizer: dict | None = None,
    sequential: int,
    issued_at: datetime | None = None,
    organizer_config: dict | None = None,
) -> dict[str, Any]:
    percent = iva_percent(event=event, organizer_config=organizer_config)
    emisor = build_emisor(organizer=organizer, organizer_config=organizer_config)
    buyer = order.get("buyer") or {}
    tipo, identificacion = infer_id_type(
        buyer.get("document_id") or buyer.get("identificacion"),
        buyer.get("document_type") or buyer.get("tipo_identificacion"),
    )
    when = issued_at or datetime.now(timezone.utc)
    event_title = (event.get("title") or "Evento")[:200]
    items_src = list(order.get("items") or [])
    discount_total = int(order.get("discount_total_cents") or 0)
    fees_cents = int(order.get("fees_cents") or 0)
    subtotal_cents = int(order.get("subtotal_cents") or 0)
    total_cents = int(order.get("total_cents") or 0)

    datil_items: list[dict[str, Any]] = []
    remaining_discount = discount_total
    if items_src:
        for idx, raw in enumerate(items_src):
            qty = max(1, int(raw.get("quantity") or 1))
            line_cents = int(raw.get("subtotal_cents") or 0)
            if line_cents <= 0:
                unit = int(raw.get("unit_price_cents") or 0)
                line_cents = unit * qty
            share = 0
            if remaining_discount and subtotal_cents > 0:
                share = min(
                    remaining_discount,
                    (
                        int(round(discount_total * line_cents / subtotal_cents))
                        if idx < len(items_src) - 1
                        else remaining_discount
                    ),
                )
                remaining_discount -= share
            name = raw.get("ticket_type") or raw.get("name") or "Entrada"
            datil_items.append(
                _line_item(
                    description=f"{event_title} · {name}",
                    code=str(
                        raw.get("ticket_type_id") or raw.get("ticket_type") or "ENT"
                    )[:25],
                    quantity=qty,
                    line_total_cents=line_cents,
                    discount_cents=share,
                    percent=percent,
                )
            )
    elif total_cents > 0:
        datil_items.append(
            _line_item(
                description=f"{event_title} · Entradas",
                code="ENT",
                quantity=max(1, int(order.get("quantity_total") or 1)),
                line_total_cents=max(0, total_cents - fees_cents),
                discount_cents=0,
                percent=percent,
            )
        )

    if fees_cents > 0:
        datil_items.append(
            _line_item(
                description="Cargo de servicio Ticket Yourself",
                code="FEE",
                quantity=1,
                line_total_cents=fees_cents,
                discount_cents=0,
                percent=percent,
            )
        )

    if not datil_items:
        datil_items.append(
            _line_item(
                description=f"{event_title} · Entrada",
                code="ENT",
                quantity=1,
                line_total_cents=0,
                discount_cents=0,
                percent=percent,
            )
        )

    base_sum = sum(
        int(round(float(it["precio_total_sin_impuestos"]) * 100)) for it in datil_items
    )
    iva_sum = sum(
        int(round(float((it["impuestos"][0]["valor"])) * 100)) for it in datil_items
    )
    disc_sum = sum(int(round(float(it["descuento"]) * 100)) for it in datil_items)
    importe = base_sum + iva_sum

    # Keep SRI totals aligned with what the buyer paid when rounding drifted.
    paid = total_cents if total_cents > 0 else importe
    if paid != importe and datil_items:
        drift = paid - importe
        last_tax = datil_items[-1]["impuestos"][0]
        last_tax["valor"] = round(float(last_tax["valor"]) + drift / 100.0, 2)
        iva_sum += drift
        importe = paid

    code, _tarifa = IVA_PERCENT_CODES[percent]
    comprador_dir = (
        buyer.get("address") or buyer.get("direccion") or ""
    ).strip() or "Ecuador"
    payload: dict[str, Any] = {
        "ambiente": ambiente(),
        "tipo_emision": 1,
        "secuencial": int(sequential),
        "fecha_emision": when.astimezone(timezone.utc)
        .isoformat()
        .replace("+00:00", "Z"),
        "emisor": emisor,
        "moneda": "USD",
        "totales": {
            "total_sin_impuestos": cents_to_amount(base_sum),
            "descuento": cents_to_amount(disc_sum),
            "propina": 0.0,
            "importe_total": cents_to_amount(importe),
            "impuestos": [
                {
                    "codigo": "2",
                    "codigo_porcentaje": code,
                    "base_imponible": cents_to_amount(base_sum),
                    "valor": cents_to_amount(iva_sum),
                }
            ],
        },
        "comprador": {
            "email": (buyer.get("email") or "")[:100],
            "identificacion": identificacion,
            "tipo_identificacion": tipo,
            "razon_social": (
                buyer.get("name") or buyer.get("razon_social") or "Consumidor final"
            )[:300],
            "direccion": comprador_dir[:300],
            "telefono": (buyer.get("phone") or "")[:20],
        },
        "items": datil_items,
        "pagos": [
            {
                "medio": payment_medio(order.get("payment_method")),
                "total": cents_to_amount(importe),
            }
        ],
        "info_adicional": [
            {"nombre": "Orden", "valor": str(order.get("order_number") or "")},
            {"nombre": "Evento", "valor": event_title[:300]},
        ],
    }
    return payload


async def issue_invoice(
    payload: dict[str, Any],
    *,
    idempotency_key: str,
    organizer_config: dict | None = None,
) -> dict[str, Any]:
    creds = resolve_credentials(organizer_config)
    if not creds["api_key"] or not creds["cert_password"]:
        raise DatilError(
            "Dátil no está configurado (DATIL_API_KEY / DATIL_CERT_PASSWORD)"
        )
    headers = {
        "Content-Type": "application/json",
        "X-Key": creds["api_key"],
        "X-Password": creds["cert_password"],
        "Idempotency-key": idempotency_key[:48],
    }
    url = f"{creds['api_base']}/invoices/issue"
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=headers)
    if resp.status_code >= 400:
        logger.error("Datil issue failed: %s %s", resp.status_code, resp.text[:400])
        raise DatilError(
            f"Dátil error {resp.status_code}",
            status_code=resp.status_code,
            body=resp.text[:1000],
        )
    return resp.json()


async def get_invoice(
    datil_id: str, *, organizer_config: dict | None = None
) -> dict[str, Any]:
    creds = resolve_credentials(organizer_config)
    if not creds["api_key"]:
        raise DatilError("Dátil no está configurado")
    headers = {"Content-Type": "application/json", "X-Key": creds["api_key"]}
    url = f"{creds['api_base']}/invoices/{datil_id}"
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(url, headers=headers)
    if resp.status_code >= 400:
        logger.error("Datil get failed: %s %s", resp.status_code, resp.text[:400])
        raise DatilError(
            f"Dátil error {resp.status_code}",
            status_code=resp.status_code,
            body=resp.text[:1000],
        )
    return resp.json()


def public_invoice_view(row: dict[str, Any] | None) -> Optional[dict[str, Any]]:
    if not row:
        return None
    return {
        "id": row.get("id"),
        "order_id": row.get("order_id"),
        "estado": row.get("estado"),
        "ambiente": row.get("ambiente"),
        "secuencial": row.get("secuencial"),
        "numero": row.get("numero"),
        "clave_acceso": row.get("clave_acceso"),
        "ride_url": row.get("ride_url"),
        "xml_url": row.get("xml_url"),
        "error_message": row.get("error_message"),
        "issued_at": row.get("issued_at"),
        "authorized_at": row.get("authorized_at"),
    }
