"""Nuvei Ecuador (Paymentez) — init_reference + Auth-Token + webhook stoken.

Regional stack (not global Simply Connect):
https://developers.paymentez.com/api/#authentication
https://developers.paymentez.com/docs/payments/

Credentials: SERVER App Code + App Key (backend). Optional CLIENT pair for JS modal.
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from base64 import b64encode
from typing import Any, Optional

import httpx

logger = logging.getLogger("tys.nuvei")

TOKENIZE_JS_URL = (
    "https://cdn.paymentez.com/ccapi/sdk/payment_sdk_stable.min.js"
)
CHECKOUT_JS_URL = TOKENIZE_JS_URL  # back-compat alias
CHECKOUT_JS_URL_REFERENCE = (
    "https://cdn.paymentez.com/ccapi/sdk/payment_checkout_3.0.0.min.js"
)

# status_detail 3 = Operation Successful (approved charge)
APPROVED_STATUS_DETAIL = 3


class NuveiError(Exception):
    """Raised when Paymentez/Nuvei EC returns an error or the HTTP call fails."""

    def __init__(self, message: str, *, err_code: Any = None, payload: Any = None):
        super().__init__(message)
        self.err_code = err_code
        self.payload = payload


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


def is_configured() -> bool:
    """SERVER pair required for Auth-Token / verify. CLIENT preferred for JS checkout."""
    return bool(_server_app_code() and _server_app_key())


def has_client_credentials() -> bool:
    return bool(_client_app_code() and _client_app_key())


def _js_use_server_credentials() -> bool:
    """
    When true, PaymentGateway in the browser uses the SERVER App Code/Key.

    Only for controlled/stg testing — never enable in production. Paymentez
    normally expects the CLIENT pair; SERVER is a local workaround when CLIENT
    tokenize is broken on the merchant account.
    """
    raw = (os.environ.get("NUVEI_JS_USE_SERVER") or "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    # Default: stg → allow SERVER for JS so local testing can proceed.
    return _env_name() == "stg"


def _js_app_credentials() -> tuple[str, str]:
    """Credentials passed to the frontend PaymentGateway constructor."""
    if _js_use_server_credentials():
        code, key = _server_app_code(), _server_app_key()
        if code and key:
            return code, key
    code, key = _client_app_code(), _client_app_key()
    if code and key:
        return code, key
    return "", ""


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
    code = (server_application_code or _server_app_code()).strip()
    key = (server_app_key or _server_app_key()).strip()
    if not (code and key):
        raise NuveiError("Nuvei SERVER App Code / App Key not configured")
    ts = unix_timestamp or str(int(time.time()))
    uniq = hashlib.sha256(f"{key}{ts}".encode("utf-8")).hexdigest()
    raw = f"{code};{ts};{uniq}"
    return b64encode(raw.encode("utf-8")).decode("ascii")


def cents_to_amount(cents: int) -> float:
    """Paymentez amounts are decimal currency units (e.g. 1250 → 12.50)."""
    return round(int(cents) / 100, 2)


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
    code = _server_app_code()
    key = _server_app_key()
    if not (code and key):
        raise NuveiError(
            "Nuvei Ecuador credentials not configured "
            "(need NUVEI_SERVER_APP_CODE + NUVEI_SERVER_APP_KEY, "
            "or aliases NUVEI_APP_CODE + NUVEI_APP_KEY)"
        )
    return code, key


def _request(
    method: str,
    path: str,
    *,
    json_body: Optional[dict] = None,
) -> dict:
    _require_server()
    url = f"{_ccapi_base()}/{path.lstrip('/')}"
    headers = {
        "Content-Type": "application/json",
        "Auth-Token": build_auth_token(),
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
                raise NuveiError(
                    msg or f"Nuvei HTTP {resp.status_code}",
                    err_code=resp.status_code,
                    payload=data,
                )
            if not isinstance(data, dict):
                raise NuveiError("Nuvei returned non-JSON object", payload=data)
            if isinstance(data.get("error"), dict):
                err = data["error"]
                raise NuveiError(
                    err.get("description") or err.get("type") or "Nuvei error",
                    payload=data,
                )
            return data
    except httpx.HTTPError as e:
        logger.error("Nuvei HTTP error on %s: %s", path, type(e).__name__)
        raise NuveiError(f"Nuvei request failed: {type(e).__name__}") from e


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
    """
    POST /v2/transaction/init_reference/

    Returns checkout ``reference`` (+ checkout_url) for PaymentCheckout.modal.
    ``dev_reference`` is our order number / billing id (max practical length ~100).
    """
    amount = cents_to_amount(amount_cents)
    currency = (currency or "USD").upper()
    body: dict[str, Any] = {
        "locale": locale or "es",
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

    data = _request("POST", "v2/transaction/init_reference/", json_body=body)
    reference = data.get("reference")
    if not reference:
        raise NuveiError("init_reference missing reference", payload=data)

    checkout_url = data.get("checkout_url") or (
        f"{_ccapi_base()}/v2/transaction/checkout?reference={reference}"
    )

    return {
        # session_token alias keeps orders/billing storage (stripe_session_id) working
        "session_token": str(reference),
        "reference": str(reference),
        "checkout_url": checkout_url,
        "order_id": str(reference),
        "client_unique_id": str(dev_reference),
        "dev_reference": str(dev_reference),
        "env": _env_name(),
        "amount": amount_to_str(amount),
        "currency": currency,
        "checkout_js_url": CHECKOUT_JS_URL_REFERENCE,
        "client_app_code": _client_app_code() or None,
        "client_app_key": _client_app_key() or None,
        "merchant_id": "",
        "merchant_site_id": "",
        "raw": data,
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
) -> dict[str, Any]:
    """
    Default (stg / ``NUVEI_CHECKOUT_MODE=reference``): ``init_reference`` with
    SERVER Auth-Token → frontend ``PaymentCheckout.modal`` (no CLIENT keys).

    Optional ``NUVEI_CHECKOUT_MODE=tokenize``: PaymentGateway + debit (needs a
    working CLIENT pair; SERVER keys are rejected by generate_tokenize with 401).
    """
    if not email:
        raise NuveiError("email required for Nuvei Ecuador checkout")
    _require_server()

    mode = (os.environ.get("NUVEI_CHECKOUT_MODE") or "reference").strip().lower()
    name_bits = [p for p in (first_name, last_name) if p]
    description = (
        " ".join(name_bits) if name_bits else (custom_data or "Ticket Yourself")
    )[:250]
    user_id = str(user_token_id or email)[:64]

    if mode == "tokenize":
        js_code, js_key = _js_app_credentials()
        if not (js_code and js_key):
            raise NuveiError(
                "Nuvei JS credentials missing for tokenize mode "
                "(CLIENT pair, or NUVEI_JS_USE_SERVER=1 with SERVER)"
            )
        amount = cents_to_amount(amount_cents)
        using_server_js = _js_use_server_credentials() and bool(_server_app_code())
        return {
            "checkout_mode": "tokenize",
            "session_token": str(client_unique_id),
            "reference": str(client_unique_id),
            "checkout_url": None,
            "order_id": str(client_unique_id),
            "client_unique_id": str(client_unique_id),
            "dev_reference": str(client_unique_id),
            "env": _env_name(),
            "amount": amount_to_str(amount),
            "currency": (currency or "USD").upper(),
            "checkout_js_url": TOKENIZE_JS_URL,
            "client_app_code": js_code,
            "client_app_key": js_key,
            "js_credentials": "server" if using_server_js else "client",
            "user_id": user_id,
            "user_email": email,
            "user_phone": (phone or "").strip() or None,
            "order_description": description,
            "order_vat": "0.00",
            "order_installments_type": 0,
            "merchant_id": "",
            "merchant_site_id": "",
            "raw": None,
        }

    # Default: SERVER init_reference → PaymentCheckout
    result = init_reference(
        amount_cents=amount_cents,
        currency=currency,
        dev_reference=str(client_unique_id),
        description=description,
        user_id=user_id,
        email=email,
        vat=0,
        locale="es",
        installments_type=0,
    )
    result["checkout_mode"] = "reference"
    result["user_id"] = user_id
    result["user_email"] = email
    result["user_phone"] = (phone or "").strip() or None
    result["order_description"] = description
    # Do not leak SERVER keys; PaymentCheckout only needs `reference`.
    result["client_app_code"] = None
    result["client_app_key"] = None
    result["js_credentials"] = "none"
    return result


def debit_with_token(
    *,
    card_token: str,
    amount_cents: int,
    currency: str = "USD",
    dev_reference: str,
    description: str,
    user_id: str,
    email: str,
    vat: float = 0,
) -> dict[str, Any]:
    """POST /v2/transaction/debit/ with a card token from PaymentGateway."""
    if not card_token:
        raise NuveiError("card token required")
    amount = cents_to_amount(amount_cents)
    body = {
        "user": {"id": str(user_id)[:64], "email": email},
        "order": {
            "amount": amount,
            "description": (description or "Ticket Yourself")[:250],
            "dev_reference": str(dev_reference)[:100],
            "vat": float(vat),
        },
        "card": {"token": str(card_token)},
    }
    data = _request("POST", "v2/transaction/debit/", json_body=body)
    txn = data.get("transaction") if isinstance(data.get("transaction"), dict) else {}
    return {
        "transaction_status": str(txn.get("status") or ""),
        "status_detail": txn.get("status_detail"),
        "transaction_id": txn.get("id"),
        "client_unique_id": txn.get("dev_reference") or dev_reference,
        "dev_reference": txn.get("dev_reference") or dev_reference,
        "amount": txn.get("amount") or amount,
        "currency": txn.get("currency") or currency,
        "raw": data,
    }


# Back-compat name used by orders.py / billing.py
def open_order(**kwargs: Any) -> dict[str, Any]:
    """Alias → prepare_checkout (orders/billing call sites)."""
    # Drop legacy Simply Connect kwargs if present
    for k in (
        "client_request_id",
        "country",
        "success_url",
        "failure_url",
        "pending_url",
        "notification_url_override",
    ):
        kwargs.pop(k, None)
    return prepare_checkout(**kwargs)


def get_transaction(transaction_id: str) -> dict[str, Any]:
    """GET /v2/transaction/<transaction_id>/ — server-side payment verification."""
    if not transaction_id:
        raise NuveiError("transaction_id required")
    data = _request("GET", f"v2/transaction/{transaction_id}/")
    txn = data.get("transaction") if isinstance(data.get("transaction"), dict) else data
    return {
        "transaction_status": str(txn.get("status") or ""),
        "status_detail": txn.get("status_detail"),
        "transaction_id": txn.get("id") or transaction_id,
        "client_unique_id": txn.get("dev_reference"),
        "dev_reference": txn.get("dev_reference"),
        "amount": txn.get("amount"),
        "currency": txn.get("currency"),
        "raw": data,
    }


# Alias used by previous confirm flow naming
def get_payment_status(session_token: str) -> dict[str, Any]:
    """
    ``session_token`` here is the Paymentez ``transaction.id`` (not the checkout reference).
    Prefer calling ``get_transaction`` explicitly from confirm handlers.
    """
    return get_transaction(session_token)


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
    """
    Approved when status is success/1/approved and status_detail is 3
    (or detail omitted — trust status alone).
    """
    s = str(status or "").strip().lower()
    if s not in ("success", "1", "approved", "ok"):
        return False
    detail = _normalize_status_detail(status_detail)
    if detail is None:
        return True
    return detail == APPROVED_STATUS_DETAIL


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
    payload), NOT as a security primitive.  `usedforsecurity=False` signals this
    intent to static analysers (CodeQL, bandit) and to FIPS-restricted runtimes.
    """
    code = (application_code or _server_app_code()).strip()
    key = (app_key or _server_app_key()).strip()
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
    stoken = str(
        txn.get("stoken") or payload.get("stoken") or ""
    ).strip().lower()
    if not stoken:
        return None
    if not is_configured():
        return False
    txn_id = str(txn.get("id") or payload.get("id") or "")
    user_id = str(user.get("id") or payload.get("user_id") or "")
    app_code = str(
        txn.get("application_code")
        or payload.get("application_code")
        or _server_app_code()
    )
    if not (txn_id and user_id):
        return False
    expected = compute_webhook_stoken(
        transaction_id=txn_id,
        user_id=user_id,
        application_code=app_code,
    )
    return expected.lower() == stoken


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


