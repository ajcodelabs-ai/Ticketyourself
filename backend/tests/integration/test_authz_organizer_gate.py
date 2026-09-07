"""Buyers (and other non-organizer roles) must never reach organizer-panel
endpoints, even though their `organizer_id` legitimately points at the org
they registered/bought with. Regression tests for the authz bypass where
several routers checked only `organizer_id` presence, not `role`.
"""

from __future__ import annotations

import uuid

import pytest
from conftest import API, FREE_EVENT_SLUG, bearer, new_session, register_buyer_client


@pytest.fixture(scope="session")
def demo_event_id(demo_token):
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.get(f"{API}/events/me")
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    ev = next(e for e in events if e["slug"] == FREE_EVENT_SLUG)
    return ev["id"]


@pytest.fixture(scope="session")
def other_event_id(demo_token):
    """A second demo-org event, distinct from `demo_event_id`."""
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.get(f"{API}/events/me")
    assert r.status_code == 200, r.text
    events = r.json()["items"]
    ev = next(e for e in events if e["slug"] == "concierto-acustico-demo")
    return ev["id"]


class TestBuyerCannotReachOrganizerPanel:
    def test_dashboard_me_does_not_leak_organizer_data(self):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/dashboard/me")
        assert r.status_code == 200, r.text
        assert r.json() == {"organizer": None}

    def test_microsite_me_forbidden(self):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/microsite/me")
        assert r.status_code == 403

    def test_venues_me_forbidden(self):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/venues/me")
        assert r.status_code == 403

    def test_plan_features_does_not_leak_organizer_plan(self):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/plans/me/features")
        assert r.status_code == 200, r.text
        assert r.json().get("_plan_code") is None

    def test_sales_fees_quote_does_not_use_organizer_plan(self):
        s, _ = register_buyer_client()
        r = s.get(
            f"{API}/sales-fees/quote",
            params={"pricing_type": "paid", "price_cents": 1000},
        )
        assert r.status_code == 200, r.text
        assert r.json().get("plan_code") is None

    def test_event_orders_forbidden(self, demo_event_id):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/events/me/{demo_event_id}/orders")
        assert r.status_code == 403

    def test_event_tickets_forbidden(self, demo_event_id):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/events/me/{demo_event_id}/tickets")
        assert r.status_code == 403

    def test_scan_stats_not_found(self, demo_event_id):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/events/me/{demo_event_id}/scan-stats")
        assert r.status_code == 404

    def test_scan_log_not_found(self, demo_event_id):
        s, _ = register_buyer_client()
        r = s.get(f"{API}/events/me/{demo_event_id}/scan-log")
        assert r.status_code == 404

    def test_demo_activate_forbidden(self):
        s, buyer = register_buyer_client()
        me = s.get(f"{API}/auth/me").json()
        r = s.post(
            f"{API}/_dev/demo-activate",
            json={"organizer_id": me["user"]["organizer_id"]},
        )
        assert r.status_code in (403, 404)


class TestStaffCannotScanUnassignedEvent:
    """TI-144: an org_staff JWT only carries `organizer_id`, not the events
    the staff member was actually assigned to (StaffEventAssignment) — the
    scan endpoints must check per-event assignment, not just org ownership.
    """

    def test_scan_stats_blocked_for_unassigned_event(
        self, demo_token, demo_event_id, other_event_id
    ):
        s = new_session()
        s.headers.update(bearer(demo_token))
        uid = uuid.uuid4().hex[:8]
        email = f"staff_scope_{uid}@example.com"
        r = s.post(
            f"{API}/staff",
            json={
                "name": "Scope Test Staff",
                "email": email,
                "password": "StaffPass123!",
                "roles": ["scanner"],
                "event_ids": [demo_event_id],
            },
        )
        assert r.status_code in (200, 201), r.text
        staff_id = r.json()["id"]
        try:
            staff_s = new_session()
            r = staff_s.post(
                f"{API}/auth/staff-login",
                json={"email": email, "password": "StaffPass123!"},
            )
            assert r.status_code == 200, r.text
            staff_s.headers.update(bearer(r.json()["access_token"]))

            r = staff_s.get(f"{API}/events/me/{demo_event_id}/scan-stats")
            assert r.status_code == 200, r.text

            r = staff_s.get(f"{API}/events/me/{other_event_id}/scan-stats")
            assert r.status_code == 404, r.text
        finally:
            s.delete(f"{API}/staff/{staff_id}")
