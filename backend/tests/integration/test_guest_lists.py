"""Integration tests for guest list endpoints (Fase 9).

Covers: create/list/delete guest list entries, public check-access,
RBAC (organizer isolation), and edge cases.

Note: guest list endpoints not yet deployed — all tests skipped.
"""

from __future__ import annotations

import uuid

import pytest
import requests

pytestmark = pytest.mark.skip(reason="guest list API not deployed")

from conftest import (
    API,
    BASE_URL,
    DEMO_TENANT,
    PAID_EVENT_SLUG,
    bearer,
    new_session,
    unique_buyer,
)

# ── Session-scoped fixtures ─────────────────────────────────────────────────


@pytest.fixture(scope="session")
def demo_event_id(demo_token):
    """Fetch the paid event ID from demo organizer's event list."""
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.get(f"{API}/events/me")
    assert r.status_code == 200, r.text
    data = r.json()
    events = data.get("items") if isinstance(data, dict) else data
    for ev in events:
        if ev["slug"] == PAID_EVENT_SLUG:
            return ev["id"]
    pytest.fail(f"Seed event '{PAID_EVENT_SLUG}' not found in organizer's list")


@pytest.fixture(scope="session", autouse=True)
def _cleanup_guest_list(demo_token, demo_event_id):
    """Remove all guest list entries after the test session."""
    yield
    s = new_session()
    s.headers.update(bearer(demo_token))
    r = s.get(f"{API}/events/me/{demo_event_id}/guest-list?limit=500")
    if r.status_code == 200:
        for entry in r.json().get("items", []):
            s.delete(f"{API}/events/me/{demo_event_id}/guest-list/{entry['id']}")


# ═══════════════════════════════════════════════════════════════════════════════
# 1. Create guest list entry
# 2. List guest list entries
# 3. Delete guest list entry
# ═══════════════════════════════════════════════════════════════════════════════


class TestGuestListCRUD:
    """Create, list, and delete guest list entries."""

    def test_create_guest_list_entry(self, demo_client, demo_event_id):
        buyer = unique_buyer("create")
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": buyer["email"], "name": buyer["name"]},
        )
        assert r.status_code == 201
        data = r.json()
        assert data["email"] == buyer["email"].lower()
        assert data["name"] == buyer["name"]
        assert "id" in data
        assert data["event_id"] == demo_event_id

    def test_create_with_cedula(self, demo_client, demo_event_id):
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"cedula": "1712345678", "name": "Cédula Test"},
        )
        assert r.status_code == 201
        assert r.json()["cedula"] == "1712345678"

    def test_list_entries(self, demo_client, demo_event_id):
        r = demo_client.get(f"{API}/events/me/{demo_event_id}/guest-list")
        assert r.status_code == 200
        data = r.json()
        assert "items" in data
        assert "total" in data
        assert "page" in data
        assert "limit" in data
        assert data["page"] == 1
        assert data["limit"] == 50
        assert data["total"] >= 0

    def test_list_pagination(self, demo_client, demo_event_id):
        # Seed at least 3 entries
        for i in range(3):
            b = unique_buyer(f"pag{i}")
            demo_client.post(
                f"{API}/events/me/{demo_event_id}/guest-list",
                json={"email": b["email"]},
            )

        r = demo_client.get(
            f"{API}/events/me/{demo_event_id}/guest-list?page=1&limit=2"
        )
        assert r.status_code == 200
        data = r.json()
        assert len(data["items"]) == 2
        assert data["total"] >= 3

    def test_delete_entry(self, demo_client, demo_event_id):
        buyer = unique_buyer("del")
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": buyer["email"]},
        )
        entry_id = r.json()["id"]

        r = demo_client.delete(f"{API}/events/me/{demo_event_id}/guest-list/{entry_id}")
        assert r.status_code == 204

        # Confirm it is gone from the list
        r = demo_client.get(f"{API}/events/me/{demo_event_id}/guest-list")
        ids = [e["id"] for e in r.json()["items"]]
        assert entry_id not in ids


# ═══════════════════════════════════════════════════════════════════════════════
# 4. Check access (public)
# 5. Access code validation
# ═══════════════════════════════════════════════════════════════════════════════


