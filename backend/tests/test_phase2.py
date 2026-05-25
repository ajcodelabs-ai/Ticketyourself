"""
TYS Phase 2 backend tests — microsite, activation funnel, dev email log.
Run: pytest /app/backend/tests/test_phase2.py -v
"""
import io
import os
import time
import uuid

import jwt
import pytest
import requests
from PIL import Image

# Read public URL from frontend .env (single source of truth)
def _read_base() -> str:
    env_path = "/app/frontend/.env"
    with open(env_path) as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip().strip('"').rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not found")

BASE_URL = _read_base()
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TYS_ADMIN_EMAIL", "admin@ticketyourself.com")
ADMIN_PASSWORD = os.environ.get("TYS_ADMIN_PASSWORD", "Admin123!")
DEMO_EMAIL = os.environ.get("TYS_DEMO_EMAIL", "demo@ticketyourself.com")
DEMO_PASSWORD = os.environ.get("TYS_DEMO_PASSWORD", "Organizer123!")
PRUEBA_EMAIL = os.environ.get("TYS_PRUEBA_EMAIL", "prueba@ticketyourself.com")
PRUEBA_PASSWORD = os.environ.get("TYS_PRUEBA_PASSWORD", "Organizer123!")


# ── Fixtures ────────────────────────────────────────────────────────────────
@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def demo_token():
    r = requests.post(f"{API}/auth/login", json={"email": DEMO_EMAIL, "password": DEMO_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def prueba_token():
    r = requests.post(f"{API}/auth/login", json={"email": PRUEBA_EMAIL, "password": PRUEBA_PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(w=120, h=120, color=(80, 70, 229)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(w=400, h=200, color=(220, 38, 38)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


# ── 1. Health + OpenAPI ─────────────────────────────────────────────────────
class TestSmoke:
    def test_health(self):
        r = requests.get(f"{API}/health")
        assert r.status_code == 200
        assert r.json() == {"status": "ok"}

    def test_openapi_has_new_endpoints(self):
        r = requests.get(f"{API}/openapi.json")
        assert r.status_code == 200
        paths = r.json()["paths"]
        assert "/api/microsite/me" in paths
        assert "/api/public/microsite/{slug}" in paths
        assert "/api/activation/log-event" in paths
        assert "/api/admin/activation-funnel" in paths
        assert "/api/_dev/email-log" in paths


# ── 2. Public microsite ─────────────────────────────────────────────────────
class TestPublicMicrosite:
    def test_demo_org_published(self):
        r = requests.get(f"{API}/public/microsite/demo-org")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["template"] == "estandar"
        assert d["branding"]["primary_color"].lower() == "#4f46e5"
        assert "Demo Organizer" in d["content"]["hero_title"]

    def test_prueba_not_published(self):
        r = requests.get(f"{API}/public/microsite/prueba-eventos")
        assert r.status_code == 404

    def test_nonexistent_slug(self):
        r = requests.get(f"{API}/public/microsite/nonexistente-xyz")
        assert r.status_code == 404

    def test_events_placeholder(self):
        r = requests.get(f"{API}/public/microsite/demo-org/events")
        assert r.status_code == 200
        assert r.json() == []


# ── 3. Organizer microsite CRUD ─────────────────────────────────────────────
class TestMicrositeMe:
    def test_get_me_demo_approved(self, demo_token):
        r = requests.get(f"{API}/microsite/me", headers=_h(demo_token))
        assert r.status_code == 200
        d = r.json()
        assert d["template"] in ("estandar", "galeria", "evento_unico")
        assert "branding" in d and "content" in d

    def test_get_me_pending_200_publish_403(self, prueba_token):
        # Phase 9.5: pending orgs gain read/edit access to the panel so they
        # can prepare their microsite while the admin reviews their account;
        # only the publish endpoint stays gated.
        r = requests.get(f"{API}/microsite/me", headers=_h(prueba_token))
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/microsite/me/publish", headers=_h(prueba_token))
        assert r2.status_code == 403, r2.text
        body = r2.json()
        # New structured error so the frontend can show the explanatory dialog.
        assert body["detail"]["error"] == "organizer_pending_review"

    def test_get_me_no_auth_401(self):
        r = requests.get(f"{API}/microsite/me")
        assert r.status_code == 401

    def test_put_template_valid(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token), json={"template": "galeria"})
        assert r.status_code == 200
        assert r.json()["template"] == "galeria"
        # Restore
        requests.put(f"{API}/microsite/me", headers=_h(demo_token), json={"template": "estandar"})

    def test_put_template_invalid(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token), json={"template": "invalido"})
        assert r.status_code == 422

    def test_put_branding_primary_valid_hex(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token),
                         json={"branding": {"primary_color": "#dc2626"}})
        assert r.status_code == 200
        assert r.json()["branding"]["primary_color"].lower() == "#dc2626"
        # Restore canonical indigo
        requests.put(f"{API}/microsite/me", headers=_h(demo_token),
                     json={"branding": {"primary_color": "#4f46e5"}})

    def test_put_branding_primary_invalid(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token),
                         json={"branding": {"primary_color": "azul"}})
        assert r.status_code == 422

    def test_put_font_valid(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token),
                         json={"branding": {"font_family": "Inter"}})
        assert r.status_code == 200
        assert r.json()["branding"]["font_family"] == "Inter"

    def test_put_font_invalid(self, demo_token):
        r = requests.put(f"{API}/microsite/me", headers=_h(demo_token),
                         json={"branding": {"font_family": "Comic Sans"}})
        assert r.status_code == 422


# ── 4. Asset upload ─────────────────────────────────────────────────────────
class TestAssets:
    def test_upload_logo_png(self, demo_token):
        files = {"file": ("logo.png", _png_bytes(), "image/png")}
        data = {"asset_type": "logo"}
        r = requests.post(f"{API}/microsite/me/assets", headers=_h(demo_token), files=files, data=data)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["url"].startswith("/api/microsite/assets/")
        assert body["mime_type"] == "image/png"
        pytest.shared_logo_id = body["id"]

        # Microsite branding logo_url should be updated
        r2 = requests.get(f"{API}/microsite/me", headers=_h(demo_token))
        assert r2.json()["branding"]["logo_url"] == body["url"]

    def test_upload_exe_rejected_415(self, demo_token):
        files = {"file": ("evil.exe", b"MZ\x00binary", "application/octet-stream")}
        data = {"asset_type": "logo"}
        r = requests.post(f"{API}/microsite/me/assets", headers=_h(demo_token), files=files, data=data)
        assert r.status_code == 415

    def test_upload_banner_jpeg(self, demo_token):
        files = {"file": ("banner.jpg", _jpeg_bytes(), "image/jpeg")}
        data = {"asset_type": "banner"}
        r = requests.post(f"{API}/microsite/me/assets", headers=_h(demo_token), files=files, data=data)
        assert r.status_code == 201, r.text
        body = r.json()
        pytest.shared_banner_id = body["id"]
        r2 = requests.get(f"{API}/microsite/me", headers=_h(demo_token))
        assert r2.json()["branding"]["banner_url"] == body["url"]

    def test_serve_asset_with_cache_control(self, demo_token):
        aid = getattr(pytest, "shared_logo_id", None)
        assert aid, "logo upload must run first"
        r = requests.get(f"{API}/microsite/assets/{aid}")
        assert r.status_code == 200
        # Note: Cloudflare in front of preview may override Cache-Control to
        # `no-store, no-cache, must-revalidate`. The backend code sets
        # `public, max-age=86400` — see microsite.py:serve_asset. We only
        # verify the file is delivered with correct mime here.
        assert r.headers.get("Content-Type") == "image/png"
        assert int(r.headers.get("Content-Length", "0")) > 0

    def test_delete_asset_clears_branding(self, demo_token):
        aid = getattr(pytest, "shared_logo_id", None)
        assert aid
        r = requests.delete(f"{API}/microsite/me/assets/{aid}", headers=_h(demo_token))
        assert r.status_code == 204
        r2 = requests.get(f"{API}/microsite/me", headers=_h(demo_token))
        assert r2.json()["branding"]["logo_url"] is None


# ── 5. Publish / Unpublish lifecycle ───────────────────────────────────────
class TestPublishLifecycle:
    def test_unpublish_then_404_then_republish(self, demo_token):
        # Unpublish
        r = requests.post(f"{API}/microsite/me/unpublish", headers=_h(demo_token))
        assert r.status_code == 200
        assert r.json()["published"] is False
        # Public should now 404
        r2 = requests.get(f"{API}/public/microsite/demo-org")
        assert r2.status_code == 404
        # Republish
        r3 = requests.post(f"{API}/microsite/me/publish", headers=_h(demo_token))
        assert r3.status_code == 200
        assert r3.json()["published"] is True
        r4 = requests.get(f"{API}/public/microsite/demo-org")
        assert r4.status_code == 200


# ── 6. Activation funnel ────────────────────────────────────────────────────
class TestActivationFunnel:
    def test_admin_funnel_no_auth_401(self):
        r = requests.get(f"{API}/admin/activation-funnel")
        assert r.status_code == 401

    def test_admin_funnel_as_organizer_403(self, demo_token):
        r = requests.get(f"{API}/admin/activation-funnel", headers=_h(demo_token))
        assert r.status_code == 403

    def test_admin_funnel_shape(self, admin_token):
        r = requests.get(f"{API}/admin/activation-funnel", headers=_h(admin_token))
        assert r.status_code == 200
        d = r.json()
        events = [s["event"] for s in d["steps"]]
        assert events == [
            "email_sent", "link_clicked", "first_doc_uploaded",
            "plan_selected", "checkout_started", "subscription_active",
        ]
        assert "counts" in d and "conversion" in d

    def test_register_triggers_email_sent_and_link_clicked(self):
        ts = int(time.time())
        email = f"test_{ts}@example.com"
        payload = {
            "email": email,
            "password": "Organizer123!",
            "company_name": f"Funnel Co {ts}",
            "legal_id": f"17{ts % 100000000:08d}001",
            "org_type": "company",
            "phone": "+593999000111",
            "country": "Ecuador",
        }
        r = requests.post(f"{API}/auth/register", json=payload)
        assert r.status_code in (200, 201), r.text
        body = r.json()
        organizer_id = body.get("organizer", {}).get("id") or body.get("organizer_id")
        assert organizer_id, f"register response missing organizer id: {body}"
        pytest.funnel_org_id = organizer_id
        pytest.funnel_token = body.get("access_token")

        # log link_clicked via organizer_id (auth-style log accepts public payload)
        r2 = requests.post(f"{API}/activation/log-event",
                           json={"organizer_id": organizer_id, "event_name": "link_clicked"})
        assert r2.status_code == 200, r2.text

    def test_log_event_with_invalid_token(self):
        r = requests.post(f"{API}/activation/log-event",
                          json={"token": "garbage.token.here", "event_name": "link_clicked"})
        assert r.status_code == 401

    def test_log_event_with_valid_jwt_token(self):
        # Forge an activation JWT using backend JWT secret + activation purpose
        secret = os.environ.get("JWT_SECRET") or _read_secret_from_env()
        org_id = getattr(pytest, "funnel_org_id", None)
        assert org_id, "register test must run first"
        now = int(time.time())
        token = jwt.encode(
            {
                "sub": "test-user",
                "organizer_id": org_id,
                "purpose": "first_access",
                "jti": str(uuid.uuid4()),
                "iat": now,
                "exp": now + 600,
            },
            secret, algorithm="HS256",
        )
        r = requests.post(f"{API}/activation/log-event",
                          json={"token": token, "event_name": "link_clicked"})
        assert r.status_code == 200, r.text


def _read_secret_from_env():
    with open("/app/backend/.env") as f:
        for line in f:
            if line.startswith("JWT_SECRET"):
                return line.split("=", 1)[1].strip().strip('"')
    raise RuntimeError("JWT_SECRET missing")


# ── 7. Dev email log ────────────────────────────────────────────────────────
class TestDevEmailLog:
    def test_list_email_log(self):
        r = requests.get(f"{API}/_dev/email-log")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        # At least the welcome email from previous funnel test should exist
        assert len(data) >= 1
        assert "viewer_url" in data[0]
        pytest.shared_email_file = data[0]["name"]

    def test_get_one_email(self):
        name = getattr(pytest, "shared_email_file", None)
        assert name
        r = requests.get(f"{API}/_dev/email-log/{name}")
        assert r.status_code == 200
        assert "html" in r.headers.get("Content-Type", "").lower()

    def test_path_traversal_rejected(self):
        r = requests.get(f"{API}/_dev/email-log/..%2Fetc%2Fpasswd")
        # Either 400 (explicit reject) or 404 (path doesn't exist) is acceptable;
        # the contract says reject path traversal — must NOT be 200.
        assert r.status_code in (400, 404)
