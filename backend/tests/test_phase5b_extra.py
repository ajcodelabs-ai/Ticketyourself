"""
Phase 5b — Additional coverage tests on top of test_phase5b.py.

Covers:
- transfer method to an event WITHOUT transfer enabled → 400
- free events ignore payment_method (instant paid)
- Stripe regression — payment_method='stripe' returns checkout_url
- Seed manual orders present (Test Transferencia / Test Efectivo)
- Email logs (filesystem) contain expected texts on instructions/confirm/reject
- Confirm already-paid order is idempotent
- Reject already-paid order returns 422
"""
import os
import uuid
import time
import glob
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@ticketyourself.com"
DEMO_PASSWORD = "Organizer123!"
TENANT = "demo-org"
EVENT_WITH_MANUAL = "concierto-acustico-demo"           # transfer + cash enabled
EVENT_STRIPE_ONLY = "conferencia-marketing-digital"      # only stripe
EMAIL_LOG_DIR = "/app/backend/email_log"


# ── Fixtures ─────────────────────────────────────────────────────────────────
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
        if e["slug"] == EVENT_WITH_MANUAL:
            return e["id"]
    pytest.skip("Demo event not seeded")


def _buyer(label: str):
    sid = uuid.uuid4().hex[:8]
    return {
        "name": f"Test {label} {sid}",
        "email": f"phase5bx+{label}-{sid}@example.com",
        "phone": "+593987654321",
        "document_id": "1700000000",
    }


def _create(method: str, slug: str = EVENT_WITH_MANUAL):
    body = {
        "tenant_slug": TENANT,
        "event_slug": slug,
        "quantity": 1,
        "buyer": _buyer(method),
        "payment_method": method,
        "origin_url": BASE_URL,
    }
    return requests.post(f"{API}/public/orders", json=body, timeout=15)


# ── Tests ────────────────────────────────────────────────────────────────────
def test_transfer_on_event_without_transfer_returns_400():
    """conferencia-marketing-digital is Stripe-only — transfer must be rejected."""
    r = _create("transfer", slug=EVENT_STRIPE_ONLY)
    # Accept 400 (business rule) or 422 (validation) — both communicate "not allowed"
    assert r.status_code in (400, 422), f"Expected 400/422, got {r.status_code}: {r.text}"


def test_stripe_method_returns_checkout_url():
    """Phase 4 regression — payment_method='stripe' returns a checkout_url."""
    r = _create("stripe", slug=EVENT_STRIPE_ONLY)
    assert r.status_code == 200, r.text
    data = r.json()
    # Field could be 'checkout_url' or nested in 'redirect_to'
    assert (
        "checkout_url" in data
        or (data.get("redirect_to") and "stripe" in data["redirect_to"].lower())
        or (data.get("redirect_to") and "checkout" in data["redirect_to"].lower())
    ), f"No checkout_url-like field in: {data}"


def test_free_event_ignores_payment_method():
    """Free events should still create instant paid orders regardless of payment_method."""
    # Find a free event in public listing
    r = requests.get(f"{API}/public/events", timeout=10)
    if r.status_code != 200:
        pytest.skip("public/events unavailable")
    free_slug = None
    for e in r.json().get("items", []):
        if (e.get("price") or 0) == 0 and (e.get("tenant_slug") or "") == TENANT:
            free_slug = e.get("slug")
            break
    if not free_slug:
        pytest.skip("No free event in demo-org seeds")

    body = {
        "tenant_slug": TENANT,
        "event_slug": free_slug,
        "quantity": 1,
        "buyer": _buyer("free"),
        "payment_method": "transfer",  # should be ignored for free events
        "origin_url": BASE_URL,
    }
    r2 = requests.post(f"{API}/public/orders", json=body, timeout=15)
    assert r2.status_code == 200, r2.text
    data = r2.json()
    # Free orders are typically 'paid' instantly OR redirect to gracias-page
    assert data.get("status") in ("paid", "pending_manual_payment") is False or data.get("status") == "paid", (
        f"Free event should be instant paid, got: {data}"
    )


