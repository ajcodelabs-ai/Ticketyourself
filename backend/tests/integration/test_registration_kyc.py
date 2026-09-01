"""KYC / registration-by-country integration tests."""

from __future__ import annotations

import uuid

import requests

from tests.conftest import API, new_session, register_organizer_payload
from tests.conftest import login as login_user


class TestRegistrationCountriesPublic:
    def test_list_active_countries(self):
        r = requests.get(f"{API}/auth/registration-countries")
        assert r.status_code == 200, r.text
        codes = {c["code"] for c in r.json()}
        assert "EC" in codes
        ec = next(c for c in r.json() if c["code"] == "EC")
        assert ec["requires_compliance"] is True


class TestRegisterKYC:
    def test_register_ecuador_requires_compliance(self):
        payload = register_organizer_payload(
            email=f"nocomp_{uuid.uuid4().hex[:8]}@example.com",
            uafe_declaration=None,
            org_references=None,
        )
        # Explicitly strip compliance
        payload.pop("uafe_declaration", None)
        payload.pop("org_references", None)
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 400, r.text

    def test_register_ecuador_ok_with_compliance(self):
        payload = register_organizer_payload(
            email=f"kycok_{uuid.uuid4().hex[:8]}@example.com",
            social_links={"instagram": "@tys_test"},
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org = r.json()["organizer"]
        assert org["country_code"] == "EC"
        assert org["signup_plan_code"] == "basico"
        assert org["social_links"]["instagram"] == "@tys_test"
        assert org["uafe_declaration"]["accepts_uafe_obligations"] is True

    def test_register_colombia_skips_compliance(self):
        payload = register_organizer_payload(
            email=f"co_{uuid.uuid4().hex[:8]}@example.com",
            country="Colombia",
            country_code="CO",
            legal_id="900123456",
        )
        payload.pop("uafe_declaration", None)
        payload.pop("org_references", None)
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        assert r.json()["organizer"]["country_code"] == "CO"

    def test_register_ecuador_requires_legal_address(self):
        payload = register_organizer_payload(
            email=f"noaddr_{uuid.uuid4().hex[:8]}@example.com",
            legal_address="",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 422, r.text

    def test_register_ecuador_stores_einvoice_config(self):
        payload = register_organizer_payload(
            email=f"einv_{uuid.uuid4().hex[:8]}@example.com",
            legal_name="Shows Ecuador S.A.",
            legal_address="Av. 10 de Agosto 123, Quito",
            establecimiento="002",
            punto_emision="003",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        s = new_session()
        login_user(s, payload["email"], payload["password"])
        cfg = s.get(f"{API}/organizers/me/einvoice-config")
        assert cfg.status_code == 200, cfg.text
        body = cfg.json()
        assert body["ruc"] == "1790000000001"
        assert body["razon_social"] == "Shows Ecuador S.A."
        assert body["direccion"] == "Av. 10 de Agosto 123, Quito"
        assert body["establecimiento"] == "002"
        assert body["punto_emision"] == "003"


class TestRequiredDocumentsByCountry:
    def test_admin_matrix_per_country(self, admin_client):
        r = admin_client.get(
            f"{API}/admin/settings/required-documents", params={"country": "EC"}
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["country_code"] == "EC"
        assert "bank_certificate" in data["company"]
        assert "id_card" in data["individual"]

        # Override temporarily for a fake country row using global fallback path
        r = admin_client.put(
            f"{API}/admin/settings/required-documents",
            json={
                "country_code": "CO",
                "individual": ["id_card"],
                "company": ["ruc", "bank_certificate"],
            },
        )
        assert r.status_code == 200, r.text
        assert "bank_certificate" in r.json()["company"]

        r = admin_client.get(
            f"{API}/admin/settings/required-documents", params={"country": "CO"}
        )
        assert r.status_code == 200
        assert r.json()["company"] == ["ruc", "bank_certificate"]

    def test_organizer_required_docs_follow_country(self, admin_client):
        payload = register_organizer_payload(
            email=f"docs_{uuid.uuid4().hex[:8]}@example.com",
            country_code="CO",
            country="Colombia",
            legal_id="900123456",
        )
        payload.pop("uafe_declaration", None)
        payload.pop("org_references", None)
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        token = r.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        r = requests.get(f"{API}/organizers/required-documents", headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["country_code"] == "CO"


class TestAdminOrganizerPatch:
    def test_assign_plan_and_country(self, admin_client):
        payload = register_organizer_payload(
            email=f"patch_{uuid.uuid4().hex[:8]}@example.com",
        )
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        org_id = r.json()["organizer"]["id"]

        r = admin_client.patch(
            f"{API}/admin/organizers/{org_id}",
            json={
                "country_code": "CO",
                "plan_code": "profesional",
                "subscription_status": "active",
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["country_code"] == "CO"
        assert body["country"] == "Colombia"
        assert body["plan_code"] == "profesional"
        assert body["subscription_status"] == "active"


class TestAdminRegistrationCountries:
    def test_update_country_compliance_flag(self, admin_client):
        r = admin_client.put(
            f"{API}/admin/settings/registration-countries/CO",
            json={"requires_compliance": False, "legal_id_label": "NIT"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["legal_id_label"] == "NIT"
        assert r.json()["requires_compliance"] is False
