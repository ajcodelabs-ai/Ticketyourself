"""Nuvei Ecuador (Paymentez) — Checkout v3 (init_reference) + Link to Pay + webhook.

https://developers.paymentez.com/api/#init-reference
https://developers.paymentez.com/api/#payment-methods-linktopay
https://developers.paymentez.com/api/#webhook

Onboarding may send one pair or two:

- …-EC-CLIENT → ccapi Checkout v3 (`init_reference`) and the JS SDK.
- …-EC-SERVER / LINKTOPAY… → noccapi Link to Pay (`init_order`).

If only CLIENT exists, that pair signs both APIs. Refund, GET transaction and
webhook stoken try every configured pair (the charge may belong to either app).

Checkout v2 (`init_checkout` + payment_checkout_stable.js) is deprecated.
v3: backend POST /v2/transaction/init_reference/, browser opens
payment_checkout_3.0.0.min.js with `{ reference }`.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import time
from base64 import b64encode
from typing import Any, Optional

import httpx

logger = logging.getLogger("tys.nuvei")

# Checkout v3 JS: open({ reference }) after POST /v2/transaction/init_reference/.
CHECKOUT_JS_URL_REFERENCE = (
    "https://cdn.paymentez.com/ccapi/sdk/payment_checkout_3.0.0.min.js"
)

# status_detail 3 = Operation Successful (approved charge)
APPROVED_STATUS_DETAIL = 3
# Paymentez status 2 = Cancelled; details 7/8/34 = refund / chargeback / partial
CANCELLED_STATUSES = ("2", "cancelled", "canceled")
REFUND_STATUS_DETAILS = (7, 8, 34)


class NuveiError(Exception):
    """Raised when Paymentez/Nuvei EC returns an error or the HTTP call fails."""

    def __init__(self, message: str, *, err_code: Any = None, payload: Any = None):
        super().__init__(message)
        self.err_code = err_code
        self.payload = payload


_LOG_PAYLOAD_MAX = 4000
_GENERIC_CHECKOUT_ERROR = (
    "No pudimos iniciar el pago con Nuvei. Intentá de nuevo en unos minutos."
)


def _clip_payload(payload: Any, *, limit: int = _LOG_PAYLOAD_MAX) -> str:
    """JSON (or repr) of a Nuvei payload, truncated. Never include Auth-Token."""
    if payload is None:
        return ""
    try:
        text = json.dumps(payload, ensure_ascii=False, default=str)
    except TypeError:
        text = repr(payload)
    if len(text) > limit:
        return text[:limit] + f"…(+{len(text) - limit} chars)"
    return text


def describe_error(exc: NuveiError) -> str:
    """Full error for logs: message + HTTP code + gateway JSON."""
    parts = [str(exc)]
    if exc.err_code is not None:
        parts.append(f"err_code={exc.err_code}")
    clipped = _clip_payload(exc.payload)
    if clipped:
        parts.append(f"payload={clipped}")
    return " | ".join(parts)


def checkout_http_detail(exc: NuveiError) -> str:
    """502 body. In non-production, append the gateway message so DevTools shows it."""
    env = (os.environ.get("ENV") or "").strip().lower()
    if env == "production":
        return _GENERIC_CHECKOUT_ERROR
    extra = str(exc).strip()
    if not extra:
        return _GENERIC_CHECKOUT_ERROR
    return f"{_GENERIC_CHECKOUT_ERROR} [{extra}]"


def _env_name() -> str:
    """Return 'stg' or 'prod' for Paymentez env_mode / host selection."""
    raw = (os.environ.get("NUVEI_ENV") or "stg").strip().lower()
    if raw in ("live", "prod", "production"):
        return "prod"
    return "stg"


def _ccapi_base() -> str:
    override = (os.environ.get("NUVEI_API_BASE") or "").rstrip("/")
    if override:
        return override
    if _env_name() == "prod":
        return "https://ccapi.paymentez.com"
    return "https://ccapi-stg.paymentez.com"


def _noccapi_base() -> str:
    """Cash / Link to Pay host (not ccapi). https://developers.paymentez.com/api/#payment-methods-linktopay"""
    override = (os.environ.get("NUVEI_NOCCAPI_BASE") or "").rstrip("/")
    if override:
        return override
    if _env_name() == "prod":
        return "https://noccapi.paymentez.com"
    return "https://noccapi-stg.paymentez.com"


