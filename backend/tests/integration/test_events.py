"""
Event-related integration tests for Ticketyourself.

Migrated from test_phase4.py, test_phase5.py, and test_phase5_5_extra.py.

Covers: organizer events list, stats, orders, tickets, CSV export,
dashboard, plan features, event create/update with payment_methods/discounts/access_params,
gallery CRUD, seed event integrity, Phase 4 regression, and admin events enriched.
"""

from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
import requests
from conftest import (
    API,
    BASE_URL,
    DEMO_TENANT,
    FREE_EVENT_SLUG,
    PAID_EVENT_SLUG,
    bearer,
    new_session,
    place_order,
)


@pytest.fixture(scope="session")
def demo_event_ids(demo_token):
    """Map slug -> event id from organizer's events list."""
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.get(f"{API}/events/me")
    assert r.status_code == 200, r.text
    data = r.json()
    events = data.get("items") if isinstance(data, dict) else data
    out = {ev["slug"]: ev["id"] for ev in events}
    assert (
        FREE_EVENT_SLUG in out and PAID_EVENT_SLUG in out
    ), f"missing seed events: {list(out)}"
    return out


@pytest.fixture(scope="session")
def demo_event_id(demo_event_ids):
    """Return the paid event ID for convenience."""
    return demo_event_ids[PAID_EVENT_SLUG]


# ── 1. Organizer endpoints ────────────────────────────────────────────────────
class TestOrganizerEndpoints:
    def test_stats_returns_expected_shape(self, demo_token, demo_event_ids):
        s = new_session()
        s.headers.update(bearer(demo_token))
        ev_id = demo_event_ids[PAID_EVENT_SLUG]
        r = s.get(f"{API}/events/me/{ev_id}/stats")
        assert r.status_code == 200
        d = r.json()
        for k in (
            "total_orders",
            "paid_orders",
            "revenue_cents",
            "capacity",
            "tickets_issued",
            "conversion_rate",
            "sold",
            "available",
        ):
            assert k in d, f"missing {k}: {d}"

    def test_list_orders_paginates(self, demo_token, demo_event_ids):
        s = new_session()
        s.headers.update(bearer(demo_token))
        ev_id = demo_event_ids[PAID_EVENT_SLUG]
        r = s.get(f"{API}/events/me/{ev_id}/orders?page=1&limit=5")
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d
        assert len(d["items"]) <= 5

    def test_list_tickets(self, demo_token, demo_event_ids):
        s = new_session()
        s.headers.update(bearer(demo_token))
        ev_id = demo_event_ids[FREE_EVENT_SLUG]
        r = s.get(f"{API}/events/me/{ev_id}/tickets")
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total" in d

    def test_tickets_csv_export(self, demo_token, demo_event_ids):
        s = new_session()
        s.headers.update(bearer(demo_token))
        ev_id = demo_event_ids[FREE_EVENT_SLUG]
        r = s.get(f"{API}/events/me/{ev_id}/tickets.csv")
        assert r.status_code == 200
        assert "csv" in r.headers["content-type"]
        assert "ticket_id" in r.text


# ── 2. Dashboard ──────────────────────────────────────────────────────────────
class TestDashboard:
    def test_dashboard_me_payload(self, demo_client):
        r = demo_client.get(f"{API}/dashboard/me")
        assert r.status_code == 200
        data = r.json()
        for k in (
            "organizer",
            "plan",
            "stats",
            "upcoming_events",
            "microsite",
            "funnel",
            "features",
        ):
            assert k in data, f"missing {k}"
        assert data["organizer"]["slug"] == "demo-org"
        assert data["organizer"]["status"] == "approved"
        assert data["plan"]["code"] == "profesional"
        for k in (
            "revenue_cents",
            "tickets_sold_month",
            "published_events",
            "draft_events",
        ):
            assert k in data["stats"]
        assert isinstance(data["upcoming_events"], list)
        assert len(data["upcoming_events"]) <= 5
        assert data["features"]["numbered_seating"] is True
        assert data["features"]["max_events"] == -1


# ── 3. Plan features ──────────────────────────────────────────────────────────
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
        unlocks = f.get("_unlocks") or {}
        assert unlocks["numbered_seating"]["code"] == "profesional"
        assert unlocks["verified_lists"]["code"] == "enterprise"
        assert "Enterprise" in unlocks["verified_lists"]["name"]


