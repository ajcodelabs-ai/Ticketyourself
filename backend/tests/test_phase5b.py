"""
Phase 5b — Manual payment (transfer + cash) integration tests.

Covers: public POST /api/public/orders with payment_method, GET /instructions,
organizer confirm-payment + reject-payment + idempotency + RBAC.
"""
import os
import sys
import uuid
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@ticketyourself.com"
DEMO_PASSWORD = "Organizer123!"
RECHAZADO_EMAIL = "rechazado@ticketyourself.com"
RECHAZADO_PASSWORD = "Organizer123!"
EVENT_SLUG = "concierto-acustico-demo"
TENANT = "demo-org"


@pytest.fixture(scope="module")
def demo_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def demo_event_id(demo_token):
    r = requests.get(
        f"{API}/events/me",
        headers={"Authorization": f"Bearer {demo_token}"},
        timeout=15,
    )
    r.raise_for_status()
    for e in r.json().get("items", []):
        if e["slug"] == EVENT_SLUG:
            return e["id"]
    pytest.skip(f"Event {EVENT_SLUG} not seeded")


def _unique_buyer(label: str) -> dict:
    sid = uuid.uuid4().hex[:8]
    return {
        "name": f"Test {label} {sid}",
        "email": f"phase5b+{label}-{sid}@example.com",
        "phone": "+593987654321",
        "document_id": "1700000000",
    }


def _create_manual_order(method: str) -> dict:
    body = {
        "tenant_slug": TENANT,
        "event_slug": EVENT_SLUG,
        "quantity": 1,
        "buyer": _unique_buyer(method),
        "payment_method": method,
        "origin_url": BASE_URL,
    }
    r = requests.post(f"{API}/public/orders", json=body, timeout=15)
    r.raise_for_status()
    return r.json()


# ── Tests ────────────────────────────────────────────────────────────────────
def test_create_order_with_transfer_returns_pending_manual():
    data = _create_manual_order("transfer")
    assert data["status"] == "pending_manual_payment"
    assert data["payment_method"] == "transfer"
    assert "instrucciones" in data["redirect_to"]
    assert data["payment_instructions"]["bank_name"]
    assert data["payment_instructions"]["account_number"]


def test_create_order_with_cash_returns_pending_manual():
    data = _create_manual_order("cash")
    assert data["status"] == "pending_manual_payment"
    assert data["payment_method"] == "cash"
    assert data["payment_instructions"]["location"]


def test_get_instructions_endpoint():
    created = _create_manual_order("transfer")
    r = requests.get(f"{API}/public/orders/{created['order_number']}/instructions", timeout=10)
    assert r.status_code == 200
    body = r.json()
    assert body["order"]["status"] == "pending_manual_payment"
    assert body["payment_method"] == "transfer"
    assert body["payment_instructions"]["bank_name"]


def test_confirm_manual_payment_full_flow(demo_token, demo_event_id):
    created = _create_manual_order("transfer")
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]

    # Confirm
    r = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"notes": "Ok pichincha", "reference": "TRX-001"},
        timeout=15,
    )
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["order"]["status"] == "paid"
    assert data["order"]["paid_at"]
    assert data["order"]["manual_payment_info"]["confirmed_by"]
    assert data["order"]["manual_payment_info"]["reference"] == "TRX-001"
    assert len(data["tickets"]) == 1
    assert data["tickets"][0]["status"] == "issued"


def test_confirm_idempotent_no_double_tickets(demo_token, demo_event_id):
    created = _create_manual_order("transfer")
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]

    # First confirm
    r1 = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert r1.status_code == 200
    n1 = len(r1.json()["tickets"])

    # Second confirm — should NOT duplicate
    r2 = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert r2.status_code == 200
    n2 = len(r2.json()["tickets"])
    assert n1 == n2 == 1


def test_reject_manual_payment(demo_token, demo_event_id):
    created = _create_manual_order("cash")
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]

    r = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/reject-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"reason": "No pagó en plazo"},
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert body["ok"] is True
    assert body["order"]["status"] == "cancelled"
    assert body["order"]["refund_reason"] == "No pagó en plazo"


def test_rbac_other_organizer_cannot_confirm(demo_event_id):
    """An organizer that doesn't own the event must get 403/404 on confirm."""
    other = requests.post(
        f"{API}/auth/login",
        json={"email": RECHAZADO_EMAIL, "password": RECHAZADO_PASSWORD},
        timeout=15,
    )
    if other.status_code != 200:
        pytest.skip("Rechazado account not seeded")
    other_token = other.json()["access_token"]

    created = _create_manual_order("transfer")
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]

    r = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {other_token}"},
        json={},
        timeout=15,
    )
    # Either 403 (RBAC fail) or 404 (event not found for this organizer)
    assert r.status_code in (403, 404)


def test_validate_qr_after_manual_confirm(demo_token, demo_event_id):
    """After manual confirm, the JWT QR token must validate exactly once."""
    created = _create_manual_order("transfer")
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]
    confirm = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert confirm.status_code == 200
    qr = confirm.json()["tickets"][0]["qr_token"]

    v1 = requests.post(
        f"{API}/tickets/validate",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"qr_token": qr},
        timeout=10,
    )
    assert v1.status_code == 200
    assert v1.json()["valid"] is True

    # Second validate → already_used
    v2 = requests.post(
        f"{API}/tickets/validate",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"qr_token": qr},
        timeout=10,
    )
    assert v2.status_code == 200
    body = v2.json()
    assert body["valid"] is False
    assert body["reason"] == "already_used"


def test_invalid_payment_method_rejected():
    body = {
        "tenant_slug": TENANT,
        "event_slug": EVENT_SLUG,
        "quantity": 1,
        "buyer": _unique_buyer("bogus"),
        "payment_method": "bitcoin",
        "origin_url": BASE_URL,
    }
    r = requests.post(f"{API}/public/orders", json=body, timeout=10)
    assert r.status_code in (400, 422)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v", "-x"]))
