"""TYS integration tests — microsite, assets, activation funnel, dev email log.

Migrated from test_phase2.py.
"""

import io
import os
import time
import uuid

import jwt
import requests
from PIL import Image

from conftest import API, ORG_PASSWORD, bearer


def _auth(token):
    """Auth header only (no Content-Type — needed for file uploads)."""
    return {"Authorization": f"Bearer {token}"}


def _png_bytes(w=120, h=120, color=(80, 70, 229)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="PNG")
    return buf.getvalue()


def _jpeg_bytes(w=400, h=200, color=(220, 38, 38)):
    buf = io.BytesIO()
    Image.new("RGB", (w, h), color).save(buf, format="JPEG", quality=70)
    return buf.getvalue()


def _read_secret_from_env():
    import pathlib

    try:
        env_path = pathlib.Path(__file__).resolve().parent.parent.parent.parent / ".env"
        if env_path.exists():
            for line in env_path.read_text().splitlines():
                if line.startswith("JWT_SECRET="):
                    return line.split("=", 1)[1].strip().strip('"')
    except Exception:
        pass
    return os.environ.get("JWT_SECRET", "dev-secret")


# ── 1. Public microsite ─────────────────────────────────────────────────────


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


# ── 2. Organizer microsite CRUD ─────────────────────────────────────────────


class TestMicrositeMe:
    def test_get_me_demo_approved(self, demo_token):
        r = requests.get(f"{API}/microsite/me", headers=bearer(demo_token))
        assert r.status_code == 200
        d = r.json()
        assert d["template"] in ("estandar", "galeria", "evento_unico")
        assert "branding" in d and "content" in d

    def test_get_me_pending_200_publish_403(self, prueba_token):
        r = requests.get(f"{API}/microsite/me", headers=bearer(prueba_token))
        assert r.status_code == 200, r.text
        r2 = requests.post(f"{API}/microsite/me/publish", headers=bearer(prueba_token))
        assert r2.status_code == 403, r2.text
        body = r2.json()
        assert body["detail"]["error"] == "organizer_pending_review"

    def test_get_me_no_auth_401(self):
        r = requests.get(f"{API}/microsite/me")
        assert r.status_code == 401

    def test_put_template_valid(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"template": "galeria"},
        )
        assert r.status_code == 200
        assert r.json()["template"] == "galeria"
        requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"template": "estandar"},
        )

    def test_put_template_invalid(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"template": "invalido"},
        )
        assert r.status_code == 422

    def test_put_branding_primary_valid_hex(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"branding": {"primary_color": "#dc2626"}},
        )
        assert r.status_code == 200
        assert r.json()["branding"]["primary_color"].lower() == "#dc2626"
        requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"branding": {"primary_color": "#4f46e5"}},
        )

    def test_put_branding_primary_invalid(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"branding": {"primary_color": "azul"}},
        )
        assert r.status_code == 422

    def test_put_font_valid(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"branding": {"font_family": "Inter"}},
        )
        assert r.status_code == 200
        assert r.json()["branding"]["font_family"] == "Inter"

    def test_put_font_invalid(self, demo_token):
        r = requests.put(
            f"{API}/microsite/me",
            headers=bearer(demo_token),
            json={"branding": {"font_family": "Comic Sans"}},
        )
        assert r.status_code == 422


# ── 3. Asset upload ──────────────────────────────────────────────────────────


