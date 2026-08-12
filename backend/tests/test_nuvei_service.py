"""Unit tests for Nuvei Ecuador (Paymentez) helpers."""

from services.nuvei_service import (
    build_auth_token,
    cents_to_amount,
    compute_webhook_stoken,
    is_approved_status,
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
                "stoken": "abc",
            },
            "user": {"id": "4", "email": "a@b.com"},
        }
    )
    assert parsed["client_unique_id"] == "TYS-000123"
    assert parsed["transaction_id"] == "CI-502"
    assert is_approved_status(parsed["status"], parsed["status_detail"])
    assert is_approved_status("success", 3)
    assert not is_approved_status("failure", 9)
    assert not is_approved_status("success", 9)


def test_split_buyer_name():
    assert split_buyer_name("Juan Pérez") == ("Juan", "Pérez")
    assert split_buyer_name("Madonna") == ("Madonna", "TYS")
    assert split_buyer_name("") == ("Cliente", "TYS")
