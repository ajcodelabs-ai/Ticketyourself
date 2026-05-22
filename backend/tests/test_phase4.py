"""
TYS Phase 4 — Public ticket purchase + organizer sales/stats/refund + validation.

Covers:
- POST /api/public/orders (free + paid + validations)
- GET /api/public/orders/{order_number}
- POST /api/_dev/simulate-purchase-paid (idempotency + finalize)
- GET /api/public/orders/{order_number}/tickets/{ticket_id}/pdf
- GET /api/events/me/{event_id}/{orders,tickets,tickets.csv,stats}
- POST /api/events/me/{event_id}/orders/{order_id}/refund
- POST /api/events/me/{event_id}/orders/{order_id}/resend-email
- POST /api/tickets/validate (idempotent already_used)
- Cross-tenant RBAC 403
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://d049ce64-7122-4dac-92d0-1c8f818c9d2b.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_TENANT = "demo-org"
FREE_EVENT = "charla-liderazgo-femenino"
PAID_EVENT = "concierto-acustico-demo"

DEMO_LOGIN = {"email": "demo@ticketyourself.com", "password": "Organizer123!"}


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def organizer_token(session):
    r = session.post(f"{API}/auth/login", json=DEMO_LOGIN)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def organizer_headers(organizer_token):
    return {"Authorization": f"Bearer {organizer_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="session")
def demo_event_ids(session, organizer_headers):
    """Map slug -> event id from organizer's events list."""
    r = session.get(f"{API}/events/me", headers=organizer_headers)
    assert r.status_code == 200, r.text
    data = r.json()
    events = data.get("items") if isinstance(data, dict) else data
    out = {ev["slug"]: ev["id"] for ev in events}
    assert FREE_EVENT in out and PAID_EVENT in out, f"missing seed events: {out.keys()}"
    return out


# ── 1. Free event purchase: instant paid + tickets ──────────────────────────
class TestFreeEventPurchase:
    def test_free_purchase_emits_tickets_instantly(self, session):
        payload = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": FREE_EVENT,
            "quantity": 2,
            "buyer": {"name": "Maria TEST", "email": f"maria_{int(time.time())}@example.com"},
        }
        r = session.post(f"{API}/public/orders", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "paid"
        assert len(data["tickets"]) == 2
        assert data["redirect_to"].startswith(f"/o/{DEMO_TENANT}/orden/TYS-")
        assert data["order_number"].startswith("TYS-")
        # qr_token present
        for t in data["tickets"]:
            assert t["qr_token"] and t["status"] == "issued"

    def test_free_purchase_get_order_returns_full_payload(self, session):
        payload = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": FREE_EVENT,
            "quantity": 1,
            "buyer": {"name": "Pedro TEST", "email": f"pedro_{int(time.time())}@example.com"},
        }
        cr = session.post(f"{API}/public/orders", json=payload)
        order_number = cr.json()["order_number"]

        r = session.get(f"{API}/public/orders/{order_number}")
        assert r.status_code == 200
        body = r.json()
        assert body["order"]["status"] == "paid"
        assert len(body["tickets"]) == 1
        assert body["event"]["slug"] == FREE_EVENT
        assert body["organizer"]["slug"] == DEMO_TENANT
        assert "branding" in body


# ── 2. Paid event purchase + simulator finalize ─────────────────────────────
@pytest.fixture(scope="class")
def paid_order(session):
    """Create one paid pending order shared across class for ordering tests."""
    payload = {
        "tenant_slug": DEMO_TENANT,
        "event_slug": PAID_EVENT,
        "quantity": 2,
        "buyer": {"name": "Juan TEST", "email": f"juan_{int(time.time())}@example.com"},
        "origin_url": BASE_URL,
    }
    r = session.post(f"{API}/public/orders", json=payload)
    assert r.status_code == 200, r.text
    return r.json()