# ── 4. Event create/update + gallery ──────────────────────────────────────────
@pytest.fixture(scope="module")
def created_event(demo_token):
    s = new_session()
    s.headers.update(bearer(demo_token))
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
    r = s.post(f"{API}/events/me", json=payload)
    assert r.status_code == 201, f"create event failed: {r.text}"
    return r.json()


class TestPaymentMethodCatalog:
    def test_list_catalog(self):
        r = new_session().get(f"{API}/payment-methods")
        assert r.status_code == 200, r.text
        codes = {m["code"] for m in r.json()}
        assert codes == {"nuvei", "deuna", "stripe", "paypal", "transfer", "cash"}

    def test_reject_unknown_enabled_code(self, demo_token, created_event):
        s = new_session()
        s.headers.update(bearer(demo_token))
        r = s.put(
            f"{API}/events/me/{created_event['id']}",
            json={"payment_methods": {"enabled_codes": ["bitcoin"]}},
        )
        assert r.status_code == 422, r.text


class TestEventFase5Fields:
    def test_create_applies_default_fields(self, created_event):
        for k in ("gallery_urls", "payment_methods", "discounts", "access_params"):
            assert k in created_event, f"missing {k}"
        assert created_event["gallery_urls"] == []
        pm = created_event["payment_methods"]
        assert pm.get("enabled_codes") == ["nuvei"]
        assert pm["transfer"]["enabled"] is False
        assert pm["cash"]["enabled"] is False
        assert created_event["discounts"]["disability_law"]["enabled"] is False
        assert created_event["discounts"]["presale"]["enabled"] is False
        assert created_event["visibility"] == "public"
        assert created_event["access_params"]["access_type"] == "open"
        assert created_event["access_params"]["max_per_purchase"] == 10

    def test_update_payment_discounts_access(self, demo_token, created_event):
        s = new_session()
        s.headers.update(bearer(demo_token))
        eid = created_event["id"]
        body = {
            "payment_methods": {
                "enabled_codes": ["nuvei", "transfer"],
                "transfer": {
                    "enabled": True,
                    "bank_name": "Pichincha",
                    "account_number": "1234567890",
                    "account_holder": "Demo Org",
                    "instructions": "Enviar comprobante",
                },
                "cash": {
                    "enabled": False,
                    "location": "",
                    "schedule": "",
                    "contact": "",
                },
            },
            "discounts": {
                "disability_law": {"enabled": False, "percent": 50},
                "presale": {
                    "enabled": True,
                    "percent": 20,
                    "ends_at": (
                        datetime.now(timezone.utc) + timedelta(days=10)
                    ).isoformat(),
                },
            },
            "access_params": {
                "visibility": "public",
                "access_type": "open",
                "max_per_purchase": 5,
                "show_buyer_name_on_ticket": True,
            },
        }
        r = s.put(f"{API}/events/me/{eid}", json=body)
        assert r.status_code == 200, f"update failed: {r.text}"
        upd = r.json()
        assert "transfer" in upd["payment_methods"]["enabled_codes"]
        assert upd["payment_methods"]["transfer"]["enabled"] is True
        assert upd["payment_methods"]["transfer"]["bank_name"] == "Pichincha"
        assert upd["discounts"]["presale"]["enabled"] is True
        assert upd["discounts"]["presale"]["percent"] == 20
        assert upd["access_params"]["max_per_purchase"] == 5

        g = s.get(f"{API}/events/me/{eid}")
        assert g.status_code == 200
        gd = g.json()
        assert gd["payment_methods"]["transfer"]["bank_name"] == "Pichincha"
        assert gd["discounts"]["presale"]["percent"] == 20
        assert gd["access_params"]["max_per_purchase"] == 5

    def test_gallery_upload_delete_reorder(
        self, demo_client, demo_token, created_event
    ):
        eid = created_event["id"]
        upload_s = requests.Session()
        upload_s.headers.update({"Authorization": f"Bearer {demo_token}"})

        urls = []
        for i in range(3):
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
            files = {"file": (f"g{i}.png", io.BytesIO(png), "image/png")}
            r = upload_s.post(f"{API}/events/me/{eid}/gallery", files=files)
            assert r.status_code == 200, f"upload {i} failed: {r.status_code} {r.text}"
            data = r.json()
            assert len(data["gallery_urls"]) == i + 1
            urls = data["gallery_urls"]

        new_order = [2, 0, 1]
        r = demo_client.patch(
            f"{API}/events/me/{eid}/gallery/reorder", json={"order": new_order}
        )
        assert r.status_code == 200, r.text
        reordered = r.json()["gallery_urls"]
        assert reordered == [urls[2], urls[0], urls[1]]

        r = demo_client.patch(
            f"{API}/events/me/{eid}/gallery/reorder", json={"order": [0, 1, 5]}
        )
        assert r.status_code == 422

        r = demo_client.patch(
            f"{API}/events/me/{eid}/gallery/reorder", json={"order": [0, 0, 1]}
        )
        assert r.status_code == 422

        r = demo_client.delete(f"{API}/events/me/{eid}/gallery/0")
        assert r.status_code == 200
        assert len(r.json()["gallery_urls"]) == 2

        r = demo_client.delete(f"{API}/events/me/{eid}/gallery/99")
        assert r.status_code == 404

    def test_gallery_max_10(self, demo_token, created_event):
        eid = created_event["id"]
        upload_s = requests.Session()
        upload_s.headers.update({"Authorization": f"Bearer {demo_token}"})

        for i in range(20):
            png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
            files = {"file": (f"f{i}.png", io.BytesIO(png), "image/png")}
            r = upload_s.post(f"{API}/events/me/{eid}/gallery", files=files)
            if r.status_code == 422:
                assert "10" in r.text or "Máximo" in r.text
                return
            assert r.status_code == 200
        pytest.fail("Gallery limit of 10 not enforced")

    def test_ticket_design_background_upload(self, demo_token, created_event):
        """Background kind used to be ticket_main_background (22 chars > VARCHAR(20))."""
        eid = created_event["id"]
        upload_s = requests.Session()
        upload_s.headers.update({"Authorization": f"Bearer {demo_token}"})
        png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
        files = {"file": ("fondo.png", io.BytesIO(png), "image/png")}
        r = upload_s.post(
            f"{API}/events/me/{eid}/ticket-design/asset",
            params={"slot": "main", "role": "background"},
            files=files,
        )
        assert r.status_code == 200, r.text
        url = r.json().get("url")
        assert url and url.startswith("/api/events/assets/")


