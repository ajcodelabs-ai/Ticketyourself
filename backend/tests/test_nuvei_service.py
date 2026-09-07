"""Unit tests for Nuvei Ecuador (Paymentez) helpers."""

import pytest

from services.nuvei_service import (
    amount_matches,
    build_auth_token,
    cents_to_amount,
    compute_webhook_stoken,
    is_approved_status,
    is_cancelled_or_refunded,
    parse_webhook_payload,
    split_buyer_name,
)


def test_cents_to_amount():
    assert cents_to_amount(0) == 0.0
    assert cents_to_amount(1250) == 12.5
    assert cents_to_amount(20000) == 200.0


def test_build_auth_token_shape():
    import base64
    import hashlib

    code = "NUVEISTG-EC-SERVER"
    key = "secret-key-test"
    ts = "1700000000"
    token = build_auth_token(
        server_application_code=code,
        server_app_key=key,
        unix_timestamp=ts,
    )
    decoded = base64.b64decode(token).decode("ascii")
    parts = decoded.split(";")
    assert parts[0] == code
    assert parts[1] == ts
    assert parts[2] == hashlib.sha256(f"{key}{ts}".encode()).hexdigest()


def test_webhook_stoken_matches_docs_example():
    # Docs: transaction_id=123, app_code=HF, user_id=123456, app_key=2GYx...
    stoken = compute_webhook_stoken(
        transaction_id="123",
        user_id="123456",
        application_code="HF",
        app_key="2GYx7SdjmbucLKE924JVFcmCl8t6nB",
    )
    assert stoken == "e242e78ae5f1ed162966f0eacaa0af01"


def test_parse_webhook_and_approved():
    parsed = parse_webhook_payload(
        {
            "transaction": {
                "status": "1",
                "status_detail": "3",
                "id": "CI-502",
                "dev_reference": "TYS-000123",
                "authorization_code": "113310",
                "stoken": "abc",
            },
            "user": {"id": "4", "email": "a@b.com"},
        }
    )
    assert parsed["client_unique_id"] == "TYS-000123"
    assert parsed["transaction_id"] == "CI-502"
    assert parsed["authorization_code"] == "113310"
    assert is_approved_status(parsed["status"], parsed["status_detail"])
    assert is_approved_status("success", 3)
    assert is_approved_status("1", "3")
    assert not is_approved_status("success", None)
    assert not is_approved_status("success", 9)
    assert not is_approved_status("failure", 9)
    assert not is_approved_status("approved", 3)


def test_is_cancelled_or_refunded():
    assert is_cancelled_or_refunded("2", None) is True
    assert is_cancelled_or_refunded("cancelled", 3) is True
    assert is_cancelled_or_refunded("1", 7) is True
    assert is_cancelled_or_refunded("1", 8) is True
    assert is_cancelled_or_refunded("1", 34) is True
    assert is_cancelled_or_refunded("1", 3) is False


def test_split_buyer_name():
    assert split_buyer_name("Juan Pérez") == ("Juan", "Pérez")
    assert split_buyer_name("Madonna") == ("Madonna", "TYS")
    assert split_buyer_name("") == ("Cliente", "TYS")


def test_amount_matches_exact_and_rounding():
    assert amount_matches(12.50, 1250) is True
    assert amount_matches(12.49, 1250) is True  # 1-cent rounding tolerance
    assert amount_matches("12.50", 1250) is True  # gateway may report as string


def test_amount_matches_rejects_underpayment():
    # A genuinely-approved but much smaller transaction must not pass for a
    # larger order/plan — this is the actual fraud case the check guards.
    assert amount_matches(0.50, 5000) is False


def test_amount_matches_fails_closed_on_missing_or_malformed():
    assert amount_matches(None, 5000) is False
    assert amount_matches("not-a-number", 5000) is False


def test_public_payment_receipt():
    from services.nuvei_service import merge_payment_receipt, public_payment_receipt

    assert public_payment_receipt(None) is None
    meta = merge_payment_receipt(
        {},
        transaction_id="CI-502",
        authorization_code="113310",
    )
    receipt = public_payment_receipt(meta)
    assert receipt == {
        "transaction_id": "CI-502",
        "authorization_code": "113310",
    }


