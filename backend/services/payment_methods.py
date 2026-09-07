"""Payment method catalog helpers — dual-read of legacy + enabled_codes."""

from __future__ import annotations

from typing import Any

# Platform catalog for wizard / new events.
CATALOG_CODES = ("nuvei", "transfer", "cash")
# Retired gateways still present on old events → treated as Nuvei.
RETIRED_GATEWAY_ALIASES = {"stripe": "nuvei", "deuna": "nuvei", "paypal": "nuvei"}
GATEWAY_STUB_CODES = ()
MANUAL_CODES = ("transfer", "cash")


def _canonical_code(code: str) -> str:
    lowered = code.strip().lower()
    return RETIRED_GATEWAY_ALIASES.get(lowered, lowered)


def resolve_enabled_codes(pm: dict | None) -> list[str]:
    """Return enabled payment codes for an event's payment_methods JSON.

    Prefer ``enabled_codes`` when present; otherwise map legacy
    ``{stripe,transfer,cash}.enabled`` flags. Stripe/DEUNA/PayPal aliases
    resolve to Nuvei so eventos viejos siguen cobrando.
    """
    pm = pm or {}
    raw = pm.get("enabled_codes")
    if isinstance(raw, list):
        out: list[str] = []
        for c in raw:
            if not isinstance(c, str):
                continue
            code = _canonical_code(c)
            if code in CATALOG_CODES and code not in out:
                out.append(code)
        return out

    codes: list[str] = []
    if (pm.get("stripe") or {}).get("enabled"):
        codes.append("nuvei")
    if (pm.get("transfer") or {}).get("enabled"):
        codes.append("transfer")
    if (pm.get("cash") or {}).get("enabled"):
        codes.append("cash")
    return codes


def accepts_payment_method(event: dict, payment_method: str) -> bool:
    if payment_method == "season_pass":
        return True
    code = _canonical_code(payment_method)
    return code in resolve_enabled_codes(event.get("payment_methods") or {})


def normalize_payment_methods(
    pm: dict | None,
    *,
    allowed_codes: set[str] | None = None,
) -> dict[str, Any]:
    """Normalize to the canonical shape stored on events.

    Validates codes ⊆ allowed_codes (active catalog) when provided.
    Syncs transfer/cash ``enabled`` flags with ``enabled_codes``.
    """
    pm = dict(pm or {})

    # Validate raw enabled_codes against the active catalog before dual-read filtering.
    raw_codes = pm.get("enabled_codes")
    if allowed_codes is not None and isinstance(raw_codes, list):
        unknown = []
        for c in raw_codes:
            if not isinstance(c, str):
                continue
            code = _canonical_code(c)
            if code and code not in allowed_codes and code not in CATALOG_CODES:
                if c.strip().lower() not in unknown:
                    unknown.append(c.strip().lower())
        if unknown:
            # Retired aliases are accepted even if the catalog no longer lists them.
            still_unknown = [
                c for c in unknown if _canonical_code(c) not in CATALOG_CODES
            ]
            if still_unknown:
                raise ValueError(
                    f"Métodos de pago no válidos o inactivos: {', '.join(still_unknown)}"
                )

    codes = resolve_enabled_codes(pm)

    # New payloads without enabled_codes and without legacy flags → default Nuvei.
    if "enabled_codes" not in pm and not codes:
        codes = ["nuvei"]

    if allowed_codes is not None:
        codes = [c for c in codes if c in allowed_codes or c in CATALOG_CODES]
        codes = [c for c in codes if c in CATALOG_CODES]

    if not codes:
        raise ValueError("Debés seleccionar al menos una forma de pago.")

    transfer_in = pm.get("transfer") or {}
    cash_in = pm.get("cash") or {}
    transfer = {
        "enabled": "transfer" in codes,
        "bank_name": transfer_in.get("bank_name") or "",
        "account_number": transfer_in.get("account_number") or "",
        "account_holder": transfer_in.get("account_holder") or "",
        "instructions": transfer_in.get("instructions") or "",
    }
    cash = {
        "enabled": "cash" in codes,
        "location": cash_in.get("location") or "",
        "schedule": cash_in.get("schedule") or "",
        "contact": cash_in.get("contact") or "",
    }

    return {
        "enabled_codes": codes,
        "stripe": {"enabled": False},
        "transfer": transfer,
        "cash": cash,
    }


def default_payment_methods() -> dict[str, Any]:
    return normalize_payment_methods({"enabled_codes": ["nuvei"]})