class TestAssets:
    logo_id = None
    banner_id = None

    def test_upload_logo_png(self, demo_token):
        files = {"file": ("logo.png", _png_bytes(), "image/png")}
        data = {"asset_type": "logo"}
        r = requests.post(
            f"{API}/microsite/me/assets",
            headers=_auth(demo_token),
            files=files,
            data=data,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["url"].startswith("/api/microsite/assets/")
        assert body["mime_type"] == "image/png"
        self.__class__.logo_id = body["id"]

        r2 = requests.get(f"{API}/microsite/me", headers=bearer(demo_token))
        assert r2.json()["branding"]["logo_url"] == body["url"]

    def test_upload_exe_rejected_415(self, demo_token):
        files = {"file": ("evil.exe", b"MZ\x00binary", "application/octet-stream")}
        data = {"asset_type": "logo"}
        r = requests.post(
            f"{API}/microsite/me/assets",
            headers=_auth(demo_token),
            files=files,
            data=data,
        )
        assert r.status_code == 415

    def test_upload_banner_jpeg(self, demo_token):
        files = {"file": ("banner.jpg", _jpeg_bytes(), "image/jpeg")}
        data = {"asset_type": "banner"}
        r = requests.post(
            f"{API}/microsite/me/assets",
            headers=_auth(demo_token),
            files=files,
            data=data,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        self.__class__.banner_id = body["id"]
        r2 = requests.get(f"{API}/microsite/me", headers=bearer(demo_token))
        assert r2.json()["branding"]["banner_url"] == body["url"]

    def test_serve_asset_with_cache_control(self, demo_token):
        aid = self.__class__.logo_id
        assert aid, "logo upload must run first"
        r = requests.get(f"{API}/microsite/assets/{aid}")
        assert r.status_code == 200
        assert r.headers.get("Content-Type") == "image/png"
        assert int(r.headers.get("Content-Length", "0")) > 0

    def test_delete_asset_clears_branding(self, demo_token):
        aid = self.__class__.logo_id
        assert aid
        r = requests.delete(
            f"{API}/microsite/me/assets/{aid}",
            headers=_auth(demo_token),
        )
        assert r.status_code == 204
        r2 = requests.get(f"{API}/microsite/me", headers=bearer(demo_token))
        assert r2.json()["branding"]["logo_url"] is None


# ── 4. Publish / Unpublish lifecycle ────────────────────────────────────────


class TestPublishLifecycle:
    def test_unpublish_then_404_then_republish(self, demo_token):
        r = requests.post(f"{API}/microsite/me/unpublish", headers=bearer(demo_token))
        assert r.status_code == 200
        assert r.json()["published"] is False

        r2 = requests.get(f"{API}/public/microsite/demo-org")
        assert r2.status_code == 404

        r3 = requests.post(f"{API}/microsite/me/publish", headers=bearer(demo_token))
        assert r3.status_code == 200
        assert r3.json()["published"] is True

        r4 = requests.get(f"{API}/public/microsite/demo-org")
        assert r4.status_code == 200


# ── 5. Activation funnel ─────────────────────────────────────────────────────


class TestActivationFunnel:
    funnel_org_id = None
    funnel_token = None

    def test_admin_funnel_no_auth_401(self):
        r = requests.get(f"{API}/admin/activation-funnel")
        assert r.status_code == 401

    def test_admin_funnel_as_organizer_403(self, demo_token):
        r = requests.get(f"{API}/admin/activation-funnel", headers=bearer(demo_token))
        assert r.status_code == 403

    def test_admin_funnel_shape(self, admin_token):
        r = requests.get(f"{API}/admin/activation-funnel", headers=bearer(admin_token))
        assert r.status_code == 200
        d = r.json()
        events = [s["event"] for s in d["steps"]]
        assert events == [
            "email_sent",
            "link_clicked",
            "first_doc_uploaded",
            "plan_selected",
            "checkout_started",
            "subscription_active",
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
        self.__class__.funnel_org_id = organizer_id
        self.__class__.funnel_token = body.get("access_token")

        r2 = requests.post(
            f"{API}/activation/log-event",
            json={"organizer_id": organizer_id, "event_name": "link_clicked"},
        )
        assert r2.status_code == 200, r2.text

    def test_log_event_with_invalid_token(self):
        r = requests.post(
            f"{API}/activation/log-event",
            json={"token": "garbage.token.here", "event_name": "link_clicked"},
        )
        assert r.status_code == 401

    def test_log_event_with_valid_jwt_token(self):
        secret = os.environ.get("JWT_SECRET") or _read_secret_from_env()
        org_id = self.__class__.funnel_org_id
        if not org_id:
            ts = int(time.time())
            email = f"funnel_jwt_{ts}@example.com"
            payload = {
                "email": email,
                "password": ORG_PASSWORD,
                "company_name": f"JWT Funnel Co {ts}",
                "legal_id": f"17{ts % 100000000:08d}002",
                "org_type": "company",
                "phone": "+593999000222",
                "country": "Ecuador",
            }
            r = requests.post(f"{API}/auth/register", json=payload)
            assert r.status_code in (200, 201), r.text
            body = r.json()
            org_id = body.get("organizer", {}).get("id") or body.get("organizer_id")
            assert org_id
        assert org_id
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
            secret,
            algorithm="HS256",
        )
        r = requests.post(
            f"{API}/activation/log-event",
            json={"token": token, "event_name": "link_clicked"},
        )
        assert r.status_code == 200, r.text


# ── 6. Dev email log ─────────────────────────────────────────────────────────


class TestDevEmailLog:
    shared_email_file = None

    def test_list_email_log(self):
        r = requests.get(f"{API}/_dev/email-log")
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, list)
        assert len(data) >= 1
        assert "viewer_url" in data[0]
        self.__class__.shared_email_file = data[0]["name"]

    def test_get_one_email(self):
        name = self.__class__.shared_email_file
        assert name
        r = requests.get(f"{API}/_dev/email-log/{name}")
        assert r.status_code == 200
        assert "html" in r.headers.get("Content-Type", "").lower()

    def test_path_traversal_rejected(self):
        r = requests.get(f"{API}/_dev/email-log/..%2Fetc%2Fpasswd")
        assert r.status_code in (400, 404)
