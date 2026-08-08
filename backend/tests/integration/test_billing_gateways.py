"""Plan payment methods: Stripe + Nuvei/DeUna gateway intents."""

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
        assert data["checkout_url"] is None
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

    def test_admin_confirms_deuna_payment(self, admin_client):
        org_id, org_client, _ = _register_and_approve(admin_client)
        r = org_client.post(
            f"{API}/billing/checkout-session",
            json={
                "plan_code": "profesional",
                "origin_url": "http://localhost:3000",
                "payment_method": "deuna",
            },
        )
        assert r.status_code == 200, r.text
        intent_id = r.json()["intent_id"]

        r = admin_client.post(
            f"{API}/admin/organizers/{org_id}/confirm-plan-payment",
            json={"intent_id": intent_id, "comment": "DeUna OK"},
        )
        assert r.status_code == 200, r.text
        org = r.json()
        assert org["plan_code"] == "profesional"
        assert org["subscription_status"] == "active"

        r = org_client.get(f"{API}/billing/me/pending-intent")
        assert r.status_code == 200
        assert r.json() is None

    def test_stripe_still_default(self, admin_client):
        """Without payment_method, request defaults to stripe (may 502 if Stripe down)."""
        _, org_client, _ = _register_and_approve(admin_client)
        r = org_client.post(
            f"{API}/billing/checkout-session",
            json={
                "plan_code": "basico",
                "origin_url": "http://localhost:3000",
            },
        )
        # Stripe may succeed (redirect) or 502 in local without keys — both ok for default path
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            data = r.json()
            assert data.get("payment_method", "stripe") == "stripe"
            assert data["status"] == "redirect"
            assert data["checkout_url"]