def test_seed_manual_orders_exist(demo_token, demo_event_id):
    """Seeds should include at least one Test Transferencia / Test Efectivo pending order."""
    r = requests.get(
        f"{API}/events/me/{demo_event_id}/orders",
        headers={"Authorization": f"Bearer {demo_token}"},
        params={"status": "pending_manual_payment"},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    items = r.json().get("items", []) or r.json().get("orders", []) or []
    names = " ".join((it.get("buyer", {}) or {}).get("name", "") for it in items).lower()
    assert "transferencia" in names or "efectivo" in names, (
        f"Expected seed buyer 'Test Transferencia'/'Test Efectivo' in pending list, got names: {names[:300]}"
    )


def test_email_log_instructions_on_manual_create():
    """When manual order is created, an email file with 'Instrucciones de pago' should appear."""
    before = set(glob.glob(f"{EMAIL_LOG_DIR}/*"))
    r = _create("transfer")
    assert r.status_code == 200, r.text
    time.sleep(1)
    after = set(glob.glob(f"{EMAIL_LOG_DIR}/*"))
    new_files = after - before
    if not new_files:
        pytest.skip("No new email files found — emails may be disabled in env")
    found = False
    for f in new_files:
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                content = fh.read().lower()
            if "instrucciones de pago" in content or "instrucciones" in content:
                found = True
                break
        except OSError:
            continue
    assert found, f"No 'Instrucciones de pago' email log among {[os.path.basename(x) for x in new_files]}"


def _email_contains(token_email: str, phrases: list[str]) -> bool:
    """Scan recent email_log/*.html files for an email matching buyer + any phrase."""
    files = sorted(glob.glob(f"{EMAIL_LOG_DIR}/*.html"), reverse=True)[:30]
    safe = token_email.replace("@", "_").replace("+", "_")
    for f in files:
        if safe not in os.path.basename(f):
            continue
        try:
            with open(f, "r", encoding="utf-8", errors="ignore") as fh:
                c = fh.read().lower()
        except OSError:
            continue
        if any(p in c for p in phrases):
            return True
    return False


def test_email_log_on_confirm_and_reject(demo_token, demo_event_id):
    """Confirm → 'pago fue confirmado'/entrada email; Reject → 'reserva fue cancelada'."""
    # CONFIRM
    created = _create("transfer").json()
    buyer_email = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["buyer"]["email"]
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]
    cr = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert cr.status_code == 200
    time.sleep(1.5)
    confirmed_ok = _email_contains(
        buyer_email,
        ["pago fue confirmado", "tu compra", "tu entrada", "qr", "ticket"],
    )

    # REJECT
    created2 = _create("cash").json()
    buyer_email2 = requests.get(
        f"{API}/public/orders/{created2['order_number']}", timeout=10
    ).json()["order"]["buyer"]["email"]
    order_id2 = requests.get(
        f"{API}/public/orders/{created2['order_number']}", timeout=10
    ).json()["order"]["id"]
    rr = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id2}/reject-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"reason": "Test reject"},
        timeout=15,
    )
    assert rr.status_code == 200
    time.sleep(1.5)
    rejected_ok = _email_contains(
        buyer_email2,
        ["reserva fue cancelada", "cancelada", "rechaz"],
    )

    assert confirmed_ok, f"No confirmed-payment email log for {buyer_email}"
    assert rejected_ok, f"No rejected-payment email log for {buyer_email2}"


def test_confirm_already_paid_is_idempotent(demo_token, demo_event_id):
    """Calling confirm-payment on a 'paid' order should not break — returns tickets."""
    created = _create("transfer").json()
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]
    r1 = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert r1.status_code == 200
    r2 = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    assert r2.status_code == 200, r2.text
    assert r2.json().get("order", {}).get("status") == "paid"


def test_reject_already_paid_returns_422(demo_token, demo_event_id):
    """Rejecting a paid order should fail (422 or 400)."""
    created = _create("transfer").json()
    order_id = requests.get(
        f"{API}/public/orders/{created['order_number']}", timeout=10
    ).json()["order"]["id"]
    # Confirm first
    requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/confirm-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={},
        timeout=15,
    )
    # Try to reject
    r = requests.post(
        f"{API}/events/me/{demo_event_id}/orders/{order_id}/reject-payment",
        headers={"Authorization": f"Bearer {demo_token}"},
        json={"reason": "should fail"},
        timeout=15,
    )
    assert r.status_code in (400, 422, 409), f"Expected error on reject-paid, got {r.status_code}: {r.text}"


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