def test_purchase_email_includes_nuvei_receipt():
    import os

    pytest.importorskip("resend")
    os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
    os.environ.setdefault("JWT_SECRET", "test-secret")
    from services.email_service import render_purchase_html

    html = render_purchase_html(
        order={
            "order_number": "TYS-000001",
            "quantity_total": 1,
            "total_cents": 1000,
            "currency": "USD",
            "metadata": {
                "nuvei_transaction_id": "CI-502",
                "nuvei_authorization_code": "113310",
            },
        },
        event={"title": "Demo", "venue_name": "Teatro"},
        organizer={"slug": "demo-org", "company_name": "Demo"},
        tickets=[],
        primary_color="#4f46e5",
        frontend_base="http://localhost:3000",
    )
    assert "CI-502" in html
    assert "113310" in html
    assert "Transaction ID (DF)" in html
    assert "Código de autorización" in html


def test_refund_transaction_payload(monkeypatch):
    monkeypatch.setenv("NUVEI_SERVER_APP_CODE", "CODE")
    monkeypatch.setenv("NUVEI_SERVER_APP_KEY", "KEY")
    captured = {}

    def fake_request(method, path, *, json_body=None, base=None, auth_pair=None):
        captured["method"] = method
        captured["path"] = path
        captured["json_body"] = json_body
        captured["base"] = base
        captured["auth_pair"] = auth_pair
        return {"status": "success"}

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import refund_transaction

    refund_transaction("CI-502")
    assert captured["method"] == "POST"
    assert captured["path"] == "v2/transaction/refund/"
    assert captured["json_body"] == {"transaction": {"id": "CI-502"}}


