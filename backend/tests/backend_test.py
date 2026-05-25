"""
Backend tests for Ticket Yourself (TYS) Fase 0 POC.
Covers: health, tenant resolution, Stripe session creation, payments listing,
status polling, webhook signature failure, and idempotent seed.
"""
import os
import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com").rstrip("/")
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "test_database")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


# ── Health ────────────────────────────────────────────────────────────────────
class TestHealth:
    def test_health_ok(self, api):
        r = api.get(f"{BASE_URL}/api/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_openapi_under_api(self, api):
        r = api.get(f"{BASE_URL}/api/openapi.json")
        assert r.status_code == 200
        data = r.json()
        assert "paths" in data
        # Every path should start with /api
        for p in data["paths"]:
            assert p.startswith("/api"), f"Path {p} not under /api"

    def test_openapi_not_at_root(self, api):
        r = api.get(f"{BASE_URL}/openapi.json")
        # Backend ingress only routes /api/*; root falls to frontend SPA.
        # We just verify that root URL does NOT return the FastAPI openapi document.
        if r.status_code == 200:
            try:
                data = r.json()
                assert "openapi" not in data or "paths" not in data, \
                    "FastAPI openapi.json should NOT be served at root /"
            except ValueError:
                pass  # not JSON, that's fine (frontend HTML)


# ── Tenants resolve ───────────────────────────────────────────────────────────
class TestTenantsResolve:
    def test_resolve_demo_org(self, api):
        r = api.get(f"{BASE_URL}/api/tenants/resolve", params={"tenant": "demo-org"})
        assert r.status_code == 200
        data = r.json()
        assert data["tenant"] is not None
        assert data["tenant"]["slug"] == "demo-org"
        assert data["tenant"]["name"] == "Demo Organizer"
        assert data["tenant"]["status"] == "active"

    def test_resolve_non_existent(self, api):
        r = api.get(f"{BASE_URL}/api/tenants/resolve", params={"tenant": "non-existent"})
        assert r.status_code == 200
        assert r.json() == {"tenant": None}

    def test_resolve_no_param(self, api):
        r = api.get(f"{BASE_URL}/api/tenants/resolve")
        assert r.status_code == 200
        assert r.json() == {"tenant": None}


# ── Stripe subscription session ───────────────────────────────────────────────
class TestSubscriptionSession:
    def test_create_subscription_basic(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "plan_name": "basic",
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-subscription-session", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "checkout_url" in data
        assert "session_id" in data
        assert data["session_id"].startswith("cs_test_"), f"session_id={data['session_id']}"
        assert "checkout.stripe.com" in data["checkout_url"]

        # Verify DB row via listing endpoint
        r2 = api.get(f"{BASE_URL}/api/poc/payments", params={"tenant_slug": "demo-org"})
        assert r2.status_code == 200
        rows = r2.json()
        match = [x for x in rows if x["stripe_session_id"] == data["session_id"]]
        assert len(match) == 1
        row = match[0]
        assert row["status"] == "pending"
        assert row["type"] == "subscription"
        assert row["amount_cents"] == 2000
        assert row["plan_name"] == "basic"
        assert row["tenant_slug"] == "demo-org"
        # Ensure no _id leaked
        assert "_id" not in row

    def test_create_subscription_pro(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "plan_name": "pro",
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-subscription-session", json=payload)
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]

        r2 = api.get(f"{BASE_URL}/api/poc/payments", params={"tenant_slug": "demo-org"})
        match = [x for x in r2.json() if x["stripe_session_id"] == sid][0]
        assert match["amount_cents"] == 5000
        assert match["plan_name"] == "pro"

    def test_subscription_invalid_tenant(self, api):
        payload = {
            "tenant_slug": "does-not-exist",
            "plan_name": "basic",
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-subscription-session", json=payload)
        assert r.status_code == 404

    def test_subscription_invalid_plan(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "plan_name": "ultra",
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-subscription-session", json=payload)
        assert r.status_code in (400, 422), f"Got {r.status_code}: {r.text}"


# ── Stripe ticket session ─────────────────────────────────────────────────────
class TestTicketSession:
    def test_create_ticket_session(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "event_name": "Concierto POC",
            "amount_cents": 1500,
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-ticket-session", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["session_id"].startswith("cs_test_")
        assert "checkout.stripe.com" in data["checkout_url"]

        r2 = api.get(f"{BASE_URL}/api/poc/payments", params={"tenant_slug": "demo-org"})
        match = [x for x in r2.json() if x["stripe_session_id"] == data["session_id"]][0]
        assert match["type"] == "ticket"
        assert match["amount_cents"] == 1500
        assert match["event_name"] == "Concierto POC"
        assert match["status"] == "pending"

    def test_ticket_amount_negative(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "event_name": "x",
            "amount_cents": 0,
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-ticket-session", json=payload)
        assert r.status_code == 422

    def test_ticket_invalid_tenant(self, api):
        payload = {
            "tenant_slug": "ghost",
            "event_name": "x",
            "amount_cents": 1500,
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-ticket-session", json=payload)
        assert r.status_code == 404


# ── Payments listing ──────────────────────────────────────────────────────────
class TestPaymentsList:
    def test_payments_filtered_and_no_mongo_id(self, api):
        r = api.get(f"{BASE_URL}/api/poc/payments", params={"tenant_slug": "demo-org"})
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        for row in rows:
            assert row["tenant_slug"] == "demo-org"
            assert "_id" not in row
            assert "id" in row
        # Sorted desc by created_at
        if len(rows) >= 2:
            assert rows[0]["created_at"] >= rows[1]["created_at"]

    def test_payments_other_tenant_isolated(self, api):
        r = api.get(f"{BASE_URL}/api/poc/payments", params={"tenant_slug": "prueba-eventos"})
        assert r.status_code == 200
        for row in r.json():
            assert row["tenant_slug"] == "prueba-eventos"


# ── Stripe status polling ─────────────────────────────────────────────────────
class TestStripeStatus:
    def test_status_for_fresh_session(self, api):
        payload = {
            "tenant_slug": "demo-org",
            "plan_name": "basic",
            "origin_url": BASE_URL,
        }
        r = api.post(f"{BASE_URL}/api/poc/stripe/create-subscription-session", json=payload)
        sid = r.json()["session_id"]

        r2 = api.get(f"{BASE_URL}/api/poc/stripe/status/{sid}")
        assert r2.status_code == 200, r2.text
        data = r2.json()
        assert data["session_id"] == sid
        assert "payment_status" in data
        assert "status" in data
        assert "db_status" in data
        # not paid since we never completed checkout
        assert data["db_status"] in ("pending", "failed")
        assert data["payment_status"] != "paid"


# ── Webhook signature failure ─────────────────────────────────────────────────
class TestWebhook:
    def test_webhook_no_signature(self, api):
        r = api.post(
            f"{BASE_URL}/api/stripe/webhook",
            data=b"{}",
            headers={"Content-Type": "application/json"},
        )
        # Should be 400 (invalid sig), not 500
        assert r.status_code == 400, f"Got {r.status_code}: {r.text}"


# ── Seed idempotency (Fase 0 demo tenants) ────────────────────────────────────
class TestSeed:
    def test_demo_tenants_present(self, mongo_db):
        # Phase 0+ seed must always include these two POC tenants; additional
        # tenants from later phases (rejected demo, system tenants, etc.) are
        # allowed without breaking this check.
        slugs = {t["slug"] for t in mongo_db.tenants.find({}, {"slug": 1})}
        assert "demo-org" in slugs
        assert "prueba-eventos" in slugs
