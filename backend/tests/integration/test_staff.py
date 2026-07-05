"""Integration tests for staff endpoints (Phase 8).

Covers: staff login, profile, assigned events, ticket validation,
RBAC (regular users blocked), and inactive staff rejection.

Depends on demo-org seed data. Staff members are created at test time
via the demo organizer client and cleaned up ephemerally.

Note: staff endpoints not yet deployed — all tests skipped.
"""

from __future__ import annotations

import uuid

import pytest
import requests

pytestmark = pytest.mark.skip(reason="staff API not deployed")

from conftest import API, BASE_URL, DEMO_PASSWORD, bearer, login

# ── Helpers ───────────────────────────────────────────────────────────────────

STAFF_PASSWORD = "StaffPass123!"


def _create_staff(
    session: requests.Session,
    email: str,
    roles: list | None = None,
    event_ids: list | None = None,
) -> dict:
    """Create a staff member via the demo organizer client. Returns the staff dict."""
    r = session.post(
        f"{API}/staff",
        json={
            "name": "Test Staff",
            "email": email,
            "password": STAFF_PASSWORD,
            "roles": roles or ["scanner"],
            "event_ids": event_ids or [],
        },
    )
    r.raise_for_status()
    return r.json()


def _delete_staff(session: requests.Session, staff_id: str) -> None:
    r = session.delete(f"{API}/staff/{staff_id}")
    assert r.status_code == 204


def _staff_login(email: str, password: str = STAFF_PASSWORD) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = s.post(f"{API}/auth/staff-login", json={"email": email, "password": password})
    r.raise_for_status()
    token = r.json()["access_token"]
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _demo_event_ids(demo_client: requests.Session) -> list[str]:
    """Fetch demo-org event IDs for staff assignment."""
    r = demo_client.get(f"{API}/events", params={"limit": 50})
    r.raise_for_status()
    return [e["id"] for e in r.json()]


# ── Tests ─────────────────────────────────────────────────────────────────────