def _frontend_base() -> str:
    return (os.environ.get("FRONTEND_URL") or "").rstrip("/")


def _server_app_code() -> str:
    return (
        os.environ.get("NUVEI_SERVER_APP_CODE")
        or os.environ.get("NUVEI_APP_CODE")
        or os.environ.get("NUVEI_APPLICATION_CODE")
        or ""
    ).strip()


def _server_app_key() -> str:
    return (
        os.environ.get("NUVEI_SERVER_APP_KEY")
        or os.environ.get("NUVEI_APP_KEY")
        or os.environ.get("NUVEI_SECRET_KEY")
        or ""
    ).strip()


def _client_app_code() -> str:
    return (
        os.environ.get("NUVEI_CLIENT_APP_CODE")
        or os.environ.get("NUVEI_JS_APP_CODE")
        or ""
    ).strip()


def _client_app_key() -> str:
    return (
        os.environ.get("NUVEI_CLIENT_APP_KEY")
        or os.environ.get("NUVEI_JS_APP_KEY")
        or ""
    ).strip()


def _looks_like_client_app(code: str) -> bool:
    """Paymentez App Codes include CLIENT or SERVER in the name."""
    return "CLIENT" in (code or "").upper()


def _looks_like_server_app(code: str) -> bool:
    """True for a dedicated server / Link to Pay application (not …-EC-CLIENT)."""
    upper = (code or "").upper()
    if not upper or _looks_like_client_app(upper):
        return False
    return "SERVER" in upper or "LINKTOPAY" in upper


def _effective_client_code() -> str:
    explicit = _client_app_code()
    if explicit:
        return explicit
    code = _server_app_code()
    return code if _looks_like_client_app(code) else ""


def _effective_client_key() -> str:
    explicit = _client_app_key()
    if explicit:
        return explicit
    if _looks_like_client_app(_server_app_code()):
        return _server_app_key()
    return ""


def is_js_configured() -> bool:
    """True when a CLIENT-named (or explicit CLIENT) pair is available."""
    return bool(_effective_client_code() and _effective_client_key())


def is_server_configured() -> bool:
    """True when NUVEI_SERVER_* / NUVEI_APP_* are set (name may be …-EC-CLIENT)."""
    return bool(_server_app_code() and _server_app_key())


def is_configured() -> bool:
    """True when we can build an Auth-Token (CLIENT-only onboarding is enough)."""
    try:
        _auth_pair()
    except NuveiError:
        return False
    return True


def _credential_pairs() -> list[tuple[str, str]]:
    """Distinct (app_code, app_key) pairs from env, SERVER first then CLIENT."""
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    candidates = [
        (_server_app_code(), _server_app_key()) if is_server_configured() else ("", ""),
        (_effective_client_code(), _effective_client_key()),
    ]
    for code, key in candidates:
        if not (code and key):
            continue
        item = (code, key)
        if item in seen:
            continue
        seen.add(item)
        pairs.append(item)
    return pairs


def _auth_pair() -> tuple[str, str]:
    """Default Auth-Token pair: dedicated SERVER/Link to Pay, else CLIENT.

    A …-EC-CLIENT value in NUVEI_SERVER_* is treated as CLIENT, not as the
    noccapi application — Nuvei Ecuador often files the only pair there.
    """
    server_code, server_key = _server_app_code(), _server_app_key()
    if server_code and server_key and not _looks_like_client_app(server_code):
        return server_code, server_key
    code, key = _effective_client_code(), _effective_client_key()
    if code and key:
        return code, key
    if server_code and server_key:
        return server_code, server_key
    raise NuveiError(
        "Nuvei Ecuador credentials not configured "
        "(need NUVEI_CLIENT_APP_CODE + NUVEI_CLIENT_APP_KEY, "
        "or NUVEI_SERVER_APP_CODE + NUVEI_SERVER_APP_KEY)"
    )


def _ccapi_pair() -> tuple[str, str]:
    """Auth-Token for ccapi (Checkout v3 init_reference). Prefer CLIENT."""
    code, key = _effective_client_code(), _effective_client_key()
    if code and key:
        return code, key
    return _auth_pair()


def _linktopay_pair() -> tuple[str, str]:
    """Auth-Token for noccapi Link to Pay. Prefer a dedicated SERVER app."""
    server_code, server_key = _server_app_code(), _server_app_key()
    if (
        server_code
        and server_key
        and (
            _looks_like_server_app(server_code)
            or not _looks_like_client_app(server_code)
        )
    ):
        return server_code, server_key
    return _auth_pair()


