"""TYS Auth integration tests — migrated from test_phase1.py.

Covers: health, plans, OpenAPI, auth (register/login/me/refresh/logout/
check-slug), and RBAC.
"""

import uuid

import requests
from conftest import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    API,
    ORG_PASSWORD,
    PRUEBA_EMAIL,
    login,
    new_session,
)


class TestHealthPlans:
    def test_health(self):
        r = requests.get(f"{API}/health")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"

    def test_plans_list_4_active_sorted(self):
        r = requests.get(f"{API}/plans")
        assert r.status_code == 200
        plans = r.json()
        codes = [p["code"] for p in plans]
        for c in ["evento_unico", "basico", "profesional", "enterprise"]:
            assert c in codes, f"missing {c} in {codes}"
        assert all(p["active"] for p in plans)
        prices = [p["price_cents"] for p in plans]
        assert prices == sorted(prices), f"plans not sorted asc by price: {prices}"

    def test_plan_detail(self):
        r = requests.get(f"{API}/plans/profesional")
        assert r.status_code == 200
        assert r.json()["code"] == "profesional"

    def test_plan_detail_404(self):
        r = requests.get(f"{API}/plans/no-existe")
        assert r.status_code == 404


class TestAuth:
    def test_check_slug_taken(self):
        r = requests.post(f"{API}/auth/check-slug", json={"slug": "demo-org"})
        assert r.status_code == 200
        body = r.json()
        assert body["available"] is False
        assert body["suggestion"] is not None

    def test_check_slug_free(self):
        slug = f"libre-{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/auth/check-slug", json={"slug": slug})
        assert r.status_code == 200
        assert r.json()["available"] is True

    def test_login_admin(self):
        s = new_session()
        r = s.post(
            f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["email"] == ADMIN_EMAIL
        assert body["user"]["role"] == "super_admin"
        assert body["organizer"] is None
        cookies = {c.name for c in s.cookies}
        assert "tys_access" in cookies
        assert "tys_refresh" in cookies

    def test_login_pending_organizer(self):
        s = new_session()
        login(s, PRUEBA_EMAIL, ORG_PASSWORD)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["organizer"]["status"] == "pending"

    def test_login_bad_password(self):
        r = requests.post(
            f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}
        )
        assert r.status_code == 401
        assert (
            "incorrect" in r.json().get("detail", "").lower()
            or "incorrect" in r.text.lower()
            or "contrase" in r.text.lower()
        )

    def test_me_admin(self, admin_client):
        r = admin_client.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "super_admin"
        assert r.json()["organizer"] is None

    def test_me_approved_organizer_plan_code(self, demo_client):
        r = demo_client.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["organizer"]["status"] == "approved"
        assert body["organizer"].get("plan_code") == "profesional"

    def test_refresh(self):
        s = requests.Session()
        r = s.post(
            f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        assert r.status_code == 200
        r = s.post(f"{API}/auth/refresh")
        assert r.status_code == 200
        assert s.get(f"{API}/auth/me").status_code == 200

    def test_logout_clears_cookies(self):
        s = requests.Session()
        s.post(
            f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}
        )
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        assert s.get(f"{API}/auth/me").status_code == 401

    def test_me_no_cookies_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401


class TestRegister:
    def test_register_then_login(self):
        rand = uuid.uuid4().hex[:8]
        payload = {
            "email": f"new_{rand}@example.com",
            "password": "Password123!",
            "company_name": f"NewCo {rand}",
            "legal_id": "1790000000",
            "org_type": "company",
            "phone": "+593999999999",
            "country": "Ecuador",
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["user"]["email"] == payload["email"]
        assert body["organizer"]["status"] == "pending"
        s_login = new_session()
        login(s_login, payload["email"], payload["password"])
        assert s_login.get(f"{API}/auth/me").status_code == 200

    def test_register_duplicate_email_409(self):
        payload = {
            "email": ADMIN_EMAIL,
            "password": "Password123!",
            "company_name": "Dup",
            "legal_id": "1790000000",
            "org_type": "company",
            "phone": "+593999",
            "country": "Ecuador",
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 409

    def test_register_slug_taken_409(self):
        rand = uuid.uuid4().hex[:6]
        payload = {
            "email": f"slugtest_{rand}@example.com",
            "password": "Password123!",
            "company_name": "Some Co",
            "legal_id": "1790000000",
            "org_type": "company",
            "phone": "+593999",
            "country": "Ecuador",
            "slug": "demo-org",
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 409
        assert "demo-org" in r.text or "Suggestion" in r.text


class TestRBAC:
    def test_admin_stats_no_auth_401(self):
        r = requests.get(f"{API}/admin/dashboard/stats")
        assert r.status_code == 401

    def test_admin_stats_organizer_403(self, demo_client):
        r = demo_client.get(f"{API}/admin/dashboard/stats")
        assert r.status_code == 403

    def test_admin_organizers_no_auth_401(self):
        r = requests.get(f"{API}/admin/organizers")
        assert r.status_code == 401


class TestOpenAPI:
    def test_openapi_under_api(self):
        r = requests.get(f"{API}/openapi.json")
        assert r.status_code == 200
        spec = r.json()
        non_api = [p for p in spec.get("paths", {}).keys() if not p.startswith("/api/")]
        assert non_api == [], f"non /api paths in spec: {non_api}"