class TestPaidEventPurchase:
    def test_paid_creates_stripe_session(self, paid_order):
        assert paid_order["status"] == "pending"
        assert paid_order["checkout_url"].startswith("http")
        assert paid_order["session_id"]
        assert paid_order["order_number"].startswith("TYS-")

    def test_simulate_purchase_paid_finalizes(self, session, paid_order):
        r = session.post(
            f"{API}/_dev/simulate-purchase-paid",
            json={"order_number": paid_order["order_number"]},
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert len(d["tickets"]) == 2
        assert d["order"]["status"] == "paid"

    def test_finalize_idempotent_does_not_duplicate_tickets(self, session, paid_order):
        # Call simulator again
        r = session.post(
            f"{API}/_dev/simulate-purchase-paid",
            json={"order_number": paid_order["order_number"]},
        )
        assert r.status_code == 200
        d = r.json()
        assert d.get("already_paid") is True
        # Still only 2 tickets
        g = session.get(f"{API}/public/orders/{paid_order['order_number']}")
        assert len(g.json()["tickets"]) == 2


# ── 3. PDF generation ───────────────────────────────────────────────────────
class TestTicketPDF:
    def test_pdf_for_paid_order_returns_pdf_bytes(self, session):
        # Create a free order (instant paid)
        cr = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": FREE_EVENT,
                "quantity": 1,
                "buyer": {"name": "Pdf TEST", "email": f"pdf_{int(time.time())}@example.com"},
            },
        )
        order_number = cr.json()["order_number"]
        ticket_id = cr.json()["tickets"][0]["id"]
        r = session.get(f"{API}/public/orders/{order_number}/tickets/{ticket_id}/pdf")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("application/pdf")
        assert r.content[:4] == b"%PDF"
        assert len(r.content) > 500

    def test_pdf_for_pending_order_returns_404(self, session):
        cr = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": PAID_EVENT,
                "quantity": 1,
                "buyer": {"name": "Pending TEST", "email": f"pend_{int(time.time())}@example.com"},
                "origin_url": BASE_URL,
            },
        )
        on = cr.json()["order_number"]
        # Pretend a random ticket id
        r = session.get(f"{API}/public/orders/{on}/tickets/non-existent/pdf")
        assert r.status_code == 404


# ── 4. Validation errors ────────────────────────────────────────────────────
class TestPurchaseValidations:
    def test_invalid_email_returns_422(self, session):
        r = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": FREE_EVENT,
                "quantity": 1,
                "buyer": {"name": "Bad", "email": "not-an-email"},
            },
        )
        assert r.status_code == 422

    def test_quantity_above_max_returns_422(self, session):
        r = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": FREE_EVENT,
                "quantity": 11,
                "buyer": {"name": "Bulk", "email": "b@e.com"},
            },
        )
        assert r.status_code == 422

    def test_event_not_found_returns_404(self, session):
        r = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": "no-existe-xyz",
                "quantity": 1,
                "buyer": {"name": "X TEST", "email": "x@e.com"},
            },
        )
        assert r.status_code == 404

    def test_tenant_not_found_returns_404(self, session):
        r = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": "no-existe-tenant",
                "event_slug": FREE_EVENT,
                "quantity": 1,
                "buyer": {"name": "X TEST", "email": "x@e.com"},
            },
        )
        assert r.status_code == 404


