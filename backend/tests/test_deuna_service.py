"""Unit tests for DEUNA helpers."""

from services.deuna_service import (
    is_paid,
    parse_webhook_payload,
    split_buyer_name,
)


def test_split_buyer_name():
    assert split_buyer_name("Ana López") == ("Ana", "López")
    assert split_buyer_name("Solo") == ("Solo", "TYS")
    assert split_buyer_name("") == ("Cliente", "TYS")


def test_is_paid_statuses():
    assert is_paid({"status": "succeeded", "payment_status": ""})
    assert is_paid({"status": "pending", "payment_status": "captured"})
    assert not is_paid({"status": "pending", "payment_status": ""})
    assert not is_paid({"status": "denied", "payment_status": "denied"})


def test_parse_webhook_payload():
    parsed = parse_webhook_payload(
        {
            "order": {
                "token": "tok-1",
                "order_id": "TYS-000001",
                "status": "succeeded",
                "payment": {"data": {"status": "captured", "id": "pay-9"}},
            }
        }
    )
    assert parsed["order_token"] == "tok-1"
    assert parsed["order_id"] == "TYS-000001"
    assert parsed["status"] == "succeeded"
    assert parsed["payment_status"] == "captured"
    assert parsed["transaction_id"] == "pay-9"
