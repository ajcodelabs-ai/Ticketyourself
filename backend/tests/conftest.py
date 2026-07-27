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
EVENT_STRIPE_ONLY_SLUG = "funcion-especial-demo-numerado"


def login(session: requests.Session, email: str, password: str) -> str:
    """Authenticate session and return access_token."""
    r = session.post(f"{API}/auth/login", json={"email": email, "password": password})
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