# ── 5. Seed event integrity ───────────────────────────────────────────────────
class TestSeedEventsFase5:
    @pytest.mark.parametrize(
        "slug",
        [
            PAID_EVENT_SLUG,
            FREE_EVENT_SLUG,
        ],
    )
    def test_seed_event_has_phase5_fields(self, slug):
        s = new_session()
        r = s.get(f"{API}/public/events/{DEMO_TENANT}/{slug}")
        assert r.status_code == 200, f"public event {slug} not found"
        ev = r.json()
        assert ev.get("gallery_urls") == []
        pm = ev["payment_methods"]
        codes = pm.get("enabled_codes")
        if codes is not None:
            assert len(codes) >= 1
        else:
            assert pm.get("stripe", {}).get("enabled") or pm.get("transfer", {}).get(
                "enabled"
            )
        assert "discounts" in ev
        assert "access_params" in ev
        assert ev["visibility"] == "public"


# ── 6. Phase 4 regression ─────────────────────────────────────────────────────
class TestPhase4Regression:
    def test_create_free_order(self):
        body = {
            "tenant_slug": DEMO_TENANT,
            "event_slug": FREE_EVENT_SLUG,
            "quantity": 1,
            "buyer": {
                "name": "TEST F5 Regression",
                "email": "test_f5_regression@example.com",
            },
            "origin_url": BASE_URL,
        }
        r = place_order(body)
        assert r.status_code in (200, 201), f"order failed: {r.status_code} {r.text}"
        data = r.json()
        assert "order_number" in data
        on = data["order_number"]
        r2 = new_session().get(f"{API}/public/orders/{on}")
        assert r2.status_code == 200
        body = r2.json()
        order = body.get("order", body)
        assert order["status"] == "paid"