class TestCheckAccess:
    """Public check-access endpoint.

    Note: seed events use ``access_type: "open"``, so ``check_purchase_access``
    always returns ``None`` (→ ``{"ok": True}``).  These tests verify the HTTP
    contract and response shape.  Gating behavior (verified_list / access_code)
    requires an event with the matching ``access_params.access_type`` in the
    seed data.
    """

    EVENT_SLUG = PAID_EVENT_SLUG

    def test_check_access_with_email(self):
        s = new_session()
        r = s.post(
            f"{API}/public/events/{DEMO_TENANT}/{self.EVENT_SLUG}/check-access",
            json={"email": "someone@example.com"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_check_access_with_cedula(self):
        s = new_session()
        r = s.post(
            f"{API}/public/events/{DEMO_TENANT}/{self.EVENT_SLUG}/check-access",
            json={"cedula": "1712345678"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_check_access_with_access_code(self):
        """Access code on an open event should still pass."""
        s = new_session()
        r = s.post(
            f"{API}/public/events/{DEMO_TENANT}/{self.EVENT_SLUG}/check-access",
            json={"access_code": "FAKE1234"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_check_access_no_credentials(self):
        """Even empty body passes because event is open."""
        s = new_session()
        r = s.post(
            f"{API}/public/events/{DEMO_TENANT}/{self.EVENT_SLUG}/check-access",
            json={},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_check_access_nonexistent_tenant(self):
        s = new_session()
        r = s.post(
            f"{API}/public/events/no-such-org/{self.EVENT_SLUG}/check-access",
            json={"email": "x@y.com"},
        )
        assert r.status_code == 404

    def test_check_access_nonexistent_event(self):
        s = new_session()
        r = s.post(
            f"{API}/public/events/{DEMO_TENANT}/no-such-event/check-access",
            json={"email": "x@y.com"},
        )
        assert r.status_code == 404

    # ── Gated access (requires seed data with non‑open access_type) ──────────

    @pytest.mark.skipif(
        True,
        reason="Requires seed event with access_params.access_type='verified_list'",
    )
    def test_check_access_gated_verified_list(self):
        """Buyer must be on the guest list when access_type=verified_list."""
        ...

    @pytest.mark.skipif(
        True,
        reason="Requires seed event with access_params.access_type='access_code'",
    )
    def test_check_access_gated_invalid_code(self):
        """Invalid access code returns ok=False with reason."""
        ...


# ═══════════════════════════════════════════════════════════════════════════════
# 6. RBAC — other organizer cannot access guest list for another's event
# ═══════════════════════════════════════════════════════════════════════════════


class TestRBAC:
    """Organizer isolation: only the owning organizer can manage guest lists."""

    def test_other_organizer_cannot_create(self, prueba_client, demo_event_id):
        """prueba (pending) tries to create on demo's event → 404."""
        r = prueba_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": "test@example.com"},
        )
        assert r.status_code == 404
        assert "Event not found" in r.text or "evento" in r.text.lower()

    def test_other_organizer_cannot_list(self, prueba_client, demo_event_id):
        r = prueba_client.get(f"{API}/events/me/{demo_event_id}/guest-list")
        assert r.status_code == 404

    def test_other_organizer_cannot_delete(self, prueba_client, demo_event_id):
        r = prueba_client.delete(
            f"{API}/events/me/{demo_event_id}/guest-list/{uuid.uuid4().hex}"
        )
        assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════════════════
# 7. Edge cases
# ═══════════════════════════════════════════════════════════════════════════════


class TestEdgeCases:
    """Boundary conditions and error handling."""

    def test_duplicate_entry_allowed(self, demo_client, demo_event_id):
        """No unique constraint on (event_id, email); duplicate creates a new row."""
        email = "dupe-test@example.com"
        r1 = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": email},
        )
        assert r1.status_code == 201
        r2 = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": email},
        )
        assert r2.status_code == 201
        assert r1.json()["id"] != r2.json()["id"]

    def test_invalid_email_format(self, demo_client, demo_event_id):
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"email": "not-an-email"},
        )
        assert r.status_code == 422

    def test_missing_email_and_cedula(self, demo_client, demo_event_id):
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={"name": "No identifier"},
        )
        assert r.status_code == 422

    def test_nonexistent_event(self, demo_client):
        fake_id = uuid.uuid4().hex
        r = demo_client.post(
            f"{API}/events/me/{fake_id}/guest-list",
            json={"email": "nobody@example.com"},
        )
        assert r.status_code == 404

    def test_delete_nonexistent_entry(self, demo_client, demo_event_id):
        r = demo_client.delete(
            f"{API}/events/me/{demo_event_id}/guest-list/{uuid.uuid4().hex}"
        )
        assert r.status_code == 404

    def test_create_with_all_optional_fields(self, demo_client, demo_event_id):
        r = demo_client.post(
            f"{API}/events/me/{demo_event_id}/guest-list",
            json={
                "email": "full-fields@example.com",
                "cedula": "0999999999",
                "name": "Full Name",
                "notes": "VIP guest",
            },
        )
        assert r.status_code == 201
        data = r.json()
        assert data["email"] == "full-fields@example.com"
        assert data["cedula"] == "0999999999"
        assert data["name"] == "Full Name"
        assert data["notes"] == "VIP guest"
