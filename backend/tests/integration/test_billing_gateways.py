"""Plan payment methods: Nuvei Checkout intents."""

from __future__ import annotations

import uuid

import requests

from tests.conftest import API, new_session, register_organizer_payload


def _register_and_approve(admin_client):
    payload = register_organizer_payload(
        email=f"bill_{uuid.uuid4().hex[:8]}@example.com",
        signup_plan_code="basico",
    )
    r = requests.post(f"{API}/auth/register", json=payload)
    assert r.status_code == 200, r.text
    body = r.json()
    org_id = body["organizer"]["id"]
    token = body["access_token"]

    r = admin_client.post(
        f"{API}/admin/organizers/{org_id}/approve",
        json={"comment": "OK billing test"},
    )
    assert r.status_code == 200, r.text

    org_client = new_session()
    org_client.headers.update({"Authorization": f"Bearer {token}"})
    return org_id, org_client, payload


class TestPlanGatewayPayments:
    def test_nuvei_creates_pending_gateway_intent(self, admin_client):
        org_id, org_client, _ = _register_and_approve(admin_client)
        r = org_client.post(
            f"{API}/billing/checkout-session",
            json={
                "plan_code": "basico",
                "origin_url": "http://localhost:3000",
                "payment_method": "nuvei",
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["payment_method"] == "nuvei"
        assert data["checkout_url"] is None or data.get("reference")
        assert data["intent_id"]
        # Without NUVEI_* credentials → manual pending_gateway; with creds → nuvei_checkout
        assert data["status"] in ("pending_gateway", "nuvei_checkout")
        if data["status"] == "pending_gateway":
            assert data["mode"] == "gateway"

        r = org_client.get(f"{API}/billing/me/pending-intent")
        assert r.status_code == 200
        pending = r.json()
        assert pending["payment_method"] == "nuvei"
        assert pending["status"] in ("pending_gateway", "pending")

        r = admin_client.get(f"{API}/admin/organizers/{org_id}/billing-intents")
        assert r.status_code == 200
        intents = r.json()
        assert any(i["payment_method"] == "nuvei" for i in intents)

    def test_rejects_retired_gateways(self, admin_client):
        _, org_client, _ = _register_and_approve(admin_client)
        r = org_client.post(
            f"{API}/billing/checkout-session",
            json={
                "plan_code": "profesional",
                "origin_url": "http://localhost:3000",
                "payment_method": "deuna",
            },
        )
        assert r.status_code == 422, r.text

    def test_nuvei_is_default(self, admin_client):
        """Without payment_method, request defaults to Nuvei."""
        _, org_client, _ = _register_and_approve(admin_client)
        r = org_client.post(
            f"{API}/billing/checkout-session",
            json={
                "plan_code": "basico",
                "origin_url": "http://localhost:3000",
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("payment_method") == "nuvei"
        assert data["status"] in ("pending_gateway", "nuvei_checkout")