def build_auth_token(
    *,
    server_application_code: Optional[str] = None,
    server_app_key: Optional[str] = None,
    unix_timestamp: Optional[str] = None,
) -> str:
    """
    Auth-Token = Base64(app_code;timestamp;SHA256(app_key + timestamp)).
    Token is valid ~15 seconds (UTC).
    """
    if server_application_code and server_app_key:
        code = server_application_code.strip()
        key = server_app_key.strip()
    else:
        code, key = _auth_pair()
        if server_application_code:
            code = server_application_code.strip()
        if server_app_key:
            key = server_app_key.strip()
    if not (code and key):
        raise NuveiError("Nuvei App Code / App Key not configured")
    ts = unix_timestamp or str(int(time.time()))
    uniq = hashlib.sha256(f"{key}{ts}".encode("utf-8")).hexdigest()
    raw = f"{code};{ts};{uniq}"
    return b64encode(raw.encode("utf-8")).decode("ascii")


def cents_to_amount(cents: int) -> float:
    """Paymentez amounts are decimal currency units (e.g. 1250 → 12.50)."""
    return round(int(cents) / 100, 2)


def amount_matches(
    reported_amount: Any, expected_cents: int, tolerance_cents: int = 1
) -> bool:
    """
    True if a Paymentez-reported amount (decimal currency units, e.g. "12.50")
    matches the expected amount in cents, within a small rounding tolerance.
    A malformed/missing reported_amount is treated as a mismatch (fail closed).
    """
    if reported_amount is None:
        return False
    try:
        reported_cents = round(float(reported_amount) * 100)
    except (TypeError, ValueError):
        return False
    return abs(reported_cents - int(expected_cents)) <= tolerance_cents


def amount_to_str(amount: float | int | str) -> str:
    return f"{float(amount):.2f}"


def notification_url() -> Optional[str]:
    """Public backend URL for Paymentez webhooks. Prefer BACKEND_PUBLIC_URL."""
    base = (
        os.environ.get("BACKEND_PUBLIC_URL")
        or os.environ.get("REACT_APP_BACKEND_URL")
        or ""
    ).rstrip("/")
    if not base:
        return None
    return f"{base}/api/nuvei/webhook"


def _require_server() -> tuple[str, str]:
    return _auth_pair()


def _request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    base: Optional[str] = None,
    auth_pair: Optional[tuple[str, str]] = None,
) -> dict:
    code, key = auth_pair or _auth_pair()
    url = f"{(base or _ccapi_base()).rstrip('/')}/{path.lstrip('/')}"
    headers = {
        "Content-Type": "application/json",
        "Auth-Token": build_auth_token(
            server_application_code=code, server_app_key=key
        ),
    }
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.request(method, url, headers=headers, json=json_body)
            try:
                data = resp.json()
            except Exception:  # noqa: BLE001
                data = {"raw": resp.text}
            if resp.status_code >= 400:
                err = data.get("error") if isinstance(data, dict) else None
                msg = None
                if isinstance(err, dict):
                    msg = err.get("description") or err.get("type") or err.get("help")
                if not msg and isinstance(data, dict):
                    msg = data.get("detail") or data.get("message")
                logger.warning(
                    "Nuvei HTTP %s %s %s app_code=%s request=%s response=%s",
                    method,
                    resp.status_code,
                    url,
                    code,
                    _clip_payload(json_body),
                    _clip_payload(data),
                )
                raise NuveiError(
                    msg or f"Nuvei HTTP {resp.status_code}",
                    err_code=resp.status_code,
                    payload=data,
                )
            if not isinstance(data, dict):
                logger.warning(
                    "Nuvei non-JSON %s %s app_code=%s response=%s",
                    method,
                    url,
                    code,
                    _clip_payload(data),
                )
                raise NuveiError("Nuvei returned non-JSON object", payload=data)
            if isinstance(data.get("error"), dict):
                err = data["error"]
                logger.warning(
                    "Nuvei error body %s %s app_code=%s request=%s response=%s",
                    method,
                    url,
                    code,
                    _clip_payload(json_body),
                    _clip_payload(data),
                )
                raise NuveiError(
                    err.get("description") or err.get("type") or "Nuvei error",
                    payload=data,
                )
            return data
    except httpx.HTTPError as e:
        logger.error(
            "Nuvei HTTP error on %s %s: %s %s",
            method,
            url,
            type(e).__name__,
            e,
        )
        raise NuveiError(f"Nuvei request failed: {type(e).__name__}: {e}") from e


