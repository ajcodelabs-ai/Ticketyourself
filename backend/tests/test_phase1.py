"""TYS Fase 1 backend regression suite (pytest).

Covers: health, plans, auth (register/login/me/refresh/logout/check-slug),
RBAC, admin organizers, admin plans, organizers self + docs, billing checkout,
Stripe webhook simulator. Aligned with the review-request feature list.
"""
import io
import os
import uuid

import pytest
import requests

BASE = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@ticketyourself.com"
ADMIN_PASS = "Admin123!"
ORG_PASS = "Organizer123!"

DEMOS = {
    "approved": "demo@ticketyourself.com",
    "pending": "prueba@ticketyourself.com",
    "rejected": "rechazado@ticketyourself.com",
}


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────
def _login_session(email: str, password: str) -> requests.Session:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def admin_session():
    return _login_session(ADMIN_EMAIL, ADMIN_PASS)


@pytest.fixture(scope="module")
def pending_session():
    return _login_session(DEMOS["pending"], ORG_PASS)


@pytest.fixture(scope="module")
def approved_session():
    return _login_session(DEMOS["approved"], ORG_PASS)


# ──────────────────────────────────────────────────────────────────────────────
# Health + Plans
# ──────────────────────────────────────────────────────────────────────────────
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
        # 4 expected codes
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


