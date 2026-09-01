"""Shared fixtures for all TYS tests (unit + integration)."""

from __future__ import annotations

import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = "admin@ticketyourself.com"
ADMIN_PASSWORD = "Admin123!"
DEMO_EMAIL = "demo@ticketyourself.com"
DEMO_PASSWORD = "Organizer123!"
PRUEBA_EMAIL = "prueba@ticketyourself.com"
PRUEBA_PASSWORD = "Organizer123!"
RECHAZADO_EMAIL = "rechazado@ticketyourself.com"
RECHAZADO_PASSWORD = "Organizer123!"
ORG_PASSWORD = "Organizer123!"

DEMO_TENANT = "demo-org"
FREE_EVENT_SLUG = "charla-liderazgo-femenino"
PAID_EVENT_SLUG = "funcion-especial-demo-numerado"
EVENT_MANUAL_SLUG = "funcion-especial-demo-numerado"
EVENT_STRIPE_ONLY_SLUG = "conferencia-marketing-digital"


def login(
    session: requests.Session,
    email: str,
    password: str,
    tenant_slug: str | None = None,
) -> str:
    """Authenticate session and return access_token."""
    body: dict = {"email": email, "password": password}
    if tenant_slug:
        body["tenant_slug"] = tenant_slug
    r = session.post(f"{API}/auth/login", json=body)
    r.raise_for_status()
    token = r.json()["access_token"]
    session.cookies.clear()
    session.headers.update(
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    )
    return token


def bearer(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def unique_buyer(label: str = "buyer") -> dict:
    import uuid

    uid = uuid.uuid4().hex[:8]
    return {
        "name": f"Test {label}",
        "email": f"{label}_{uid}@example.com",
        "phone": "+593999999999",
        "document_id": "9999999999",
        "document_type": "cédula",
    }


BUYER_PASSWORD = "Buyer123!"


def register_buyer_client(
    buyer: dict | None = None,
    password: str = BUYER_PASSWORD,
    tenant_slug: str = DEMO_TENANT,
):
    """Register a buyer (or log in if the email already exists) and return (session, buyer)."""
    buyer = buyer or unique_buyer()
    s = new_session()
    r = s.post(
        f"{API}/auth/register-buyer",
        json={
            "name": buyer["name"],
            "email": buyer["email"],
            "password": password,
            "phone": buyer.get("phone"),
            "tenant_slug": tenant_slug,
        },
    )
    if r.status_code == 409:
        login(s, buyer["email"], password, tenant_slug=tenant_slug)
        return s, buyer
    r.raise_for_status()
    token = r.json()["access_token"]
    s.headers.update(
        {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    )
    return s, buyer


def place_order(body: dict, **kwargs):
    """POST /public/orders as a freshly registered buyer matching body['buyer']."""
    s, _ = register_buyer_client(body.get("buyer"))
    return s.post(f"{API}/public/orders", json=body, **kwargs)


def register_organizer_payload(**overrides) -> dict:
    """Base payload for POST /auth/register (Ecuador compliance included)."""
    import uuid

    rand = uuid.uuid4().hex[:8]
    payload = {
        "email": f"org_{rand}@example.com",
        "password": "Password123!",
        "company_name": f"Org {rand}",
        "legal_id": "1790000000001",
        "org_type": "company",
        "phone": "+593999999999",
        "country": "Ecuador",
        "country_code": "EC",
        "legal_address": "Av. Amazonas N34-123, Quito",
        "legal_name": None,
        "establecimiento": "001",
        "punto_emision": "001",
        "is_pep": False,
        "uafe_declaration": {
            "funds_origin_declared": True,
            "funds_origin_detail": "Ingresos por eventos",
            "accepts_uafe_obligations": True,
        },
        "org_references": [
            {"name": "Ref Uno", "phone": "+593988888888", "relation": "Cliente"}
        ],
        "signup_plan_code": "basico",
    }
    payload.update(overrides)
    return payload


def new_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ── Function-scoped authenticated sessions ───────────────────────────────────


@pytest.fixture
def admin_client() -> requests.Session:
    s = new_session()
    login(s, ADMIN_EMAIL, ADMIN_PASSWORD)
    return s


@pytest.fixture
def demo_client() -> requests.Session:
    s = new_session()
    login(s, DEMO_EMAIL, DEMO_PASSWORD)
    return s


@pytest.fixture
def prueba_client() -> requests.Session:
    s = new_session()
    login(s, PRUEBA_EMAIL, PRUEBA_PASSWORD)
    return s


@pytest.fixture
def rechazado_client() -> requests.Session:
    s = new_session()
    login(s, RECHAZADO_EMAIL, RECHAZADO_PASSWORD)
    return s


# ── Session-scoped tokens (shared across tests) ──────────────────────────────


@pytest.fixture(scope="session")
def admin_token() -> str:
    s = new_session()
    return login(s, ADMIN_EMAIL, ADMIN_PASSWORD)


@pytest.fixture(scope="session")
def demo_token() -> str:
    s = new_session()
    return login(s, DEMO_EMAIL, DEMO_PASSWORD)


@pytest.fixture(scope="session")
def prueba_token() -> str:
    s = new_session()
    return login(s, PRUEBA_EMAIL, PRUEBA_PASSWORD)