def _should_try_next_pair(exc: NuveiError) -> bool:
    """True when this App Code is the wrong application for the host/txn."""
    if exc.err_code in (401, 403, 404):
        return True
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    detail = str(payload.get("detail") or exc).lower()
    return "application not found" in detail


def _request_trying_pairs(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
    base: Optional[str] = None,
) -> dict:
    """Refund / GET: the txn may belong to CLIENT or to the Link to Pay app."""
    pairs = _credential_pairs()
    if not pairs:
        raise NuveiError(
            "Nuvei Ecuador credentials not configured "
            "(need NUVEI_CLIENT_APP_CODE + NUVEI_CLIENT_APP_KEY, "
            "or NUVEI_SERVER_APP_CODE + NUVEI_SERVER_APP_KEY)"
        )
    last: Optional[NuveiError] = None
    for pair in pairs:
        try:
            return _request(
                method, path, json_body=json_body, base=base, auth_pair=pair
            )
        except NuveiError as e:
            last = e
            if _should_try_next_pair(e) and pair != pairs[-1]:
                logger.info(
                    "Nuvei %s %s failed for app_code=%s; trying next pair",
                    method,
                    path,
                    pair[0],
                )
                continue
            raise
    assert last is not None
    raise last


# Link to Pay link TTL. Ticket reservations last 15 min — keep the link in sync
# so a late payment cannot oversell. Billing/fees may pass a longer value.
LINKTOPAY_EXPIRATION_SECONDS = 15 * 60


def _absolute_url(path: str, *, origin: Optional[str] = None) -> str:
    base = (origin or _frontend_base()).rstrip("/")
    if not path:
        return base or ""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not path.startswith("/"):
        path = f"/{path}"
    return f"{base}{path}"


def checkout_return_urls(
    *,
    success_path: str,
    failure_path: Optional[str] = None,
    origin: Optional[str] = None,
) -> dict[str, str]:
    """Build the four Link to Pay redirect URLs from FRONTEND_URL (or origin)."""
    success = _absolute_url(success_path, origin=origin)
    failure = _absolute_url(failure_path or success_path, origin=origin)
    return {
        "success_url": success,
        "failure_url": failure,
        "pending_url": success,
        "review_url": success,
    }


def init_linktopay(
    *,
    amount_cents: int,
    currency: str = "USD",
    dev_reference: str,
    description: str,
    user_id: str,
    email: str,
    first_name: str,
    last_name: str,
    success_url: str,
    failure_url: str,
    pending_url: Optional[str] = None,
    review_url: Optional[str] = None,
    vat: float = 0,
    tax_percentage: float = 0,
    taxable_amount: Optional[float] = None,
    installments_type: int = 0,
    expiration_time: int = LINKTOPAY_EXPIRATION_SECONDS,
    allowed_payment_methods: Optional[list[str]] = None,
) -> dict[str, Any]:
    """POST /linktopay/init_order/ on noccapi.

    Docs: https://developers.paymentez.com/api/#payment-methods-linktopay
    Returns ``payment.payment_url`` — redirect the buyer; status arrives via webhook.
    """
    amount = cents_to_amount(amount_cents)
    currency = (currency or "USD").upper()
    taxable = float(taxable_amount) if taxable_amount is not None else amount
    success = _absolute_url(success_url)
    failure = _absolute_url(failure_url)
    pending = _absolute_url(pending_url or success_url)
    review = _absolute_url(review_url or success_url)
    if not (success and failure and pending and review):
        raise NuveiError(
            "Link to Pay requires success_url, failure_url, pending_url, review_url"
        )

    body: dict[str, Any] = {
        "user": {
            "id": str(user_id)[:250],
            "email": email,
            "name": (first_name or "Cliente")[:100],
            "last_name": (last_name or "TYS")[:100],
        },
        "order": {
            "dev_reference": str(dev_reference)[:100],
            "description": (description or "Ticket Yourself")[:250],
            "amount": amount,
            "vat": float(vat),
            "tax_percentage": float(tax_percentage),
            "taxable_amount": taxable,
            "installments_type": int(installments_type),
            "currency": currency,
        },
        "configuration": {
            "partial_payment": False,
            "expiration_time": int(expiration_time),
            "allowed_payment_methods": allowed_payment_methods or ["All"],
            "success_url": success[:500],
            "failure_url": failure[:500],
            "pending_url": pending[:500],
            "review_url": review[:500],
        },
    }

    data = _request(
        "POST",
        "linktopay/init_order/",
        json_body=body,
        base=_noccapi_base(),
        auth_pair=_linktopay_pair(),
    )
    if data.get("success") is False:
        raise NuveiError(
            data.get("detail") or "Nuvei Link to Pay failed",
            payload=data,
        )
    inner = data.get("data") if isinstance(data.get("data"), dict) else data
    order = inner.get("order") if isinstance(inner.get("order"), dict) else {}
    payment = inner.get("payment") if isinstance(inner.get("payment"), dict) else {}
    order_id = order.get("id")
    payment_url = payment.get("payment_url")
    if not order_id or not payment_url:
        raise NuveiError("Link to Pay missing payment_url", payload=data)

    return {
        "session_token": str(order_id),
        "reference": str(order_id),
        "order_id": str(order_id),
        "payment_url": str(payment_url),
        "checkout_url": str(payment_url),
        "client_unique_id": str(dev_reference),
        "dev_reference": str(dev_reference),
        "env": _env_name(),
        "amount": amount_to_str(amount),
        "currency": currency,
        "checkout_js_url": None,
        "checkout_mode": "linktopay",
        "client_app_code": None,
        "client_app_key": None,
        "js_credentials": "none",
        "merchant_id": "",
        "merchant_site_id": "",
        "raw": data,
    }


