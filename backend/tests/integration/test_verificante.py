"""Integration tests for Verificante KYC on organizer registration."""

from __future__ import annotations

import uuid

import requests

from tests.conftest import API, register_organizer_payload

CEDULA = "1710034065"


class TestRegisterVerificante:
    def test_company_skips_verificante(self):
        payload = register_organizer_payload(
            email=f"vfco_{uuid.uuid4().hex[:8]}@example.com",
            org_type="company",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org = r.json()["organizer"]
        assert org["status"] == "pending"
        assert org.get("verificante") in (None, {})

    def test_individual_ec_stores_check_and_stays_pending(self):
        payload = register_organizer_payload(
            email=f"vfind_{uuid.uuid4().hex[:8]}@example.com",
            org_type="individual",
            legal_id=CEDULA,
            company_name="Ana Pérez",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org = r.json()["organizer"]
        assert org["status"] == "pending"
        vf = org.get("verificante")
        assert vf is not None
        assert vf.get("applicable") is True
        assert vf.get("status") in ("skipped", "completed", "pending", "failed")
        assert vf.get("identification") == CEDULA

    def test_colombia_individual_skips(self):
        payload = register_organizer_payload(
            email=f"vfco2_{uuid.uuid4().hex[:8]}@example.com",
            org_type="individual",
            country="Colombia",
            country_code="CO",
            legal_id="900123456",
        )
        payload.pop("uafe_declaration", None)
        payload.pop("org_references", None)
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["organizer"].get("verificante") in (None, {})


class TestVerificanteWebhook:
    def test_webhook_updates_risk_without_changing_status(self, admin_client):
        payload = register_organizer_payload(
            email=f"vfwh_{uuid.uuid4().hex[:8]}@example.com",
            org_type="individual",
            legal_id=CEDULA,
            company_name="Luis Mora",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org = r.json()["organizer"]
        organizer_id = org["id"]
        assert org["status"] == "pending"

        event = {
            "id": f"evt_{uuid.uuid4().hex[:8]}",
            "type": "verificationCompleted",
            "data": {
                "verificationId": "vf-int-1",
                "status": "completed",
                "riskLevel": "HIGH",
                "pdfUrl": "https://example.com/report.pdf",
                "verification": {
                    "id": "vf-int-1",
                    "person": {"names": "Luis Mora", "identification": CEDULA},
                    "metadata": {"candidateIdentifierExt": organizer_id},
                },
            },
        }
        wr = requests.post(f"{API}/verificante/webhook", json=event)
        assert wr.status_code == 200, wr.text
        body = wr.json()
        assert body.get("ok") is True
        assert body.get("organizer_id") == organizer_id
        assert str(body.get("risk_level") or "").upper() == "HIGH"

        got = admin_client.get(f"{API}/admin/organizers/{organizer_id}")
        assert got.status_code == 200, got.text
        fresh = got.json()
        assert fresh["status"] == "pending"
        assert fresh["verificante"]["risk_level"] == "HIGH"
        assert fresh["verificante"]["admitted"] is False
        assert fresh["verificante"]["status"] == "completed"

        approve = admin_client.post(
            f"{API}/admin/organizers/{organizer_id}/approve", json={}
        )
        assert approve.status_code == 200, approve.text
        assert approve.json()["status"] == "approved"
        assert approve.json()["verificante"]["risk_level"] == "HIGH"

    def test_webhook_invalid_json_rejected(self):
        # Live server: if no secret is configured, unsigned payloads are accepted.
        # This asserts the endpoint exists and returns JSON (not 404).
        r = requests.post(f"{API}/verificante/webhook", data=b"not-json")
        assert r.status_code in (400, 401)


class TestRefreshVerificante:
    def test_company_refresh_rejected(self, admin_client):
        payload = register_organizer_payload(
            email=f"vfref_{uuid.uuid4().hex[:8]}@example.com",
            org_type="company",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org_id = r.json()["organizer"]["id"]
        resp = admin_client.post(f"{API}/admin/organizers/{org_id}/refresh-verificante")
        assert resp.status_code == 400