def test_init_linktopay_payload(monkeypatch):
    monkeypatch.setenv("NUVEI_SERVER_APP_CODE", "CODE")
    monkeypatch.setenv("NUVEI_SERVER_APP_KEY", "KEY")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    captured = {}

    def fake_request(method, path, *, json_body=None, base=None, auth_pair=None):
        captured["method"] = method
        captured["path"] = path
        captured["json_body"] = json_body
        captured["base"] = base
        captured["auth_pair"] = auth_pair
        return {
            "success": True,
            "detail": "Operation completed successfully.",
            "data": {
                "order": {
                    "id": "wxwGPv4",
                    "status": "Init",
                    "dev_reference": "TYS-000001",
                },
                "payment": {
                    "payment_url": "https://test.paymentez.link/checkout/wxwGPv4"
                },
            },
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import init_linktopay

    result = init_linktopay(
        amount_cents=11500,
        dev_reference="TYS-000001",
        description="TEST",
        user_id="007",
        email="test@test.com",
        first_name="TEST",
        last_name="TEST",
        success_url="/o/demo-org/orden/TYS-000001",
        failure_url="/o/demo-org/orden/TYS-000001/cancelado",
    )
    assert captured["method"] == "POST"
    assert captured["path"] == "linktopay/init_order/"
    assert captured["base"] == "https://noccapi-stg.paymentez.com"
    assert captured["auth_pair"] == ("CODE", "KEY")
    body = captured["json_body"]
    assert body["user"] == {
        "id": "007",
        "email": "test@test.com",
        "name": "TEST",
        "last_name": "TEST",
    }
    assert body["order"]["dev_reference"] == "TYS-000001"
    assert body["order"]["amount"] == 115.0
    assert body["order"]["vat"] == 0
    assert body["order"]["tax_percentage"] == 0
    assert body["order"]["taxable_amount"] == 115.0
    assert body["order"]["currency"] == "USD"
    assert body["order"]["installments_type"] == 0
    assert body["configuration"]["partial_payment"] is False
    assert body["configuration"]["allowed_payment_methods"] == ["All"]
    assert body["configuration"]["success_url"].endswith("/o/demo-org/orden/TYS-000001")
    assert result["checkout_mode"] == "linktopay"
    assert result["reference"] == "wxwGPv4"
    assert result["payment_url"] == "https://test.paymentez.link/checkout/wxwGPv4"
    assert result["checkout_url"] == result["payment_url"]


def test_checkout_return_urls(monkeypatch):
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    from services.nuvei_service import checkout_return_urls

    urls = checkout_return_urls(
        success_path="/o/demo-org/orden/TYS-1",
        failure_path="/o/demo-org/orden/TYS-1/cancelado",
    )
    assert urls["success_url"] == "http://localhost:3000/o/demo-org/orden/TYS-1"
    assert urls["pending_url"] == urls["success_url"]
    assert urls["review_url"] == urls["success_url"]
    assert urls["failure_url"].endswith("/cancelado")


def test_prepare_checkout_client_uses_init_reference(monkeypatch):
    monkeypatch.setenv("NUVEI_CLIENT_APP_CODE", "TESTNUVEISTG-EC-CLIENT")
    monkeypatch.setenv("NUVEI_CLIENT_APP_KEY", "client-key")
    monkeypatch.delenv("NUVEI_SERVER_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_SERVER_APP_KEY", raising=False)
    monkeypatch.delenv("NUVEI_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_APP_KEY", raising=False)
    calls: list[str] = []

    def fake_request(_method, path, *, json_body=None, base=None, auth_pair=None):
        calls.append(path)
        assert json_body["order"]["amount"] == 10.0
        assert json_body["order"]["dev_reference"] == "TYS-1"
        return {
            "reference": "12438255612471559230",
            "checkout_url": (
                "https://ccapi-stg.paymentez.com/v2/transaction/checkout"
                "?reference=12438255612471559230"
            ),
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import is_configured, prepare_checkout

    assert is_configured() is True
    result = prepare_checkout(
        amount_cents=1000,
        client_unique_id="TYS-1",
        email="a@b.com",
        first_name="A",
        last_name="B",
        phone="0999999999",
    )
    assert calls == ["v2/transaction/init_reference/"]
    assert result["checkout_mode"] == "reference"
    assert result["reference"] == "12438255612471559230"
    assert "payment_checkout_3.0.0" in result["checkout_js_url"]
    assert result["user_email"] == "a@b.com"
    assert result["amount"] == "10.00"
    assert not result.get("payment_url")
    assert not result.get("client_app_key")


def test_prepare_checkout_misfiled_client_still_calls_init_reference(monkeypatch):
    monkeypatch.setenv("NUVEI_SERVER_APP_CODE", "TESTNUVEISTG-EC-CLIENT")
    monkeypatch.setenv("NUVEI_SERVER_APP_KEY", "client-key")
    monkeypatch.delenv("NUVEI_CLIENT_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_CLIENT_APP_KEY", raising=False)

    def fake_request(_method, path, *, json_body=None, base=None, auth_pair=None):
        assert path == "v2/transaction/init_reference/"
        return {
            "reference": "999",
            "checkout_url": "https://example/checkout?reference=999",
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import prepare_checkout

    result = prepare_checkout(
        amount_cents=500,
        client_unique_id="TYS-2",
        email="a@b.com",
    )
    assert result["checkout_mode"] == "reference"
    assert result["reference"] == "999"


def test_prepare_checkout_falls_back_to_linktopay_when_init_reference_fails(
    monkeypatch,
):
    monkeypatch.setenv("NUVEI_SERVER_APP_CODE", "CODE")
    monkeypatch.setenv("NUVEI_SERVER_APP_KEY", "KEY")
    monkeypatch.delenv("NUVEI_CLIENT_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_CLIENT_APP_KEY", raising=False)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    calls: list[str] = []

    def fake_request(_method, path, *, json_body=None, base=None, auth_pair=None):
        calls.append(path)
        if "init_reference" in path:
            from services.nuvei_service import NuveiError

            raise NuveiError("Try Again Later", err_code=500)
        return {
            "order": {"id": "ltp-1"},
            "payment": {"payment_url": "https://pay.example/ltp"},
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import prepare_checkout

    result = prepare_checkout(
        amount_cents=1000,
        client_unique_id="TYS-1",
        email="a@b.com",
        first_name="A",
        last_name="B",
        success_url="http://localhost:3000/ok",
        failure_url="http://localhost:3000/fail",
    )
    assert calls[0] == "v2/transaction/init_reference/"
    assert "linktopay" in calls[1]
    assert result["checkout_mode"] == "linktopay"


def test_prepare_checkout_client_falls_back_to_linktopay(monkeypatch):
    """Onboarding EC: only …-EC-CLIENT — still try Link to Pay after v3 fails."""
    monkeypatch.setenv("NUVEI_CLIENT_APP_CODE", "TESTNUVEISTG-EC-CLIENT")
    monkeypatch.setenv("NUVEI_CLIENT_APP_KEY", "client-key")
    monkeypatch.delenv("NUVEI_SERVER_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_SERVER_APP_KEY", raising=False)
    monkeypatch.delenv("NUVEI_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_APP_KEY", raising=False)
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    calls: list[str] = []

    def fake_request(_method, path, *, json_body=None, base=None, auth_pair=None):
        calls.append(path)
        if "init_reference" in path:
            from services.nuvei_service import NuveiError

            raise NuveiError("Try Again Later", err_code=500)
        return {
            "success": True,
            "data": {
                "order": {"id": "wxwGPv4"},
                "payment": {
                    "payment_url": "https://test.paymentez.link/checkout/wxwGPv4"
                },
            },
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import _auth_pair, is_configured, prepare_checkout

    assert is_configured() is True
    assert _auth_pair() == ("TESTNUVEISTG-EC-CLIENT", "client-key")
    result = prepare_checkout(
        amount_cents=1000,
        client_unique_id="TYS-1",
        email="a@b.com",
        first_name="A",
        last_name="B",
        success_url="http://localhost:3000/ok",
        failure_url="http://localhost:3000/fail",
    )
    assert calls[0] == "v2/transaction/init_reference/"
    assert "linktopay" in calls[1]
    assert result["checkout_mode"] == "linktopay"
    assert result["payment_url"].endswith("/wxwGPv4")


def test_split_pairs_client_for_ccapi_server_for_linktopay(monkeypatch):
    """Dedicated Link to Pay SERVER must not sign Checkout v3 init_reference."""
    monkeypatch.setenv("NUVEI_CLIENT_APP_CODE", "TESTNUVEISTG-EC-CLIENT")
    monkeypatch.setenv("NUVEI_CLIENT_APP_KEY", "client-key")
    monkeypatch.setenv("NUVEI_SERVER_APP_CODE", "LINKTOPAY01-EC-SERVER")
    monkeypatch.setenv("NUVEI_SERVER_APP_KEY", "server-key")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:3000")
    pairs: list[tuple[str, str]] = []

    def fake_request(_method, path, *, json_body=None, base=None, auth_pair=None):
        pairs.append((path, auth_pair))
        if "init_reference" in path:
            from services.nuvei_service import NuveiError

            raise NuveiError("Try Again Later", err_code=500)
        return {
            "success": True,
            "data": {
                "order": {"id": "ltp-ok"},
                "payment": {
                    "payment_url": "https://test.paymentez.link/checkout/ltp-ok"
                },
            },
        }

    monkeypatch.setattr("services.nuvei_service._request", fake_request)
    from services.nuvei_service import (
        _auth_pair,
        _ccapi_pair,
        _linktopay_pair,
        prepare_checkout,
    )

    assert _ccapi_pair() == ("TESTNUVEISTG-EC-CLIENT", "client-key")
    assert _linktopay_pair() == ("LINKTOPAY01-EC-SERVER", "server-key")
    assert _auth_pair() == ("LINKTOPAY01-EC-SERVER", "server-key")

    result = prepare_checkout(
        amount_cents=1000,
        client_unique_id="TYS-1",
        email="a@b.com",
        first_name="A",
        last_name="B",
        success_url="http://localhost:3000/ok",
        failure_url="http://localhost:3000/fail",
    )
    assert pairs[0][0] == "v2/transaction/init_reference/"
    assert pairs[0][1] == ("TESTNUVEISTG-EC-CLIENT", "client-key")
    assert "linktopay" in pairs[1][0]
    assert pairs[1][1] == ("LINKTOPAY01-EC-SERVER", "server-key")
    assert result["checkout_mode"] == "linktopay"


def test_build_auth_token_defaults_to_client_env(monkeypatch):
    monkeypatch.setenv("NUVEI_CLIENT_APP_CODE", "TESTNUVEISTG-EC-CLIENT")
    monkeypatch.setenv("NUVEI_CLIENT_APP_KEY", "client-key")
    monkeypatch.delenv("NUVEI_SERVER_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_SERVER_APP_KEY", raising=False)
    monkeypatch.delenv("NUVEI_APP_CODE", raising=False)
    monkeypatch.delenv("NUVEI_APP_KEY", raising=False)
    import base64
    import hashlib

    from services.nuvei_service import build_auth_token

    ts = "1700000000"
    token = build_auth_token(unix_timestamp=ts)
    decoded = base64.b64decode(token).decode("ascii")
    parts = decoded.split(";")
    assert parts[0] == "TESTNUVEISTG-EC-CLIENT"
    assert parts[1] == ts
    assert parts[2] == hashlib.sha256(b"client-key" + ts.encode()).hexdigest()


def test_describe_error_includes_payload(monkeypatch):
    from services.nuvei_service import NuveiError, checkout_http_detail, describe_error

    exc = NuveiError(
        "Application not found",
        err_code=401,
        payload={"detail": "Application not found", "error": {"type": "Auth"}},
    )
    text = describe_error(exc)
    assert "Application not found" in text
    assert "err_code=401" in text
    assert "payload=" in text

    monkeypatch.setenv("ENV", "development_local")
    detail = checkout_http_detail(exc)
    assert "Application not found" in detail
    monkeypatch.setenv("ENV", "production")
    assert "[" not in checkout_http_detail(exc)