def init_reference(
    *,
    amount_cents: int,
    currency: str = "USD",
    dev_reference: str,
    description: str,
    user_id: str,
    email: str,
    vat: float = 0,
    locale: str = "es",
    installments_type: int = 0,
) -> dict[str, Any]:
    """POST /v2/transaction/init_reference/ on ccapi (card Checkout JS v3).

    Nuvei Ecuador recommended path for one-time payments (with 3DS).
    """
    amount = cents_to_amount(amount_cents)
    currency = (currency or "USD").upper()
    body: dict[str, Any] = {
        "locale": locale or "es",
        "origin": "CheckoutJs",
        "order": {
            "amount": amount,
            "description": (description or "Ticket Yourself")[:250],
            "vat": float(vat),
            "dev_reference": str(dev_reference)[:100],
            "installments_type": int(installments_type),
        },
        "user": {
            "id": str(user_id)[:64],
            "email": email,
        },
    }
    data = _request(
        "POST",
        "v2/transaction/init_reference/",
        json_body=body,
        auth_pair=_ccapi_pair(),
    )
    reference = data.get("reference")
    if not reference:
        raise NuveiError("init_reference missing reference", payload=data)
    checkout_url = data.get("checkout_url") or (
        f"{_ccapi_base()}/v2/transaction/checkout?reference={reference}"
    )
    return {
        "session_token": str(reference),
        "reference": str(reference),
        "order_id": str(reference),
        "payment_url": None,
        "checkout_url": checkout_url,
        "client_unique_id": str(dev_reference),
        "dev_reference": str(dev_reference),
        "env": _env_name(),
        "amount": amount_to_str(amount),
        "currency": currency,
        "checkout_js_url": CHECKOUT_JS_URL_REFERENCE,
        "checkout_mode": "reference",
        "client_app_code": None,
        "client_app_key": None,
        "js_credentials": "none",
        "merchant_id": "",
        "merchant_site_id": "",
        "raw": data,
    }


def _linktopay_unavailable(exc: NuveiError) -> bool:
    """True when noccapi does not know this App Code (cards-only application)."""
    payload = exc.payload if isinstance(exc.payload, dict) else {}
    detail = str(payload.get("detail") or exc).lower()
    return exc.err_code == 401 or "application not found" in detail