# Back-compat alias
parse_dmn_params = parse_webhook_payload


def verify_dmn_checksum(params: dict[str, Any]) -> Optional[bool]:
    """
    Verify Paymentez webhook stoken when present.

    Returns True if the stoken is present and matches, False if present and
    wrong, or None if simply absent — callers MUST treat None as unverified
    and re-check via get_transaction, never as implicitly valid.
    """
    return verify_webhook_stoken(params)


def split_buyer_name(full_name: str) -> tuple[str, str]:
    parts = (full_name or "").strip().split(None, 1)
    if not parts:
        return "Cliente", "TYS"
    if len(parts) == 1:
        return parts[0][:30], "TYS"
    return parts[0][:30], parts[1][:40]


def client_config_payload(open_result: dict) -> dict[str, Any]:
    """Fields the frontend needs for PaymentCheckout.modal."""
    out: dict[str, Any] = {
        "reference": open_result["reference"],
        "session_token": open_result["session_token"],
        "env": open_result["env"],
        "checkout_js_url": open_result.get("checkout_js_url") or CHECKOUT_JS_URL,
        "checkout_url": open_result.get("checkout_url"),
        "amount": open_result.get("amount"),
        "currency": open_result.get("currency"),
        "client_unique_id": open_result.get("client_unique_id"),
    }
    if open_result.get("client_app_code"):
        out["client_app_code"] = open_result["client_app_code"]
    if open_result.get("client_app_key"):
        out["client_app_key"] = open_result["client_app_key"]
    return out
