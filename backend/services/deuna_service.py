"""DEUNA REST helpers — Create Order + Get Order (Payment Widget Web SDK).

Docs:
- https://docs.deuna.com/reference/web-sdk
- https://docs.deuna.com/reference/order_token
- https://docs.deuna.com/reference/payment-flow

Private API key stays server-side. Frontend only receives orderToken + publicApiKey.
"""

from __future__ import annotations

import logging
import os
from typing import Any, Optional

import httpx

logger = logging.getLogger("tys.deuna")

SDK_JS_URL = "https://cdn.deuna.io/web-sdk/v1.6/index.js"
_SANDBOX_BASE = "https://api.sandbox.deuna.io"
_LIVE_BASE = "https://api.deuna.io"

# Order statuses that mean money was captured / sale completed.
_PAID_ORDER_STATUSES = frozenset(
    {
        "succeeded",
        "success",
        "completed",
        "paid",
        "processed",
        "authorized",
        "captured",
    }
)
_PAID_PAYMENT_STATUSES = frozenset(
    {
        "succeeded",
        "success",
        "completed",
        "paid",
        "processed",
        "authorized",
        "captured",
        "approved",
    }
)


class DeunaError(Exception):
    def __init__(self, message: str, *, err_code: Any = None, payload: Any = None):
        super().__init__(message)
        self.err_code = err_code
        self.payload = payload


def _env_name() -> str:
    raw = (os.environ.get("DEUNA_ENV") or "sandbox").strip().lower()
    if raw in ("live", "prod", "production"):
        return "production"
    return "sandbox"


def is_configured() -> bool:
    """Need ApiKey + ApiSecret (aliases: PUBLIC/PRIVATE keys)."""
    return bool(_api_key() and _api_secret())


def _api_base() -> str:
    override = (os.environ.get("DEUNA_API_BASE") or "").rstrip("/")
    if override:
        return override
    return _LIVE_BASE if _env_name() == "production" else _SANDBOX_BASE


def _api_key() -> str:
    """Public ApiKey from DEUNA — used ONLY for frontend DeunaSDK.initialize(publicApiKey)."""
    return (
        os.environ.get("DEUNA_API_KEY")
        or os.environ.get("DEUNA_PUBLIC_API_KEY")
        or ""
    ).strip()


def _api_secret() -> str:
    """Private ApiSecret from DEUNA — sent as X-API-KEY in all server-to-server requests."""
    return (
        os.environ.get("DEUNA_API_SECRET")
        or os.environ.get("DEUNA_PRIVATE_API_KEY")
        or ""
    ).strip()


def _point_of_sales() -> str:
    """pointOfSales / CAJA — used as store_code on Create Order."""
    return (
        os.environ.get("DEUNA_POINT_OF_SALES")
        or os.environ.get("DEUNA_STORE_CODE")
        or "all"
    ).strip() or "all"


# Back-compat aliases used elsewhere in this module
def _private_key() -> str:
    return _api_secret()


def _public_key() -> str:
    return _api_key()


def _store_code() -> str:
    return _point_of_sales()


def notification_url() -> Optional[str]:
    base = (
        os.environ.get("BACKEND_PUBLIC_URL")
        or os.environ.get("REACT_APP_BACKEND_URL")
        or ""
    ).rstrip("/")
    if not base:
        return None
    return f"{base}/api/deuna/webhook"


def split_buyer_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().split(None, 1)
    if not parts:
        return "Cliente", "TYS"
    if len(parts) == 1:
        return parts[0][:40], "TYS"
    return parts[0][:40], parts[1][:40]


def currency_symbol(currency: str) -> str:
    return (
        "$"
        if (currency or "USD").upper() in ("USD", "MXN", "ARS", "CLP", "COP")
        else ""
    )