def prepare_js_checkout(
    *,
    amount_cents: int,
    currency: str = "USD",
    client_unique_id: str,
    user_id: str,
    email: str,
    phone: Optional[str] = None,
    first_name: str = "Cliente",
    last_name: str = "TYS",
    description: str = "",
) -> dict[str, Any]:
    """Return CLIENT credentials + order/user for PaymentCheckout in the browser.

    Does not call Paymentez. The JS SDK charges with …-EC-CLIENT.
    """
    code = _effective_client_code()
    key = _effective_client_key()
    if not (code and key):
        raise NuveiError("Nuvei CLIENT App Code / App Key not configured")
    if _looks_like_client_app(_server_app_code()) and not _client_app_code():
        logger.warning(
            "NUVEI_SERVER_APP_CODE looks like a CLIENT app; using it for JS checkout"
        )
    amount = cents_to_amount(amount_cents)
    currency = (currency or "USD").upper()
    desc = (description or f"{first_name} {last_name}")[:250]
    ref = str(client_unique_id)
    return {
        "session_token": ref,
        "reference": ref,
        "order_id": ref,
        "payment_url": None,
        "checkout_url": None,
        "client_unique_id": ref,
        "dev_reference": ref,
        "env": _env_name(),
        "amount": amount_to_str(amount),
        "currency": currency,
        "checkout_js_url": CHECKOUT_JS_URL_REFERENCE,
        "checkout_mode": "client",
        "client_app_code": code,
        "client_app_key": key,
        "js_credentials": "client",
        "merchant_id": "",
        "merchant_site_id": "",
        "order_vat": "0.00",
        "order_installments_type": 0,
        "user_first_name": first_name,
        "user_last_name": last_name,
        "user_id": str(user_id)[:64],
        "user_email": email,
        "user_phone": (phone or "").strip() or None,
        "order_description": desc,
        "raw": None,
    }


def prepare_checkout(
    *,
    amount_cents: int,
    currency: str = "USD",
    client_unique_id: str,
    user_token_id: Optional[str] = None,
    email: Optional[str] = None,
    phone: Optional[str] = None,
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    custom_data: Optional[str] = None,
    success_url: Optional[str] = None,
    failure_url: Optional[str] = None,
    pending_url: Optional[str] = None,
    review_url: Optional[str] = None,
    expiration_time: int = LINKTOPAY_EXPIRATION_SECONDS,
) -> dict[str, Any]:
    """Checkout v3 first (CLIENT / init_reference); Link to Pay if that fails.

    Link to Pay signs with NUVEI_SERVER_* when that app is …-EC-SERVER or
    LINKTOPAY…; otherwise the same CLIENT pair is reused.
    """
    if not email:
        raise NuveiError("email required for Nuvei Ecuador checkout")

    first = (first_name or "").strip() or "Cliente"
    last = (last_name or "").strip() or "TYS"
    description = (custom_data or f"{first} {last}")[:250]
    user_id = str(user_token_id or email)[:250]
    success = success_url or _frontend_base()
    failure = failure_url or success

    if not is_configured():
        raise NuveiError(
            "Nuvei Ecuador credentials not configured "
            "(need NUVEI_CLIENT_APP_CODE + NUVEI_CLIENT_APP_KEY, "
            "or NUVEI_SERVER_APP_CODE + NUVEI_SERVER_APP_KEY)"
        )

    try:
        result = init_reference(
            amount_cents=amount_cents,
            currency=currency,
            dev_reference=str(client_unique_id),
            description=description,
            user_id=user_id[:64],
            email=email,
            vat=0,
            locale="es",
            installments_type=0,
        )
    except NuveiError as e:
        logger.warning(
            "init_reference failed; trying Link to Pay | %s", describe_error(e)
        )
        try:
            result = init_linktopay(
                amount_cents=amount_cents,
                currency=currency,
                dev_reference=str(client_unique_id),
                description=description,
                user_id=user_id,
                email=email,
                first_name=first,
                last_name=last,
                success_url=success,
                failure_url=failure,
                pending_url=pending_url or success,
                review_url=review_url or success,
                vat=0,
                tax_percentage=0,
                installments_type=0,
                expiration_time=expiration_time,
            )
        except NuveiError as ltp_err:
            logger.warning("Link to Pay failed | %s", describe_error(ltp_err))
            raise NuveiError(
                f"Checkout init_reference: {e}; Link to Pay: {ltp_err}",
                err_code=e.err_code,
                payload={"init_reference": e.payload, "linktopay": ltp_err.payload},
            ) from ltp_err

    result["user_id"] = user_id
    result["user_email"] = email
    result["user_phone"] = (phone or "").strip() or None
    result["order_description"] = description
    return result


