"""Unit tests for Nuvei checksum + amount helpers."""

from services.nuvei_service import (
    cents_to_amount,
    is_approved_status,
    open_order_checksum,
    parse_dmn_params,
    split_buyer_name,
)


def test_cents_to_amount():
    assert cents_to_amount(0) == "0.00"
    assert cents_to_amount(1250) == "12.50"
    assert cents_to_amount(20000) == "200.00"


def test_open_order_checksum_stable():
    # Documented concatenation order from Nuvei REST API.
    digest = open_order_checksum(
        merchant_id="427583496191624621",
        merchant_site_id="142033",
        client_request_id="1C6CT7V1L",
        amount="200",
        currency="USD",
        time_stamp="20240118191751",
        secret_key="SecretKey",
    )
    assert len(digest) == 64
    assert digest == open_order_checksum(
        merchant_id="427583496191624621",
        merchant_site_id="142033",
        client_request_id="1C6CT7V1L",
        amount="200",
        currency="USD",
        time_stamp="20240118191751",
        secret_key="SecretKey",
    )
    assert digest != open_order_checksum(
        merchant_id="427583496191624621",
        merchant_site_id="142033",
        client_request_id="1C6CT7V1L",
        amount="201",
        currency="USD",
        time_stamp="20240118191751",
        secret_key="SecretKey",
    )


def test_parse_dmn_and_approved():
    parsed = parse_dmn_params(
        {
            "Status": "APPROVED",
            "merchant_unique_id": "TYS-000123",
            "TransactionID": "111",
            "sessionToken": "abc",
        }
    )
    assert parsed["status"] == "APPROVED"
    assert parsed["client_unique_id"] == "TYS-000123"
    assert parsed["transaction_id"] == "111"
    assert is_approved_status(parsed["status"])
    assert not is_approved_status("DECLINED")


def test_split_buyer_name():
    assert split_buyer_name("Juan Pérez") == ("Juan", "Pérez")
    assert split_buyer_name("Madonna") == ("Madonna", "TYS")
    assert split_buyer_name("") == ("Cliente", "TYS")
