"""Nuvei REST helpers — openOrder / getPaymentStatus + checksum (API v1).

Docs: https://docs.nuvei.com/api/main/indexMain_v1_0.html
Secret key stays server-side; the frontend only receives sessionToken + merchant IDs
for Simply Connect ``checkout()``.
"""

from __future__ import annotations

import hashlib
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

logger = logging.getLogger("tys.nuvei")

API_VERSION = "1.0"
CHECKOUT_JS_URL = (
    "https://cdn.safecharge.com/safecharge_resources/v1/checkout/checkout.js"
)

_TEST_BASE = "https://ppp-test.nuvei.com/ppp/api/v1"
_LIVE_BASE = "https://secure.safecharge.com/ppp/api/v1"


class NuveiError(Exception):
    """Raised when Nuvei returns ERROR or the HTTP call fails."""

    def __init__(self, message: str, *, err_code: Any = None, payload: Any = None):
        super().__init__(message)
        self.err_code = err_code
        self.payload = payload


def _env_name() -> str:
    raw = (os.environ.get("NUVEI_ENV") or "test").strip().lower()
    if raw in ("live", "prod", "production"):
        return "live"
    return "test"


def is_configured() -> bool:
    return bool(
        os.environ.get("NUVEI_MERCHANT_ID")
        and os.environ.get("NUVEI_MERCHANT_SITE_ID")
        and os.environ.get("NUVEI_SECRET_KEY")
    )


def get_merchant_ids() -> dict[str, str]:
    return {
        "merchant_id": os.environ.get("NUVEI_MERCHANT_ID", ""),
        "merchant_site_id": os.environ.get("NUVEI_MERCHANT_SITE_ID", ""),
        "env": "prod" if _env_name() == "live" else "int",
    }


def _api_base() -> str:
    override = (os.environ.get("NUVEI_API_BASE") or "").rstrip("/")
    if override:
        return override
    return _LIVE_BASE if _env_name() == "live" else _TEST_BASE


def _secret() -> str:
    return os.environ.get("NUVEI_SECRET_KEY", "")


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")


def cents_to_amount(cents: int) -> str:
    """Nuvei amounts are decimal currency units as strings (e.g. 1250 → '12.50')."""
    return f"{int(cents) / 100:.2f}"


def open_order_checksum(
    *,
    merchant_id: str,
    merchant_site_id: str,
    client_request_id: str,
    amount: str,
    currency: str,
    time_stamp: str,
    secret_key: str,
) -> str:
    """SHA-256 of merchantId+merchantSiteId+clientRequestId+amount+currency+timeStamp+secret."""
    raw = (
        f"{merchant_id}{merchant_site_id}{client_request_id}"
        f"{amount}{currency}{time_stamp}{secret_key}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def session_token_checksum(
    *,
    merchant_id: str,
    merchant_site_id: str,
    client_request_id: str,
    time_stamp: str,
    secret_key: str,
) -> str:
    """Checksum for getSessionToken (no amount/currency)."""
    raw = (
        f"{merchant_id}{merchant_site_id}{client_request_id}"
        f"{time_stamp}{secret_key}"
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def notification_url() -> Optional[str]:
    """Public backend URL for DMNs. Prefer BACKEND_PUBLIC_URL."""
    base = (
        os.environ.get("BACKEND_PUBLIC_URL")
        or os.environ.get("REACT_APP_BACKEND_URL")
        or ""
    ).rstrip("/")
    if not base:
        return None
    return f"{base}/api/nuvei/dmn"


def _require_config() -> tuple[str, str, str]:
    merchant_id = os.environ.get("NUVEI_MERCHANT_ID", "")
    site_id = os.environ.get("NUVEI_MERCHANT_SITE_ID", "")
    secret = _secret()
    if not (merchant_id and site_id and secret):
        raise NuveiError("Nuvei credentials not configured")
    return merchant_id, site_id, secret


def _post(path: str, body: dict) -> dict:
    url = f"{_api_base()}/{path.lstrip('/')}"
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, json=body)
            resp.raise_for_status()
            data = resp.json()
    except httpx.HTTPError as e:
        logger.error("Nuvei HTTP error on %s: %s", path, type(e).__name__)
        raise NuveiError(f"Nuvei request failed: {type(e).__name__}") from e

    if str(data.get("status", "")).upper() == "ERROR":
        raise NuveiError(
            data.get("reason") or "Nuvei returned ERROR",
            err_code=data.get("errCode"),
            payload=data,
        )
    return data