# Back-compat name used by orders.py / billing.py
def open_order(**kwargs: Any) -> dict[str, Any]:
    """Alias → prepare_checkout (orders/billing call sites)."""
    kwargs.pop("client_request_id", None)
    kwargs.pop("country", None)
    kwargs.pop("notification_url_override", None)
    return prepare_checkout(**kwargs)


def refund_transaction(
    transaction_id: str, *, amount_cents: Optional[int] = None
) -> dict[str, Any]:
    """POST /v2/transaction/refund/ — full refund unless amount_cents is set."""
    if not transaction_id:
        raise NuveiError("transaction_id required for refund")
    body: dict[str, Any] = {"transaction": {"id": str(transaction_id)}}
    if amount_cents is not None:
        body["order"] = {"amount": cents_to_amount(amount_cents)}
    data = _request_trying_pairs("POST", "v2/transaction/refund/", json_body=body)
    status = str(data.get("status") or "").strip().lower()
    if status == "failure":
        raise NuveiError(
            data.get("detail") or "Nuvei refund failed",
            payload=data,
        )
    return {
        "status": status or "success",
        "detail": data.get("detail"),
        "transaction_id": transaction_id,
        "raw": data,
    }


def get_transaction(transaction_id: str) -> dict[str, Any]:
    """GET /v2/transaction/<transaction_id>/ — server-side payment verification."""
    if not transaction_id:
        raise NuveiError("transaction_id required")
    data = _request_trying_pairs("GET", f"v2/transaction/{transaction_id}/")
    txn = data.get("transaction") if isinstance(data.get("transaction"), dict) else data
    auth = txn.get("authorization_code")
    return {
        "transaction_status": str(txn.get("status") or ""),
        "status_detail": txn.get("status_detail"),
        "transaction_id": txn.get("id") or transaction_id,
        "authorization_code": str(auth).strip() if auth not in (None, "") else None,
        "client_unique_id": txn.get("dev_reference"),
        "dev_reference": txn.get("dev_reference"),
        "amount": txn.get("amount"),
        "currency": txn.get("currency"),
        "raw": data,
    }


def _normalize_status_detail(value: Any) -> Optional[int]:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def is_approved_status(
    status: str | None,
    status_detail: Any = None,
) -> bool:
    """Approved iff status is success (GET) or ``1`` (webhook) AND status_detail is 3.

    Nuvei/Paymentez requirement: never treat a charge as paid without both
    fields. Webhook JSON uses numeric ``status: "1"``; GET /v2/transaction
    uses ``status: "success"``. Both map to the same approved state.
    """
    s = str(status or "").strip().lower()
    if s not in ("success", "1"):
        return False
    return _normalize_status_detail(status_detail) == APPROVED_STATUS_DETAIL


def is_cancelled_or_refunded(
    status: str | None,
    status_detail: Any = None,
) -> bool:
    """True for Paymentez cancelled (status 2) or refund/chargeback details."""
    s = str(status or "").strip().lower()
    detail = _normalize_status_detail(status_detail)
    if s in CANCELLED_STATUSES:
        return True
    return detail in REFUND_STATUS_DETAILS


def compute_webhook_stoken(
    *,
    transaction_id: str,
    user_id: str,
    application_code: Optional[str] = None,
    app_key: Optional[str] = None,
) -> str:
    """MD5(transaction_id_app_code_user_id_app_key) — Paymentez webhook integrity.

    MD5 is mandated by the Paymentez/Nuvei webhook spec and is used purely for
    protocol compatibility (replicate the gateway's own digest to verify the
    payload), NOT as a security primitive. `usedforsecurity=False` signals this
    intent to FIPS-restricted runtimes. The CodeQL py/weak-sensitive-data-hashing
    alert this triggers is dismissed in the repo's Security tab (not via an
    inline suppression comment — this repo's CodeQL runs via Default Setup,
    which doesn't honor those) with the same justification as this docstring.
    """
    if application_code and app_key:
        code, key = application_code.strip(), app_key.strip()
    else:
        default_code, default_key = _auth_pair()
        code = (application_code or default_code).strip()
        key = (app_key or default_key).strip()
    raw = f"{transaction_id}_{code}_{user_id}_{key}"
    return hashlib.md5(raw.encode("utf-8"), usedforsecurity=False).hexdigest()


