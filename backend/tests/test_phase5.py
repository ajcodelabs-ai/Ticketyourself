"""
Phase 5 backend tests — dashboard, plan features, gallery, event create/update with
payment_methods/discounts/access_params, seed verification, Phase 4 regression.
"""
import io
import os
from datetime import datetime, timedelta, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

DEMO_EMAIL = "demo@ticketyourself.com"
DEMO_PASS = "Organizer123!"


def _fresh_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(email, password):
    s = _fresh_session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    token = r.json()["access_token"]
    s.cookies.clear()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s, token


@pytest.fixture(scope="module")
def demo_client():
    s, _ = _login(DEMO_EMAIL, DEMO_PASS)
    return s


# ── 1. Dashboard aggregated ────────────────────────────────────────────────
class TestDashboard:
    def test_dashboard_me_payload(self, demo_client):
        r = demo_client.get(f"{API}/dashboard/me")
        assert r.status_code == 200
        data = r.json()
        for k in ("organizer", "plan", "stats", "upcoming_events", "microsite", "funnel", "features"):
            assert k in data, f"missing {k}"
        assert data["organizer"]["slug"] == "demo-org"
        assert data["organizer"]["status"] == "approved"
        assert data["plan"]["code"] == "profesional"
        # stats keys
        for k in ("revenue_cents", "tickets_sold_month", "published_events", "draft_events"):
            assert k in data["stats"]
        # upcoming has at most 5
        assert isinstance(data["upcoming_events"], list)
        assert len(data["upcoming_events"]) <= 5
        # features piggy-backed
        assert data["features"]["numbered_seating"] is True
        assert data["features"]["max_events"] == -1


# ── 2. Plan features ───────────────────────────────────────────────────────
class TestPlanFeatures:
    def test_features_for_profesional(self, demo_client):
        r = demo_client.get(f"{API}/plans/me/features")
        assert r.status_code == 200
        f = r.json()
        for k in ("numbered_seating", "manual_payments", "max_events", "_plan_code"):
            assert k in f, f"missing key {k}"
        assert f["_plan_code"] == "profesional"
        assert f["numbered_seating"] is True
        assert f["manual_payments"] is True
        assert f["max_events"] == -1