# ── 7. Admin events enriched ──────────────────────────────────────────────────
class TestAdminEventsEnriched:
    def test_admin_events_enriched(self, admin_token):
        s = new_session()
        s.headers.update(bearer(admin_token))
        r = s.get(f"{API}/admin/events?limit=3")
        assert r.status_code == 200
        for e in r.json()["items"]:
            assert "organizer_company_name" in e
            assert "organizer_slug" in e
            assert "gmv_cents" in e
            assert "fees_cents" in e

    def test_admin_event_detail(self, admin_token, demo_event_id):
        s = new_session()
        s.headers.update(bearer(admin_token))
        r = s.get(f"{API}/admin/events/{demo_event_id}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == demo_event_id
        assert "organizer" in body and body["organizer"]["slug"]
        assert "sales" in body
        assert "ticket_types" in body
        assert "recent_orders" in body
        assert "venue_layout" not in body
        assert "venue_layout_summary" in body

    def test_admin_event_detail_rbac(self, demo_token, demo_event_id):
        s = new_session()
        s.headers.update(bearer(demo_token))
        r = s.get(f"{API}/admin/events/{demo_event_id}")
        assert r.status_code in (401, 403)

    def test_admin_suspend_hides_public_and_unsuspends(
        self, admin_token, demo_event_ids
    ):
        event_id = demo_event_ids[PAID_EVENT_SLUG]
        s = new_session()
        s.headers.update(bearer(admin_token))
        before = s.get(f"{API}/admin/events/{event_id}")
        assert before.status_code == 200
        prev = before.json()["status"]
        if prev == "cancelled":
            pytest.skip("seed event is cancelled")
        did = False
        try:
            r = s.post(
                f"{API}/admin/events/{event_id}/suspend",
                json={"comment": "Prueba de suspensión del super admin"},
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "suspended"
            did = True
            detail = s.get(f"{API}/admin/events/{event_id}").json()
            assert detail["status"] == "suspended"
            assert detail["suspended_reason"]
            pub = requests.get(
                f"{API}/public/events/{DEMO_TENANT}/{PAID_EVENT_SLUG}", timeout=10
            )
            assert pub.status_code == 404
            again = s.post(
                f"{API}/admin/events/{event_id}/suspend",
                json={"comment": "ya estaba"},
            )
            assert again.status_code == 409
        finally:
            if did:
                restored = s.post(f"{API}/admin/events/{event_id}/unsuspend")
                assert restored.status_code == 200, restored.text
                assert restored.json()["status"] == prev

    def test_organizer_cannot_appeal_if_not_suspended(self, demo_token, demo_event_id):
        s = new_session()
        s.headers.update(bearer(demo_token))
        r = s.post(
            f"{API}/events/me/{demo_event_id}/suspension-appeal",
            files={
                "message": (None, "Esto no debería pasar porque no está suspendido.")
            },
            headers={"Content-Type": None},
        )
        assert r.status_code == 409

    def test_suspension_appeal_flow(self, admin_token, demo_token, demo_event_ids):
        event_id = demo_event_ids[PAID_EVENT_SLUG]
        admin = new_session()
        admin.headers.update(bearer(admin_token))
        org = new_session()
        org.headers.update(bearer(demo_token))
        before = admin.get(f"{API}/admin/events/{event_id}")
        assert before.status_code == 200
        prev = before.json()["status"]
        if prev in ("cancelled", "suspended"):
            pytest.skip("seed event not in a suspendable state")
        did = False
        try:
            r = admin.post(
                f"{API}/admin/events/{event_id}/suspend",
                json={"comment": "Precios incorrectos en localidades"},
            )
            assert r.status_code == 200, r.text
            did = True
            appeal = org.post(
                f"{API}/events/me/{event_id}/suspension-appeal",
                files={
                    "message": (
                        None,
                        "Corregí el precio de VIP a 25.00 y adjunto la autorización.",
                    )
                },
                headers={"Content-Type": None},
            )
            assert appeal.status_code == 200, appeal.text
            assert appeal.json()["suspension_appeal"]["status"] == "pending"
            detail = admin.get(f"{API}/admin/events/{event_id}").json()
            assert detail["suspension_appeal"]["status"] == "pending"
            rej = admin.post(
                f"{API}/admin/events/{event_id}/suspension-appeal/reject",
                json={"comment": "Falta el permiso municipal"},
            )
            assert rej.status_code == 200, rej.text
            again = org.post(
                f"{API}/events/me/{event_id}/suspension-appeal",
                files={
                    "message": (
                        None,
                        "Adjunto el permiso municipal actualizado y ya corregí el precio.",
                    )
                },
                headers={"Content-Type": None},
            )
            assert again.status_code == 200, again.text
            acc = admin.post(
                f"{API}/admin/events/{event_id}/suspension-appeal/accept",
                json={"comment": "OK, reactivamos"},
            )
            assert acc.status_code == 200, acc.text
            did = False
            assert acc.json()["status"] == prev
            pub = requests.get(
                f"{API}/public/events/{DEMO_TENANT}/{PAID_EVENT_SLUG}", timeout=10
            )
            if prev == "published":
                assert pub.status_code == 200
        finally:
            if did:
                admin.post(f"{API}/admin/events/{event_id}/unsuspend")