def _request(
    method: str,
    path: str,
    *,
    json_body: dict | None = None,
    idempotency_key: str | None = None,
) -> dict:
    api_key = _api_key()
    api_secret = _api_secret()
    if not api_key and not api_secret:
        raise DeunaError("DEUNA ApiKey/ApiSecret not configured")

    # DEUNA server-to-server auth: X-API-KEY must be the PRIVATE key (ApiSecret).
    # The public ApiKey is only for the frontend DeunaSDK.initialize({ publicApiKey }).
    # Ref: https://docs.deuna.com/docs/direct-api-integration
    headers = {
        "X-API-KEY": api_secret or api_key,
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key

    url = f"{_api_base()}/{path.lstrip('/')}"
    try:
        with httpx.Client(timeout=45.0) as client:
            resp = client.request(method, url, headers=headers, json=json_body)
            data = resp.json() if resp.content else {}
    except httpx.HTTPError as e:
        logger.error("DEUNA HTTP error on %s: %s", path, type(e).__name__)
        raise DeunaError(f"DEUNA request failed: {type(e).__name__}") from e

    if resp.status_code >= 400:
        err = (data or {}).get("error") or {}
        raise DeunaError(
            err.get("description") or f"DEUNA HTTP {resp.status_code}",
            err_code=err.get("code"),
            payload=data,
        )
    if isinstance(data, dict) and data.get("error"):
        err = data["error"] or {}
        raise DeunaError(
            err.get("description") or "DEUNA returned error",
            err_code=err.get("code"),
            payload=data,
        )
    return data if isinstance(data, dict) else {"raw": data}


def create_order(
    *,
    order_id: str,
    amount_cents: int,
    currency: str = "USD",
    item_name: str,
    item_description: str = "",
    email: str,
    first_name: str,
    last_name: str,
    phone: Optional[str] = None,
    metadata: Optional[dict[str, str]] = None,
    notify_url: Optional[str] = None,
) -> dict[str, Any]:
    """
    POST /merchants/orders — returns orderToken for Payment Widget.
    Amounts are integers in cents (DEUNA convention).
    Do not set redirect_url so widget onSuccess fires correctly.
    """
    if not is_configured():
        raise DeunaError("DEUNA credentials not configured")

    currency = (currency or "USD").upper()
    amount = int(amount_cents)
    if amount < 1:
        raise DeunaError("amount_cents must be >= 1")

    money = {
        "amount": amount,
        "currency": currency,
        "currency_symbol": currency_symbol(currency),
    }
    billing: dict[str, Any] = {
        "first_name": (first_name or "Cliente")[:40],
        "last_name": (last_name or "TYS")[:40],
        "email": email,
        "country_code": "EC",
        "country": "EC",
    }
    if phone:
        billing["phone"] = phone[:20]

    order_body: dict[str, Any] = {
        "order_id": order_id[:64],
        "store_code": _store_code(),
        "currency": currency,
        "items_total_amount": amount,
        "sub_total": amount,
        "total_amount": amount,
        "total_tax_amount": 0,
        "items": [
            {
                "id": order_id[:64],
                "name": (item_name or "Ticket")[:120],
                "description": (item_description or item_name or "Ticket")[:255],
                "quantity": 1,
                "type": "digital",
                "unit_price": dict(money),
                "total_amount": {
                    **money,
                    "original_amount": amount,
                    "total_discount": 0,
                },
            }
        ],
        "billing_address": billing,
        "payer_info": {"email": email},
    }
    if metadata:
        order_body["metadata"] = {str(k): str(v)[:200] for k, v in metadata.items()}

    notify = notify_url or notification_url()
    if notify:
        order_body["webhook_urls"] = {"notify_order": notify}

    data = _request(
        "POST",
        "/merchants/orders",
        json_body={"order": order_body},
        idempotency_key=order_id,
    )
    order = data.get("order") if isinstance(data.get("order"), dict) else {}
    token = data.get("token") or order.get("token")
    if not token:
        raise DeunaError("create order response missing token", payload=data)

    return {
        "order_token": token,
        "order_id": order.get("order_id") or order_id,
        "status": order.get("status") or "pending",
        "public_api_key": _public_key(),
        "env": _env_name(),
        "checkout_js_url": SDK_JS_URL,
        "raw": data,
    }


def get_order(order_token: str) -> dict[str, Any]:
    """GET /merchants/orders/{order_token} — verify payment server-side."""
    if not order_token:
        raise DeunaError("order_token required")
    data = _request("GET", f"/merchants/orders/{order_token}")
    order = data.get("order") if isinstance(data.get("order"), dict) else data
    payment = (order.get("payment") or {}).get("data") or {}
    return {
        "order_token": order.get("token") or order_token,
        "order_id": order.get("order_id"),
        "status": str(order.get("status") or "").lower(),
        "payment_status": str(payment.get("status") or "").lower(),
        "transaction_id": payment.get("id") or payment.get("external_transaction_id"),
        "raw": data,
    }


def is_paid(order_info: dict[str, Any]) -> bool:
    status = str(order_info.get("status") or "").lower()
    pay_status = str(order_info.get("payment_status") or "").lower()
    return status in _PAID_ORDER_STATUSES or pay_status in _PAID_PAYMENT_STATUSES


def parse_webhook_payload(body: dict[str, Any]) -> dict[str, Any]:
    """Normalize notify_order / webhook payloads."""
    order = body.get("order") if isinstance(body.get("order"), dict) else body
    if not isinstance(order, dict):
        order = {}
    payment = (order.get("payment") or {}).get("data") or {}
    return {
        "order_token": order.get("token")
        or body.get("token")
        or body.get("order_token"),
        "order_id": order.get("order_id") or body.get("order_id"),
        "status": str(order.get("status") or body.get("status") or "").lower(),
        "payment_status": str(payment.get("status") or "").lower(),
        "transaction_id": payment.get("id") or payment.get("external_transaction_id"),
    }


def client_config_payload(create_result: dict) -> dict[str, str]:
    return {
        "order_token": create_result["order_token"],
        "public_api_key": create_result["public_api_key"],
        "env": create_result["env"],
        "checkout_js_url": create_result.get("checkout_js_url") or SDK_JS_URL,
    }