def open_order(
    *,
    amount_cents: int,
    currency: str = "USD",
    client_unique_id: str,
    client_request_id: Optional[str] = None,
    user_token_id: Optional[str] = None,
    email: Optional[str] = None,
    country: str = "EC",
    first_name: Optional[str] = None,
    last_name: Optional[str] = None,
    success_url: Optional[str] = None,
    failure_url: Optional[str] = None,
    pending_url: Optional[str] = None,
    notification_url_override: Optional[str] = None,
    custom_data: Optional[str] = None,
) -> dict[str, Any]:
    """Create a Nuvei order and return sessionToken + merchant display fields."""
    merchant_id, site_id, secret = _require_config()
    amount = cents_to_amount(amount_cents)
    currency = (currency or "USD").upper()
    req_id = client_request_id or uuid.uuid4().hex[:20]
    ts = _timestamp()
    checksum = open_order_checksum(
        merchant_id=merchant_id,
        merchant_site_id=site_id,
        client_request_id=req_id,
        amount=amount,
        currency=currency,
        time_stamp=ts,
        secret_key=secret,
    )

    body: dict[str, Any] = {
        "merchantId": merchant_id,
        "merchantSiteId": site_id,
        "clientRequestId": req_id,
        "clientUniqueId": client_unique_id[:45],
        "amount": amount,
        "currency": currency,
        "timeStamp": ts,
        "checksum": checksum,
        "version": API_VERSION,
    }
    if user_token_id:
        body["userTokenId"] = str(user_token_id)[:255]
    if custom_data:
        body["customData"] = custom_data[:255]

    billing: dict[str, str] = {"country": (country or "EC").upper()}
    if email:
        billing["email"] = email
    if first_name:
        billing["firstName"] = first_name[:30]
    if last_name:
        billing["lastName"] = last_name[:40]
    if len(billing) > 1:
        body["billingAddress"] = billing

    url_details: dict[str, str] = {}
    if success_url:
        url_details["successUrl"] = success_url
    if failure_url:
        url_details["failureUrl"] = failure_url
    if pending_url:
        url_details["pendingUrl"] = pending_url
    notify = notification_url_override or notification_url()
    if notify:
        url_details["notificationUrl"] = notify
    if url_details:
        body["urlDetails"] = url_details

    data = _post("openOrder.do", body)
    session_token = data.get("sessionToken")
    if not session_token:
        raise NuveiError("openOrder response missing sessionToken", payload=data)

    return {
        "session_token": session_token,
        "order_id": data.get("orderId"),
        "client_unique_id": client_unique_id,
        "client_request_id": req_id,
        "merchant_id": merchant_id,
        "merchant_site_id": site_id,
        "env": "prod" if _env_name() == "live" else "int",
        "amount": amount,
        "currency": currency,
        "checkout_js_url": CHECKOUT_JS_URL,
        "raw": data,
    }


def get_payment_status(session_token: str) -> dict[str, Any]:
    """Verify payment outcome for a session (server-side; do not trust client alone)."""
    if not session_token:
        raise NuveiError("sessionToken required")
    data = _post("getPaymentStatus.do", {"sessionToken": session_token})
    transaction_status = (
        data.get("transactionStatus") or data.get("Status") or data.get("status") or ""
    )
    return {
        "transaction_status": str(transaction_status).upper(),
        "transaction_id": data.get("transactionId"),
        "client_unique_id": data.get("clientUniqueId")
        or data.get("merchant_unique_id"),
        "amount": data.get("amount") or data.get("totalAmount"),
        "currency": data.get("currency"),
        "raw": data,
    }


def is_approved_status(status: str | None) -> bool:
    return str(status or "").upper() in ("APPROVED", "SUCCESS", "OK")


def parse_dmn_params(params: dict[str, Any]) -> dict[str, Any]:
    """Normalize DMN query/form params (Payment Page + REST notification styles)."""

    def _get(*keys: str) -> Any:
        for k in keys:
            if k in params and params[k] not in (None, ""):
                return params[k]
            # case-insensitive fallback
            for pk, pv in params.items():
                if pk.lower() == k.lower() and pv not in (None, ""):
                    return pv
        return None

    status = _get("Status", "status", "ppp_status", "transactionStatus")
    return {
        "status": str(status or "").upper(),
        "client_unique_id": _get(
            "merchant_unique_id", "clientUniqueId", "client_unique_id"
        ),
        "transaction_id": _get("TransactionID", "transactionId", "PPP_TransactionID"),
        "session_token": _get("sessionToken", "session_token"),
        "total_amount": _get("totalAmount", "amount"),
        "currency": _get("currency"),
        "product_id": _get("productId", "product_id"),
        "custom_data": _get("customData", "custom_data"),
        "advance_response_checksum": _get(
            "advanceResponseChecksum", "advanceResponsechecksum", "responsechecksum"
        ),
        "response_time_stamp": _get("responseTimeStamp", "response_time_stamp"),
        "ppp_transaction_id": _get("PPP_TransactionID", "ppp_TransactionID"),
    }


def verify_dmn_checksum(params: dict[str, Any]) -> Optional[bool]:
    """
    Optional Payment Page–style response checksum.

    Concatenation: secret + totalAmount + currency + responseTimeStamp
    + ppp_TransactionID + status + productId

    Returns True if the checksum is present and matches, False if present and
    wrong, or None if the field is simply absent (REST-style DMNs may omit it —
    callers MUST treat None as unverified and re-check via getPaymentStatus,
    never as implicitly valid).
    """
    secret = _secret()
    if not secret:
        return False
    parsed = parse_dmn_params(params)
    expected_hex = parsed.get("advance_response_checksum")
    if not expected_hex:
        return None

    raw = (
        f"{secret}"
        f"{parsed.get('total_amount') or ''}"
        f"{parsed.get('currency') or ''}"
        f"{parsed.get('response_time_stamp') or ''}"
        f"{parsed.get('ppp_transaction_id') or ''}"
        f"{parsed.get('status') or ''}"
        f"{parsed.get('product_id') or ''}"
    )
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest.lower() == str(expected_hex).lower()


def split_buyer_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().split(None, 1)
    if not parts:
        return "Cliente", "TYS"
    if len(parts) == 1:
        return parts[0][:30], "TYS"
    return parts[0][:30], parts[1][:40]


def client_config_payload(open_result: dict) -> dict[str, str]:
    """Fields the frontend needs for Simply Connect checkout()."""
    return {
        "session_token": open_result["session_token"],
        "merchant_id": open_result["merchant_id"],
        "merchant_site_id": open_result["merchant_site_id"],
        "env": open_result["env"],
        "checkout_js_url": open_result.get("checkout_js_url") or CHECKOUT_JS_URL,
    }