class TestStaffLogin:
    def test_staff_login_and_profile(self, demo_client):
        """Create a staff member, login, and verify profile shape."""
        uid = uuid.uuid4().hex[:8]
        email = f"staff_login_{uid}@example.com"
        event_ids = _demo_event_ids(demo_client)
        staff = _create_staff(demo_client, email, event_ids=event_ids[:1])
        staff_id = staff["id"]

        try:
            s = _staff_login(email)
            r = s.get(f"{API}/staff/me")
            assert r.status_code == 200
            body = r.json()
            assert body["email"] == email
            assert body["roles"] == ["scanner"]
            assert body["active"] is True
            assert isinstance(body["event_ids"], list)
            assert body["event_ids"] == event_ids[:1]
            # password_hash must never leak
            assert "password_hash" not in body

            r = s.get(f"{API}/staff/me/events")
            assert r.status_code == 200
            events = r.json()
            assert isinstance(events, list)
            if events:
                assert events[0]["id"] in event_ids
        finally:
            _delete_staff(demo_client, staff_id)

    def test_staff_login_wrong_password(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_badpw_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        try:
            r = requests.post(
                f"{API}/auth/staff-login",
                json={"email": email, "password": "wrong"},
            )
            assert r.status_code == 401
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_staff_login_not_found(self):
        r = requests.post(
            f"{API}/auth/staff-login",
            json={"email": "nobody@example.com", "password": "x"},
        )
        assert r.status_code == 401


class TestStaffProfile:
    def test_staff_me_unauthorized_demo_user(self, demo_client):
        """Regular organizer (non-staff) gets 403 from /api/staff/me."""
        r = demo_client.get(f"{API}/staff/me")
        assert r.status_code == 403

    def test_staff_me_unauthorized_no_token(self):
        r = requests.get(f"{API}/staff/me")
        assert r.status_code == 401

    def test_staff_me_events_empty(self, demo_client):
        """Staff assigned to zero events gets an empty list."""
        uid = uuid.uuid4().hex[:8]
        email = f"staff_noevents_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        try:
            s = _staff_login(email)
            r = s.get(f"{API}/staff/me/events")
            assert r.status_code == 200
            assert r.json() == []
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_staff_events_multiple(self, demo_client):
        """Staff assigned to multiple events sees them all."""
        uid = uuid.uuid4().hex[:8]
        email = f"staff_multi_{uid}@example.com"
        event_ids = _demo_event_ids(demo_client)
        staff = _create_staff(demo_client, email, event_ids=event_ids)
        try:
            s = _staff_login(email)
            r = s.get(f"{API}/staff/me")
            assert r.status_code == 200
            assert set(r.json()["event_ids"]) == set(event_ids)

            r = s.get(f"{API}/staff/me/events")
            assert r.status_code == 200
            returned_ids = {e["id"] for e in r.json()}
            assert returned_ids == set(event_ids)
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_staff_roles_are_stored(self, demo_client):
        """Staff can have multiple roles (scanner, cajero, admin_evento)."""
        uid = uuid.uuid4().hex[:8]
        email = f"staff_roles_{uid}@example.com"
        roles = ["scanner", "cajero"]
        staff = _create_staff(demo_client, email, roles=roles)
        try:
            s = _staff_login(email)
            r = s.get(f"{API}/staff/me")
            assert r.status_code == 200
            assert set(r.json()["roles"]) == set(roles)
        finally:
            _delete_staff(demo_client, staff["id"])


class TestTicketValidation:
    def test_validate_invalid_qr_token(self, demo_client):
        """POST /api/tickets/validate with a bogus token returns valid=False."""
        r = demo_client.post(
            f"{API}/tickets/validate",
            json={"qr_token": "bogus-token-string"},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["valid"] is False

    @pytest.mark.skipif(
        True,
        reason="Requires a real paid ticket with a QR token — create via full checkout flow",
    )
    def test_validate_valid_ticket(self): ...


class TestInactiveStaff:
    def test_inactive_staff_cannot_login(self, demo_client):
        """Deactivated staff members are rejected at login with 403."""
        uid = uuid.uuid4().hex[:8]
        email = f"staff_inactive_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        staff_id = staff["id"]

        try:
            # Deactivate
            r = demo_client.put(
                f"{API}/staff/{staff_id}",
                json={"active": False},
            )
            assert r.status_code == 200
            assert r.json()["active"] is False

            r = requests.post(
                f"{API}/auth/staff-login",
                json={"email": email, "password": STAFF_PASSWORD},
            )
            assert r.status_code == 403
            assert "desactivada" in r.text.lower()

            # Reactivate so cleanup can delete (FK cascade)
            demo_client.put(
                f"{API}/staff/{staff_id}",
                json={"active": True},
            )
        finally:
            _delete_staff(demo_client, staff_id)


class TestStaffCRUD:
    def test_create_staff_duplicate_email_409(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_dup_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        try:
            r = demo_client.post(
                f"{API}/staff",
                json={
                    "name": "Dup",
                    "email": email,
                    "password": STAFF_PASSWORD,
                    "roles": ["scanner"],
                },
            )
            assert r.status_code == 409
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_list_staff(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_list_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        try:
            r = demo_client.get(f"{API}/staff")
            assert r.status_code == 200
            emails = [s["email"] for s in r.json()]
            assert email in emails
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_get_staff_detail(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_detail_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        try:
            r = demo_client.get(f"{API}/staff/{staff['id']}")
            assert r.status_code == 200
            assert r.json()["email"] == email
        finally:
            _delete_staff(demo_client, staff["id"])

    def test_update_staff(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_upd_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        staff_id = staff["id"]
        try:
            r = demo_client.put(
                f"{API}/staff/{staff_id}",
                json={"name": "Updated Name", "roles": ["cajero"]},
            )
            assert r.status_code == 200
            assert r.json()["name"] == "Updated Name"
            assert r.json()["roles"] == ["cajero"]
        finally:
            _delete_staff(demo_client, staff_id)

    def test_delete_staff(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        email = f"staff_del_{uid}@example.com"
        staff = _create_staff(demo_client, email)
        staff_id = staff["id"]
        r = demo_client.delete(f"{API}/staff/{staff_id}")
        assert r.status_code == 204
        r = demo_client.get(f"{API}/staff/{staff_id}")
        assert r.status_code == 404

    def test_organizer_cannot_create_invalid_role(self, demo_client):
        uid = uuid.uuid4().hex[:8]
        r = demo_client.post(
            f"{API}/staff",
            json={
                "name": "Bad",
                "email": f"staff_badrole_{uid}@example.com",
                "password": STAFF_PASSWORD,
                "roles": ["hacker"],
            },
        )
        assert r.status_code in (422, 400)

    def test_regular_user_cannot_access_staff_api(self, admin_client):
        """Super admin (non-organizer) gets 403 from staff CRUD."""
        r = admin_client.get(f"{API}/staff")
        assert r.status_code == 403

        r = admin_client.post(
            f"{API}/staff",
            json={
                "name": "X",
                "email": "x@example.com",
                "password": "x",
                "roles": ["scanner"],
            },
        )
        assert r.status_code == 403