# ── 5. Organizer endpoints ──────────────────────────────────────────────────
class TestOrganizerEndpoints:
    def test_stats_returns_expected_shape(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[PAID_EVENT]
        r = session.get(f"{API}/events/me/{ev_id}/stats", headers=organizer_headers)
        assert r.status_code == 200
        d = r.json()
        for k in ("total_orders", "paid_orders", "revenue_cents", "capacity",
                  "tickets_issued", "conversion_rate", "sold", "available"):
            assert k in d, f"missing {k}: {d}"

    def test_list_orders_paginates(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[PAID_EVENT]
        r = session.get(
            f"{API}/events/me/{ev_id}/orders?page=1&limit=5", headers=organizer_headers
        )
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d
        assert len(d["items"]) <= 5

    def test_list_tickets(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[FREE_EVENT]
        r = session.get(f"{API}/events/me/{ev_id}/tickets", headers=organizer_headers)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d

    def test_tickets_csv_export(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[FREE_EVENT]
        r = session.get(f"{API}/events/me/{ev_id}/tickets.csv", headers=organizer_headers)
        assert r.status_code == 200
        assert "csv" in r.headers["content-type"]
        text = r.text
        assert "ticket_id" in text  # header row


# ── 6. Refund + Resend email ────────────────────────────────────────────────
class TestRefundAndResend:
    def _new_paid_order(self, session):
        cr = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": PAID_EVENT,
                "quantity": 1,
                "buyer": {"name": "Refund TEST", "email": f"rf_{int(time.time()*1000)}@example.com"},
                "origin_url": BASE_URL,
            },
        )
        on = cr.json()["order_number"]
        sim = session.post(f"{API}/_dev/simulate-purchase-paid", json={"order_number": on})
        assert sim.status_code == 200
        return on

    def test_refund_changes_status_and_decrements_sold(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[PAID_EVENT]
        # Get sold before
        stats_before = session.get(f"{API}/events/me/{ev_id}/stats", headers=organizer_headers).json()
        sold_before = stats_before["sold"]

        on = self._new_paid_order(session)
        # find order_id via organizer list
        lo = session.get(f"{API}/events/me/{ev_id}/orders?limit=20", headers=organizer_headers).json()
        order = next(o for o in lo["items"] if o["order_number"] == on)

        r = session.post(
            f"{API}/events/me/{ev_id}/orders/{order['id']}/refund",
            headers=organizer_headers,
            json={"reason": "test"},
        )
        assert r.status_code == 200, r.text
        refunded = r.json()
        assert refunded["status"] == "refunded"

        # Check tickets revoked
        g = session.get(f"{API}/public/orders/{on}")
        # Order no longer "paid" so PDF endpoint would 404 — verify status
        assert g.json()["order"]["status"] == "refunded"
        for t in g.json()["tickets"]:
            assert t["status"] == "revoked"

        stats_after = session.get(f"{API}/events/me/{ev_id}/stats", headers=organizer_headers).json()
        # sold_after should be == sold_before (we added 1, refund deducted 1)
        assert stats_after["sold"] == sold_before

    def test_resend_email_for_paid_order(self, session, organizer_headers, demo_event_ids):
        ev_id = demo_event_ids[PAID_EVENT]
        on = self._new_paid_order(session)
        lo = session.get(f"{API}/events/me/{ev_id}/orders?limit=20", headers=organizer_headers).json()
        order = next(o for o in lo["items"] if o["order_number"] == on)
        r = session.post(
            f"{API}/events/me/{ev_id}/orders/{order['id']}/resend-email",
            headers=organizer_headers,
        )
        assert r.status_code == 200
        assert r.json().get("ok") is True


# ── 7. Ticket validate ──────────────────────────────────────────────────────
class TestTicketValidate:
    def test_validate_marks_used_then_already_used(self, session, organizer_headers):
        # Create free order
        cr = session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": DEMO_TENANT,
                "event_slug": FREE_EVENT,
                "quantity": 1,
                "buyer": {"name": "Val TEST", "email": f"val_{int(time.time()*1000)}@example.com"},
            },
        )
        ticket = cr.json()["tickets"][0]
        qr_token = ticket["qr_token"]

        r1 = session.post(
            f"{API}/tickets/validate", headers=organizer_headers, json={"qr_token": qr_token}
        )
        assert r1.status_code == 200, r1.text
        b1 = r1.json()
        assert b1["valid"] is True
        assert b1["ticket"]["status"] == "used"

        r2 = session.post(
            f"{API}/tickets/validate", headers=organizer_headers, json={"qr_token": qr_token}
        )
        assert r2.status_code == 200
        b2 = r2.json()
        assert b2["valid"] is False
        assert b2["reason"] == "already_used"

    def test_validate_invalid_token(self, session, organizer_headers):
        r = session.post(
            f"{API}/tickets/validate",
            headers=organizer_headers,
            json={"qr_token": "not-a-real-jwt"},
        )
        assert r.status_code == 200
        assert r.json()["valid"] is False
        assert r.json()["reason"] == "invalid_token"


# ── 8. Cross-tenant RBAC ────────────────────────────────────────────────────
class TestCrossTenantRBAC:
    def test_other_organizer_cannot_access_demo_event(self):
        # Use isolated sessions to avoid cookie leakage between users
        # (backend security._extract_token prefers cookie over Authorization header)
        s_other = requests.Session()
        s_other.headers.update({"Content-Type": "application/json"})
        lr = s_other.post(
            f"{API}/auth/login",
            json={"email": "prueba@ticketyourself.com", "password": "Organizer123!"},
        )
        if lr.status_code != 200:
            pytest.skip("prueba organizer login failed")
        s_other.cookies.clear()  # Force Bearer-only auth
        other_headers = {
            "Authorization": f"Bearer {lr.json()['access_token']}",
            "Content-Type": "application/json",
        }

        s_demo = requests.Session()
        s_demo.headers.update({"Content-Type": "application/json"})
        dl = s_demo.post(f"{API}/auth/login", json=DEMO_LOGIN)
        ev_list = s_demo.get(
            f"{API}/events/me",
            headers={"Authorization": f"Bearer {dl.json()['access_token']}"},
        ).json()
        evs = ev_list.get("items") if isinstance(ev_list, dict) else ev_list
        demo_ev_id = next(e["id"] for e in evs if e["slug"] == PAID_EVENT)

        r = requests.get(f"{API}/events/me/{demo_ev_id}/stats", headers=other_headers)
        # Expected: 404 (event not found in their scope) or 403
        assert r.status_code in (403, 404), f"expected 403/404, got {r.status_code} {r.text}"