def verify_webhook_stoken(payload: dict[str, Any]) -> Optional[bool]:
    """
    Verify Paymentez webhook stoken.

    Returns True if present and valid, False if present and wrong, or None if
    the field is absent (callers MUST treat None as unverified and re-check via
    get_transaction, never as implicitly valid).
    """
    txn = (
        payload.get("transaction")
        if isinstance(payload.get("transaction"), dict)
        else {}
    )
    user = payload.get("user") if isinstance(payload.get("user"), dict) else {}
    stoken = str(txn.get("stoken") or payload.get("stoken") or "").strip().lower()
    if not stoken:
        return None
    if not is_configured():
        return False
    txn_id = str(txn.get("id") or payload.get("id") or "")
    user_id = str(user.get("id") or payload.get("user_id") or "")
    if not (txn_id and user_id):
        return False
    payload_code = str(
        txn.get("application_code") or payload.get("application_code") or ""
    ).strip()
    attempts: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for code, key in _credential_pairs():
        if payload_code:
            item = (payload_code, key)
            if item not in seen:
                seen.add(item)
                attempts.append(item)
        item = (code, key)
        if item not in seen:
            seen.add(item)
            attempts.append(item)
    if not attempts:
        return False
    for code, key in attempts:
        expected = compute_webhook_stoken(
            transaction_id=txn_id,
            user_id=user_id,
            application_code=code,
            app_key=key,
        )
        if expected.lower() == stoken:
            return True
    return False


def parse_webhook_payload(params: dict[str, Any]) -> dict[str, Any]:
    """Normalize webhook / confirm payloads to a common shape."""
    txn = (
        params.get("transaction")
        if isinstance(params.get("transaction"), dict)
        else None
    )
    if txn is None:
        # Flat form/query style
        txn = params

    def _get(*keys: str) -> Any:
        for k in keys:
            if k in txn and txn[k] not in (None, ""):
                return txn[k]
            for pk, pv in txn.items():
                if str(pk).lower() == k.lower() and pv not in (None, ""):
                    return pv
        # also search top-level params
        for k in keys:
            if k in params and params[k] not in (None, ""):
                return params[k]
        return None

    status = _get("status", "Status", "transactionStatus")
    return {
        "status": str(status or ""),
        "status_detail": _get("status_detail", "statusDetail"),
        "client_unique_id": _get("dev_reference", "devReference", "client_unique_id"),
        "transaction_id": _get("id", "transaction_id", "transactionId"),
        "authorization_code": _get("authorization_code", "authorizationCode"),
        "session_token": _get("id", "transaction_id", "reference"),
        "reference": _get("reference"),
        "total_amount": _get("amount", "totalAmount"),
        "currency": _get("currency"),
        "stoken": _get("stoken"),
        "application_code": _get("application_code"),
        "user_id": (
            (params.get("user") or {}).get("id")
            if isinstance(params.get("user"), dict)
            else _get("user_id")
        ),
    }


def verify_dmn_checksum(params: dict[str, Any]) -> Optional[bool]:
    """
    Verify Paymentez webhook stoken when present.

    Returns True if the stoken is present and matches, False if present and
    wrong, or None if simply absent — callers MUST treat None as unverified
    and re-check via get_transaction, never as implicitly valid.
    """
    return verify_webhook_stoken(params)


def public_payment_receipt(metadata: dict | None) -> Optional[dict[str, Any]]:
    """Buyer-visible Nuvei fields (transaction id DF + authorization code)."""
    meta = metadata or {}
    txn = str(meta.get("nuvei_transaction_id") or "").strip()
    auth = str(meta.get("nuvei_authorization_code") or "").strip()
    if not txn and not auth:
        return None
    return {
        "transaction_id": txn or None,
        "authorization_code": auth or None,
    }


def merge_payment_receipt(
    metadata: dict | None,
    *,
    transaction_id: Optional[str] = None,
    authorization_code: Optional[str] = None,
) -> dict[str, Any]:
    out = dict(metadata or {})
    if transaction_id:
        out["nuvei_transaction_id"] = str(transaction_id).strip()
    auth = str(authorization_code or "").strip()
    if auth:
        out["nuvei_authorization_code"] = auth
    return out


def split_buyer_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().split(None, 1)
    if not parts:
        return "Cliente", "TYS"
    if len(parts) == 1:
        return parts[0][:30], "TYS"
    return parts[0][:30], parts[1][:40]