# ── 3. Event create/update with new fields + gallery ──────────────────────
class TestEventFase5Fields:
    @pytest.fixture(scope="class")
    def created_event(self, demo_client):
        starts = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        ends = (datetime.now(timezone.utc) + timedelta(days=30, hours=2)).isoformat()
        payload = {
            "title": "TEST_Fase5 Event",
            "description": "phase 5 event",
            "category": "music",
            "venue_name": "TEST Venue F5",
            "venue_city": "Quito",
            "starts_at": starts,
            "ends_at": ends,
            "pricing_type": "paid",
            "base_price_cents": 1500,
            "capacity": 100,
        }
        r = demo_client.post(f"{API}/events/me", json=payload)
        assert r.status_code == 201, f"create event failed: {r.text}"
        return r.json()

    def test_create_applies_default_fields(self, created_event):
        for k in ("gallery_urls", "payment_methods", "discounts", "access_params"):
            assert k in created_event, f"missing {k}"
        assert created_event["gallery_urls"] == []
        assert created_event["payment_methods"]["stripe"]["enabled"] is True
        assert created_event["payment_methods"]["transfer"]["enabled"] is False
        assert created_event["payment_methods"]["cash"]["enabled"] is False
        assert created_event["discounts"]["disability_law"]["enabled"] is False
        assert created_event["discounts"]["presale"]["enabled"] is False
        assert created_event["visibility"] == "public"
        assert created_event["access_params"]["access_type"] == "open"
        assert created_event["access_params"]["max_per_purchase"] == 10

    def test_update_payment_discounts_access(self, demo_client, created_event):
        eid = created_event["id"]
        body = {
            "payment_methods": {
                "stripe": {"enabled": True},
                "transfer": {
                    "enabled": True,
                    "bank_name": "Pichincha",
                    "account_number": "1234567890",
                    "account_holder": "Demo Org",
                    "instructions": "Enviar comprobante",
                },
                "cash": {"enabled": False, "location": "", "schedule": "", "contact": ""},
            },
            "discounts": {
                "disability_law": {"enabled": False, "percent": 50},
                "presale": {
                    "enabled": True,
                    "percent": 20,
                    "ends_at": (datetime.now(timezone.utc) + timedelta(days=10)).isoformat(),
                },
            },
            "access_params": {
                "visibility": "public",
                "access_type": "open",
                "max_per_purchase": 5,
                "refund_window_hours": 24,
                "show_buyer_name_on_ticket": True,
            },
        }
        r = demo_client.put(f"{API}/events/me/{eid}", json=body)
        assert r.status_code == 200, f"update failed: {r.text}"
        upd = r.json()
        assert upd["payment_methods"]["transfer"]["enabled"] is True
        assert upd["payment_methods"]["transfer"]["bank_name"] == "Pichincha"
        assert upd["discounts"]["presale"]["enabled"] is True
        assert upd["discounts"]["presale"]["percent"] == 20
        assert upd["access_params"]["max_per_purchase"] == 5

        # GET to verify persistence
        g = demo_client.get(f"{API}/events/me/{eid}")
        assert g.status_code == 200
        gd = g.json()
        assert gd["payment_methods"]["transfer"]["bank_name"] == "Pichincha"
        assert gd["discounts"]["presale"]["percent"] == 20
        assert gd["access_params"]["max_per_purchase"] == 5

    def test_gallery_upload_delete_reorder(self, demo_client, created_event):
        eid = created_event["id"]
        # remove Content-Type for multipart
        s = requests.Session()
        s.headers.update({"Authorization": demo_client.headers["Authorization"]})

        # upload 3 png images
        urls = []
        for i in range(3):
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
            files = {"file": (f"g{i}.png", io.BytesIO(png), "image/png")}
            r = s.post(f"{API}/events/me/{eid}/gallery", files=files)
            assert r.status_code == 200, f"upload {i} failed: {r.status_code} {r.text}"
            data = r.json()
            assert len(data["gallery_urls"]) == i + 1
            urls = data["gallery_urls"]

        # reorder
        new_order = [2, 0, 1]
        r = demo_client.patch(f"{API}/events/me/{eid}/gallery/reorder", json={"order": new_order})
        assert r.status_code == 200, r.text
        reordered = r.json()["gallery_urls"]
        assert reordered == [urls[2], urls[0], urls[1]]

        # reorder invalid (out-of-range index)
        r = demo_client.patch(f"{API}/events/me/{eid}/gallery/reorder", json={"order": [0, 1, 5]})
        assert r.status_code == 422

        # reorder invalid (duplicates)
        r = demo_client.patch(f"{API}/events/me/{eid}/gallery/reorder", json={"order": [0, 0, 1]})
        assert r.status_code == 422

        # delete index 0
        r = demo_client.delete(f"{API}/events/me/{eid}/gallery/0")
        assert r.status_code == 200
        assert len(r.json()["gallery_urls"]) == 2

        # delete invalid index
        r = demo_client.delete(f"{API}/events/me/{eid}/gallery/99")
        assert r.status_code == 404

    def test_gallery_max_10(self, demo_client, created_event):
        eid = created_event["id"]
        s = requests.Session()
        s.headers.update({"Authorization": demo_client.headers["Authorization"]})
        # currently 2 from prev test → upload until limit
        for i in range(20):
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
            files = {"file": (f"f{i}.png", io.BytesIO(png), "image/png")}
            r = s.post(f"{API}/events/me/{eid}/gallery", files=files)
            if r.status_code == 422:
                # reached limit
                assert "10" in r.text or "Máximo" in r.text
                return
            assert r.status_code == 200
        pytest.fail("Gallery limit of 10 not enforced")


# ── 4. Seed event integrity ────────────────────────────────────────────────
class TestSeedEventsFase5:
    @pytest.mark.parametrize("slug", [
        "concierto-acustico-demo",
        "conferencia-marketing-digital",
        "charla-liderazgo-femenino",
    ])
    def test_seed_event_has_phase5_fields(self, demo_client, slug):
        # get via public route (since list_my_events returns paginated; easier through public)
        r = requests.get(f"{API}/public/events/demo-org/{slug}")
        assert r.status_code == 200, f"public event {slug} not found"
        ev = r.json()
        assert ev.get("gallery_urls") == []
        assert ev["payment_methods"]["stripe"]["enabled"] is True
        assert "discounts" in ev
        assert "access_params" in ev
        assert ev["visibility"] == "public"


# ── 5. Phase 4 regression — public order create (free) ────────────────────
class TestPhase4Regression:
    def test_create_free_order(self):
        body = {
            "tenant_slug": "demo-org",
            "event_slug": "charla-liderazgo-femenino",
            "quantity": 1,
            "buyer": {
                "name": "TEST F5 Regression",
                "email": "test_f5_regression@example.com",
            },
            "origin_url": "https://ticket-poc.preview.emergentagent.com/o/demo-org/e/charla-liderazgo-femenino",
        }
        r = requests.post(f"{API}/public/orders", json=body)
        assert r.status_code in (200, 201), f"order failed: {r.status_code} {r.text}"
        data = r.json()
        assert "order_number" in data
        # free → paid immediately
        # fetch order
        on = data["order_number"]
        r2 = requests.get(f"{API}/public/orders/{on}")
        assert r2.status_code == 200
        body = r2.json()
        order = body.get("order", body)
        assert order["status"] == "paid"
