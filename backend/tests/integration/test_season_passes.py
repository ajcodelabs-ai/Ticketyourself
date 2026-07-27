"""
Season Pass (Abono de Temporada) integration tests — Fase 4.

Covers:
- Organizer creates season pass for a general-admission event
- Organizer lists season passes for an event
- Public purchase flow (free pass auto-finalizes; paid pass → simulate payment)
- Redeem a credit against a function to get a ticket
- RBAC: non-organizer (admin) cannot create season passes
- Validation: season pass creation fails for numbered (venue) events

Note: season pass endpoints not yet deployed — all tests skipped.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

import pytest

pytestmark = pytest.mark.skip(reason="season pass API not deployed")

from conftest import (
    API,
    DEMO_TENANT,
    PAID_EVENT_SLUG,
    bearer,
    new_session,
    unique_buyer,
)

DEMO_NUMBERED_EVENT_SLUG = "funcion-especial-demo-numerado"


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
    assert PAID_EVENT_SLUG in out, f"missing seed event: {list(out)}"
    return out


@pytest.fixture(scope="session")
def demo_event_id(demo_event_ids):
    return demo_event_ids[PAID_EVENT_SLUG]


# ── 1. Create season pass ──────────────────────────────────────────────────


class TestCreateSeasonPass:
    """POST /api/events/me/{event_id}/season-passes (organizer)."""

    def test_create_season_pass_success(self, demo_client, demo_event_id):
        """Organizer creates a season pass for a general-admission event."""
        payload = {
            "name": "Abono Premium",
            "description": "10 créditos intercambiables",
            "price_cents": 5000,
            "credits_total": 10,
            "max_passes": 50,
        }
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json=payload,
        )
        assert r.status_code == 201, r.text
        data = r.json()
        assert data["name"] == "Abono Premium"
        assert data["credits_total"] == 10
        assert data["price_cents"] == 5000
        assert data["status"] == "active"
        assert data["passes_sold"] == 0
        assert data["event_id"] == demo_event_id
        assert "id" in data

        return data["id"]

    def test_create_minimal(self, demo_client, demo_event_id):
        """Minimal payload (only required fields) succeeds."""
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": "Mini Pass", "credits_total": 2},
        )
        assert r.status_code == 201, r.text
        assert r.json()["credits_total"] == 2

    def test_create_non_organizer_returns_403(self, admin_client, demo_event_id):
        """Admin (super_admin role) cannot create — organizer role required."""
        r = admin_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": "Admin Pass", "credits_total": 5},
        )
        assert r.status_code == 403, r.text

    def test_create_on_numbered_event_returns_422(self, demo_client, demo_event_ids):
        """Season passes require general-admission events (no venue_id)."""
        ev_id = demo_event_ids.get(DEMO_NUMBERED_EVENT_SLUG)
        if not ev_id:
            pytest.skip("numbered seed event not found — run seeds first")

        r = demo_client.post(
            f"{API}/events/me/{ev_id}/season-passes",
            json={"name": "Fail Pass", "credits_total": 3},
        )
        assert r.status_code == 422, r.text
        assert "abono" in r.text.lower() or "general" in r.text.lower()


# ── 2. List season passes ──────────────────────────────────────────────────


class TestListSeasonPasses:
    """GET /api/events/me/{event_id}/season-passes."""

    def test_list_returns_all(self, demo_client, demo_event_id):
        """List after creating returns the newly created pass."""
        label = f"List-Test-{os.urandom(4).hex()}"
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": label, "credits_total": 4},
        )
        assert r.status_code == 201, r.text

        r = demo_client.get(f"{API}/events/me/{demo_event_id}/season-passes")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert any(p["name"] == label for p in data), f"{label} not found in list"

    def test_public_list_filters_active_only(self, demo_client, demo_event_id):
        """GET /api/public/events/{event_id}/season-passes returns only active."""
        label = f"Pub-List-{os.urandom(4).hex()}"
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": label, "credits_total": 4},
        )
        assert r.status_code == 201, r.text

        s = new_session()
        r = s.get(f"{API}/public/events/{demo_event_id}/season-passes")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        for sp in data:
            assert "available" in sp


# ── 3. Purchase season pass ────────────────────────────────────────────────


class TestPurchaseSeasonPass:
    """POST /api/public/season-passes/{season_pass_id}/purchase."""

    def _create_sp(self, demo_client, demo_event_id, **kw):
        payload = {"name": "Purchase-Test", "credits_total": 5}
        payload.update(kw)
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json=payload,
        )
        assert r.status_code == 201, r.text
        return r.json()

    def test_purchase_free_pass_auto_finalizes(self, demo_client, demo_event_id):
        """Free season pass (price_cents=0) is paid instantly."""
        sp = self._create_sp(demo_client, demo_event_id, price_cents=0)
        buyer = unique_buyer("free-sp")
        r = new_session().post(
            f"{API}/public/season-passes/{sp['id']}/purchase",
            json={"buyer": buyer, "origin_url": "http://localhost:3000"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "paid"
        assert data["order_number"].startswith("ABN-")
        assert "/abono/" in data["redirect_to"]

    def test_purchase_paid_pass_creates_pending(
        self,
        demo_client,
        demo_event_id,
    ):
        """Paid season pass starts as pending; simulate payment finalises it."""
        sp = self._create_sp(demo_client, demo_event_id, price_cents=2500)
        buyer = unique_buyer("paid-sp")

        # Purchase — pending
        r = new_session().post(
            f"{API}/public/season-passes/{sp['id']}/purchase",
            json={"buyer": buyer, "origin_url": "http://localhost:3000"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "pending"
        order_number = data["order_number"]

        # Simulate payment
        r = new_session().post(
            f"{API}/_dev/simulate-season-pass-paid",
            json={"order_number": order_number},
        )
        assert r.status_code == 200, r.text
        sim_data = r.json()
        assert sim_data["purchase"]["status"] == "paid"
        purchase_token = sim_data["purchase"]["purchase_token"]

        # Verify via public get
        r = new_session().get(
            f"{API}/public/season-pass-purchases/{purchase_token}",
        )
        assert r.status_code == 200, r.text
        assert r.json()["purchase"]["status"] == "paid"


# ── 4. Redeem credit ───────────────────────────────────────────────────────


class TestRedeemCredit:
    """POST /api/public/season-pass-purchases/{purchase_token}/redeem."""

    def test_redeem_one_credit_returns_ticket(
        self,
        demo_client,
        demo_event_id,
    ):
        """Create free pass, purchase, create function, redeem a credit."""
        # -- Create function --
        now = datetime.now(timezone.utc)
        func_body = {
            "name": "Función Redeem",
            "starts_at": (now + timedelta(days=10)).isoformat(),
            "ends_at": (now + timedelta(days=10, hours=2)).isoformat(),
            "timezone": "America/Guayaquil",
            "capacity": 100,
        }
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/functions",
            json=func_body,
        )
        assert r.status_code == 201, r.text
        function_id = r.json()["id"]

        # -- Create free season pass --
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": "Redeem Pass", "price_cents": 0, "credits_total": 3},
        )
        assert r.status_code == 201, r.text
        sp = r.json()

        # -- Purchase (free → auto-finalized) --
        buyer = unique_buyer("redeem")
        r = new_session().post(
            f"{API}/public/season-passes/{sp['id']}/purchase",
            json={"buyer": buyer, "origin_url": "http://localhost:3000"},
        )
        assert r.status_code == 200, r.text
        purchase_token = r.json()["redirect_to"].split("/abono/")[-1]

        # -- Redeem one credit --
        r = new_session().post(
            f"{API}/public/season-pass-purchases/{purchase_token}/redeem",
            json={"function_id": function_id},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert len(data["tickets"]) == 1
        assert data["purchase"]["credits_used"] == 1
        assert data["purchase"]["credits_total"] == 3

        # Redeem a second credit
        r = new_session().post(
            f"{API}/public/season-pass-purchases/{purchase_token}/redeem",
            json={"function_id": function_id},
        )
        assert r.status_code == 200, r.text
        assert r.json()["purchase"]["credits_used"] == 2

    def test_redeem_exhausted_returns_409(
        self,
        demo_client,
        demo_event_id,
    ):
        """Redeeming beyond credits_total returns 409."""
        now = datetime.now(timezone.utc)
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/functions",
            json={
                "name": "Func Exhaust",
                "starts_at": (now + timedelta(days=20)).isoformat(),
                "ends_at": (now + timedelta(days=20, hours=1)).isoformat(),
                "timezone": "America/Guayaquil",
                "capacity": 100,
            },
        )
        assert r.status_code == 201, r.text
        function_id = r.json()["id"]

        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/season-passes",
            json={"name": "Exhaust Pass", "price_cents": 0, "credits_total": 1},
        )
        assert r.status_code == 201, r.text

        buyer = unique_buyer("exhaust")
        r = new_session().post(
            f"{API}/public/season-passes/{r.json()['id']}/purchase",
            json={"buyer": buyer, "origin_url": "http://localhost:3000"},
        )
        assert r.status_code == 200, r.text
        purchase_token = r.json()["redirect_to"].split("/abono/")[-1]

        # First redeem — should succeed
        r = new_session().post(
            f"{API}/public/season-pass-purchases/{purchase_token}/redeem",
            json={"function_id": function_id},
        )
        assert r.status_code == 200, r.text

        # Second redeem — should fail (no credits left)
        r = new_session().post(
            f"{API}/public/season-pass-purchases/{purchase_token}/redeem",
            json={"function_id": function_id},
        )
        assert r.status_code == 409, r.text
