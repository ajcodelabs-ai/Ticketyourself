"""Integration tests for multi-función (event functions) — TI-116.

Covers: deleting a función with no related orders (should succeed), and
deleting a función that still has a pending/unconfirmed order referencing it
(the DB's foreign key blocks the delete; the endpoint must surface a clean
409, not let the resulting IntegrityError leak out as a raw 500).
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime, timedelta, timezone

import requests
from conftest import API, bearer, new_session, register_organizer_payload


def _register_enterprise_organizer(admin_client):
    """Register + approve a fresh organizer, then bump it to the enterprise
    plan (required for multi_function_events) without touching demo-org,
    which other tests assert stays on the profesional plan."""
    payload = register_organizer_payload(
        email=f"fn_{uuid.uuid4().hex[:8]}@example.com",
        signup_plan_code="basico",
    )
    r = requests.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    org_id = body["organizer"]["id"]
    slug = body["organizer"]["slug"]
    token = body["access_token"]

    r = admin_client.post(
        f"{API}/admin/organizers/{org_id}/approve",
        json={"comment": "OK multi-función test"},
    )
    assert r.status_code == 200, r.text

    r = admin_client.patch(
        f"{API}/admin/organizers/{org_id}",
        json={"plan_code": "enterprise"},
    )
    assert r.status_code == 200, r.text

    r = admin_client.post(f"{API}/admin/organizers/{org_id}/mark-contract-signed")
    assert r.status_code == 200, r.text

    org_client = new_session()
    org_client.headers.update({"Authorization": f"Bearer {token}"})
    return org_id, slug, org_client


def _create_publishable_event(org_client):
    starts = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    ends = (datetime.now(timezone.utc) + timedelta(days=30, hours=2)).isoformat()
    r = org_client.post(
        f"{API}/events/me",
        json={
            "title": f"TI116 Multifunción {uuid.uuid4().hex[:6]}",
            "category": "music",
            "starts_at": starts,
            "ends_at": ends,
            "pricing_type": "paid",
            "base_price_cents": 1000,
            "venue_name": "Test Venue",
            "venue_city": "Quito",
            "venue_country": "Ecuador",
        },
    )
    assert r.status_code == 201, r.text
    event = r.json()

    png = b"\x89PNG\r\n\x1a\n" + b"0" * 200
    upload_session = requests.Session()
    upload_session.headers.update(
        {"Authorization": org_client.headers["Authorization"]}
    )
    r = upload_session.post(
        f"{API}/events/me/{event['id']}/poster",
        files={"file": ("poster.png", io.BytesIO(png), "image/png")},
    )
    assert r.status_code == 200, r.text

    r = org_client.put(
        f"{API}/events/me/{event['id']}",
        json={
            "payment_methods": {
                "enabled_codes": ["transfer"],
                "transfer": {
                    "enabled": True,
                    "bank_name": "Banco Test",
                    "account_number": "123",
                    "account_holder": "Test",
                    "instructions": "Transferí y subí el comprobante",
                },
            },
        },
    )
    assert r.status_code == 200, r.text
    return event


class TestDeleteEventFunction:
    def test_delete_function_with_no_orders_succeeds(self, admin_client):
        _, _, org_client = _register_enterprise_organizer(admin_client)
        event = _create_publishable_event(org_client)

        r = org_client.post(
            f"{API}/events/me/{event['id']}/functions",
            json={
                "name": "Función sin ventas",
                "kind": "function",
                "starts_at": event["starts_at"],
                "ends_at": event["ends_at"],
            },
        )
        assert r.status_code == 201, r.text
        function_id = r.json()["id"]

        r = org_client.delete(f"{API}/events/me/{event['id']}/functions/{function_id}")
        assert r.status_code == 204, r.text

        r = org_client.get(f"{API}/events/me/{event['id']}/functions")
        assert r.status_code == 200
        assert function_id not in {f["id"] for f in r.json()}

    def test_delete_function_with_pending_order_returns_409_not_500(self, admin_client):
        """TI-116 regression: a pending (unconfirmed manual-payment) order
        against a función has zero impact on `tickets_sold`, but the DB
        still won't let the row disappear out from under `ticket_orders`.
        Before the fix, that surfaced as an unhandled 500; it must be a
        clean, specific 409 instead."""
        _, slug, org_client = _register_enterprise_organizer(admin_client)
        event = _create_publishable_event(org_client)

        r = org_client.post(
            f"{API}/events/me/{event['id']}/functions",
            json={
                "name": "Función con pedido pendiente",
                "kind": "function",
                "starts_at": event["starts_at"],
                "ends_at": event["ends_at"],
            },
        )
        assert r.status_code == 201, r.text
        function_id = r.json()["id"]

        r = org_client.post(
            f"{API}/events/me/{event['id']}/ticket-types",
            json={"name": "General", "price_cents": 1000, "capacity": 50},
        )
        assert r.status_code == 201, r.text
        ticket_type_id = r.json()["id"]

        r = org_client.post(f"{API}/events/me/{event['id']}/publish")
        assert r.status_code == 200, r.text
        event_slug = event["slug"]

        buyer_email = f"fnbuyer_{uuid.uuid4().hex[:8]}@example.com"
        buyer_session = new_session()
        r = buyer_session.post(
            f"{API}/auth/register-buyer",
            json={
                "name": "Function Buyer",
                "email": buyer_email,
                "password": "Buyer123!",
                "tenant_slug": slug,
            },
        )
        assert r.status_code == 200, r.text
        buyer_session.headers.update(bearer(r.json()["access_token"]))

        r = buyer_session.post(
            f"{API}/public/orders",
            json={
                "tenant_slug": slug,
                "event_slug": event_slug,
                "buyer": {"name": "Function Buyer", "email": buyer_email},
                "payment_method": "transfer",
                "function_id": function_id,
                "ticket_type_selections": [
                    {"ticket_type_id": ticket_type_id, "quantity": 1}
                ],
            },
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "pending_manual_payment"

        # tickets_sold still reads 0 — the pre-existing check alone would
        # have let this delete proceed straight into the FK violation.
        r = org_client.get(f"{API}/events/me/{event['id']}/functions")
        fn = next(f for f in r.json() if f["id"] == function_id)
        assert fn["tickets_sold"] == 0

        r = org_client.delete(f"{API}/events/me/{event['id']}/functions/{function_id}")
        assert r.status_code == 409, r.text
        assert "pedidos" in r.json()["detail"]