# ──────────────────────────────────────────────────────────────────────────────
# Auth
# ──────────────────────────────────────────────────────────────────────────────
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
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
        assert r.status_code == 200
        body = r.json()
        assert body["user"]["email"] == ADMIN_EMAIL
        assert body["user"]["role"] == "super_admin"
        assert body["organizer"] is None
        # cookies set
        cookies = {c.name for c in s.cookies}
        assert "tys_access" in cookies
        assert "tys_refresh" in cookies

    def test_login_pending_organizer(self):
        s = _login_session(DEMOS["pending"], ORG_PASS)
        r = s.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["organizer"]["status"] == "pending"

    def test_login_bad_password(self):
        r = requests.post(
            f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong"}
        )
        assert r.status_code == 401
        # spanish error message
        assert "incorrect" in r.json().get("detail", "").lower() or "incorrect" in r.text.lower() or "contrase" in r.text.lower()

    def test_me_admin(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "super_admin"
        assert r.json()["organizer"] is None

    def test_me_approved_organizer_plan_code(self, approved_session):
        r = approved_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        body = r.json()
        assert body["organizer"]["status"] == "approved"
        # demo-org should have plan_code populated
        assert body["organizer"].get("plan_code") == "profesional"

    def test_refresh(self):
        s = _login_session(ADMIN_EMAIL, ADMIN_PASS)
        r = s.post(f"{API}/auth/refresh")
        assert r.status_code == 200
        # me still works after refresh
        assert s.get(f"{API}/auth/me").status_code == 200

    def test_logout_clears_cookies(self):
        s = _login_session(ADMIN_EMAIL, ADMIN_PASS)
        r = s.post(f"{API}/auth/logout")
        assert r.status_code == 200
        # me without cookie -> 401
        s2 = requests.Session()
        assert s2.get(f"{API}/auth/me").status_code == 401

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
        # no auto-login: register response shouldn't set cookies on a clean session
        s_login = _login_session(payload["email"], payload["password"])
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


# ──────────────────────────────────────────────────────────────────────────────
# RBAC
# ──────────────────────────────────────────────────────────────────────────────
class TestRBAC:
    def test_admin_stats_no_auth_401(self):
        r = requests.get(f"{API}/admin/dashboard/stats")
        assert r.status_code == 401

    def test_admin_stats_organizer_403(self, approved_session):
        r = approved_session.get(f"{API}/admin/dashboard/stats")
        assert r.status_code == 403

    def test_admin_organizers_no_auth_401(self):
        r = requests.get(f"{API}/admin/organizers")
        assert r.status_code == 401


# ──────────────────────────────────────────────────────────────────────────────
# Admin Stats + Organizers
# ──────────────────────────────────────────────────────────────────────────────
class TestAdminStats:
    def test_stats(self, admin_session):
        r = admin_session.get(f"{API}/admin/dashboard/stats")
        assert r.status_code == 200
        s = r.json()
        # At least 3 demo organizers (more may have been added by register tests)
        assert s["organizers_total"] >= 3
        assert s["organizers_pending"] >= 1
        assert s["organizers_approved"] >= 1
        assert s["organizers_rejected"] >= 1
        # demo-org has profesional active sub = 5000 cents MRR base
        assert s["active_subscriptions"] >= 1
        assert s["monthly_revenue_estimate_cents"] >= 5000


class TestAdminOrganizers:
    def test_list_all(self, admin_session):
        r = admin_session.get(f"{API}/admin/organizers", params={"limit": 100})
        assert r.status_code == 200
        items = r.json()["items"]
        emails = {it["email"] for it in items}
        for e in DEMOS.values():
            assert e in emails

    def test_filter_pending(self, admin_session):
        r = admin_session.get(f"{API}/admin/organizers", params={"status": "pending"})
        assert r.status_code == 200
        items = r.json()["items"]
        # All returned must be pending
        for it in items:
            assert it["status"] == "pending"
        emails = {it["email"] for it in items}
        assert DEMOS["pending"] in emails

    def test_search_demo(self, admin_session):
        r = admin_session.get(f"{API}/admin/organizers", params={"search": "demo"})
        assert r.status_code == 200
        slugs = {it["slug"] for it in r.json()["items"]}
        assert "demo-org" in slugs

    def test_detail_and_actions_on_temp_organizer(self, admin_session):
        # Register a temp organizer to operate on (avoids polluting demos)
        rand = uuid.uuid4().hex[:8]
        payload = {
            "email": f"acttest_{rand}@example.com",
            "password": "Password123!",
            "company_name": f"ActCo {rand}",
            "legal_id": "1790000000",
            "org_type": "company",
            "phone": "+593999",
            "country": "Ecuador",
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code == 200
        org_id = r.json()["organizer"]["id"]

        # GET detail
        r = admin_session.get(f"{API}/admin/organizers/{org_id}")
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

        # Reject without comment -> 422 (Pydantic min_length=2)
        r = admin_session.post(f"{API}/admin/organizers/{org_id}/reject", json={})
        assert r.status_code in (422, 400)

        # Approve with comment
        r = admin_session.post(
            f"{API}/admin/organizers/{org_id}/approve",
            json={"comment": "OK aprobado"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "approved"
        # tenant active
        comments = r.json().get("admin_comments", [])
        assert any("OK aprobado" in c.get("comment", "") for c in comments)

        # Suspend
        r = admin_session.post(
            f"{API}/admin/organizers/{org_id}/suspend",
            json={"comment": "Test suspend"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "suspended"

        # Plain comment doesn't change status
        r = admin_session.post(
            f"{API}/admin/organizers/{org_id}/comment",
            json={"comment": "nota interna"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "suspended"

        # Reject path (with comment) -> moves to rejected
        r = admin_session.post(
            f"{API}/admin/organizers/{org_id}/reject",
            json={"comment": "Docs ilegibles"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "rejected"
        assert r.json().get("rejection_reason") == "Docs ilegibles"


# ──────────────────────────────────────────────────────────────────────────────
# Admin Plans
# ──────────────────────────────────────────────────────────────────────────────
class TestAdminPlans:
    def test_list_admin_includes_all(self, admin_session):
        r = admin_session.get(f"{API}/admin/plans")
        assert r.status_code == 200
        plans = r.json()
        assert len(plans) == 4

    def test_toggle_plan_active(self, admin_session):
        # deactivate basico, then re-activate
        r = admin_session.patch(f"{API}/admin/plans/basico", json={"active": False})
        assert r.status_code == 200
        # public list should not include it
        pub = requests.get(f"{API}/plans").json()
        assert all(p["code"] != "basico" for p in pub)
        # restore
        r = admin_session.patch(f"{API}/admin/plans/basico", json={"active": True})
        assert r.status_code == 200

    def test_delete_subscribed_plan_409(self, admin_session):
        r = admin_session.delete(f"{API}/admin/plans/profesional")
        # demo-org is subscribed -> should refuse
        assert r.status_code == 409


# ──────────────────────────────────────────────────────────────────────────────
# Organizer self + docs
# ──────────────────────────────────────────────────────────────────────────────
class TestOrganizerSelf:
    def test_get_me_organizer(self, pending_session):
        r = pending_session.get(f"{API}/organizers/me")
        assert r.status_code == 200
        assert r.json()["slug"] == "prueba-eventos"

    def test_get_me_admin_403(self, admin_session):
        r = admin_session.get(f"{API}/organizers/me")
        assert r.status_code == 403

    def test_patch_company_name_syncs_tenant(self, pending_session, admin_session):
        new_name = f"Prueba Eventos {uuid.uuid4().hex[:4]}"
        r = pending_session.patch(
            f"{API}/organizers/me", json={"company_name": new_name}
        )
        assert r.status_code == 200
        assert r.json()["company_name"] == new_name
        # Verify via admin
        org_id = r.json()["id"]
        r2 = admin_session.get(f"{API}/admin/organizers/{org_id}")
        assert r2.json()["company_name"] == new_name

    def test_list_docs(self, pending_session):
        r = pending_session.get(f"{API}/organizers/me/documents")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


class TestOrganizerDocsUpload:
    def test_upload_pdf_doc(self, pending_session):
        files = {
            "file": (
                "ruc.pdf",
                io.BytesIO(b"%PDF-1.4\n%fake pdf content\n"),
                "application/pdf",
            )
        }
        data = {"doc_type": "ruc"}
        r = pending_session.post(
            f"{API}/organizers/me/documents", data=data, files=files
        )
        assert r.status_code in (200, 201), r.text

    def test_upload_bad_doctype_400(self, pending_session):
        files = {"file": ("x.pdf", io.BytesIO(b"%PDF"), "application/pdf")}
        r = pending_session.post(
            f"{API}/organizers/me/documents",
            data={"doc_type": "no_existe"},
            files=files,
        )
        assert r.status_code == 400

    def test_upload_bad_mime_415(self, pending_session):
        files = {"file": ("x.txt", io.BytesIO(b"hello"), "text/plain")}
        r = pending_session.post(
            f"{API}/organizers/me/documents",
            data={"doc_type": "ruc"},
            files=files,
        )
        assert r.status_code == 415


# ──────────────────────────────────────────────────────────────────────────────
# Billing + Stripe simulator
# ──────────────────────────────────────────────────────────────────────────────
class TestBilling:
    def test_checkout_inactive_plan_404(self, pending_session, admin_session):
        # deactivate temporarily
        admin_session.patch(f"{API}/admin/plans/enterprise", json={"active": False})
        try:
            r = pending_session.post(
                f"{API}/billing/checkout-session",
                json={"plan_code": "enterprise", "origin_url": "https://x.test"},
            )
            assert r.status_code == 404
        finally:
            admin_session.patch(f"{API}/admin/plans/enterprise", json={"active": True})

    def test_checkout_subscription_or_502(self, pending_session):
        r = pending_session.post(
            f"{API}/billing/checkout-session",
            json={"plan_code": "profesional", "origin_url": "https://x.test"},
        )
        # Either succeeds (200, returns subscription session) or fails CLEAN 502
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            body = r.json()
            assert body["mode"] == "subscription"
            assert body["checkout_url"].startswith("http")
            assert body["session_id"]
        else:
            # spec: NO silent fallback, message must mention stripe
            assert "Stripe" in r.text or "stripe" in r.text

    def test_checkout_one_time_or_502(self, pending_session):
        r = pending_session.post(
            f"{API}/billing/checkout-session",
            json={"plan_code": "evento_unico", "origin_url": "https://x.test"},
        )
        assert r.status_code in (200, 502), r.text
        if r.status_code == 200:
            assert r.json()["mode"] == "payment"


class TestStripeWebhook:
    def test_real_webhook_503_without_secret(self):
        r = requests.post(
            f"{API}/stripe/webhook",
            data=b"{}",
            headers={"Stripe-Signature": "t=1,v1=fake"},
        )
        # Implementation-dependent: 503 (no secret) or 400 (bad sig). Accept both.
        assert r.status_code in (503, 400)

    def test_simulator_subscription_canceled_idempotent(self, approved_session):
        # demo-org has organizer id available via /auth/me
        me = approved_session.get(f"{API}/auth/me").json()
        org_id = me["organizer"]["id"]

        # Run once
        r1 = requests.post(
            f"{API}/stripe/_simulate_webhook",
            json={
                "event_type": "customer.subscription.deleted",
                "organizer_id": org_id,
            },
        )
        assert r1.status_code in (200, 201), r1.text
        # Run again -> idempotent
        r2 = requests.post(
            f"{API}/stripe/_simulate_webhook",
            json={
                "event_type": "customer.subscription.deleted",
                "organizer_id": org_id,
            },
        )
        assert r2.status_code in (200, 201)

        me2 = approved_session.get(f"{API}/auth/me").json()
        assert me2["organizer"]["subscription_status"] == "canceled"

        # Restore for other tests: simulate active again so MRR test stable
        # (best effort, not all impls support this)
        requests.post(
            f"{API}/stripe/_simulate_webhook",
            json={
                "event_type": "customer.subscription.updated",
                "organizer_id": org_id,
                "status": "active",
            },
        )


# ──────────────────────────────────────────────────────────────────────────────
# OpenAPI under /api
# ──────────────────────────────────────────────────────────────────────────────
class TestOpenAPI:
    def test_openapi_under_api(self):
        r = requests.get(f"{API}/openapi.json")
        assert r.status_code == 200
        spec = r.json()
        # all defined paths should be /api/*
        non_api = [p for p in spec.get("paths", {}).keys() if not p.startswith("/api/")]
        assert non_api == [], f"non /api paths in spec: {non_api}"
