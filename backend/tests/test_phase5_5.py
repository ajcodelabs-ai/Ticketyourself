"""
Phase 5.5 — Super-admin endpoints tests.
"""
import os
import sys
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_EMAIL = os.environ.get("TYS_ADMIN_EMAIL", "admin@ticketyourself.com")
ADMIN_PASSWORD = os.environ.get("TYS_ADMIN_PASSWORD", "Admin123!")
ORG_EMAIL = os.environ.get("TYS_DEMO_EMAIL", "demo@ticketyourself.com")
ORG_PASSWORD = os.environ.get("TYS_DEMO_PASSWORD", "Organizer123!")


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


@pytest.fixture(scope="module")
def organizer_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": ORG_EMAIL, "password": ORG_PASSWORD},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ── Dashboard stats ──────────────────────────────────────────────────────────
def test_dashboard_stats_payload_shape(admin_token):
    r = requests.get(f"{API}/admin/dashboard/stats", headers=auth(admin_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    # Required top-level keys
    for key in ("kpis", "distribution", "activity", "top_organizers_by_gmv", "top_events_by_sales"):
        assert key in body, f"missing key {key}"
    # KPIs shape
    for k in ("mrr_cents", "gmv_month_cents", "fees_month_cents", "active_organizers"):
        assert k in body["kpis"]
    # Distribution shape
    assert "organizers_by_status" in body["distribution"]
    assert "organizers_by_plan" in body["distribution"]
    # Activity shape
    assert "orders_month" in body["activity"]
    assert isinstance(body["activity"]["orders_month"], dict)


def test_dashboard_stats_rbac(organizer_token):
    r = requests.get(f"{API}/admin/dashboard/stats", headers=auth(organizer_token), timeout=10)
    assert r.status_code in (401, 403)


def test_dashboard_stats_unauth():
    r = requests.get(f"{API}/admin/dashboard/stats", timeout=10)
    assert r.status_code in (401, 403)


# ── Attention items ─────────────────────────────────────────────────────────
def test_attention_items(admin_token):
    r = requests.get(f"{API}/admin/attention-items", headers=auth(admin_token), timeout=10)
    assert r.status_code == 200
    body = r.json()
    for k in ("pending_organizers", "stale_manual_orders", "past_due_subscriptions"):
        assert k in body
        assert isinstance(body[k], int)


# ── Organizers rich ─────────────────────────────────────────────────────────
def test_organizers_rich_basic(admin_token):
    r = requests.get(
        f"{API}/admin/organizers-rich?sort=revenue&direction=desc&limit=5",
        headers=auth(admin_token),
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "total" in body
    for o in body["items"]:
        for k in ("revenue", "tickets_emitted", "events_published"):
            assert k in o


def test_organizers_rich_filter_by_status(admin_token):
    r = requests.get(
        f"{API}/admin/organizers-rich?status=approved&limit=20",
        headers=auth(admin_token),
        timeout=15,
    )
    assert r.status_code == 200
    for o in r.json()["items"]:
        assert o["status"] == "approved"


def test_organizers_rich_rbac(organizer_token):
    r = requests.get(
        f"{API}/admin/organizers-rich", headers=auth(organizer_token), timeout=10
    )
    assert r.status_code in (401, 403)


# ── Audit log ────────────────────────────────────────────────────────────────
def test_audit_log_lists(admin_token):
    r = requests.get(
        f"{API}/admin/audit-log?limit=10", headers=auth(admin_token), timeout=10
    )
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "total" in body
    # Entries should be sorted desc by created_at
    times = [it.get("created_at", "") for it in body["items"]]
    assert times == sorted(times, reverse=True)


def test_audit_log_filter(admin_token):
    r = requests.get(
        f"{API}/admin/audit-log?action=confirm_manual_payment",
        headers=auth(admin_token),
        timeout=10,
    )
    assert r.status_code == 200
    for it in r.json()["items"]:
        assert "confirm_manual_payment" in it["action"]


# ── Global events ───────────────────────────────────────────────────────────
def test_admin_events_global(admin_token):
    r = requests.get(f"{API}/admin/events?limit=5", headers=auth(admin_token), timeout=15)
    assert r.status_code == 200
    body = r.json()
    assert "items" in body and "total" in body
    for e in body["items"]:
        # New enriched fields
        assert "organizer_company_name" in e
        assert "gmv_cents" in e


def test_admin_events_search_and_sort(admin_token):
    r = requests.get(
        f"{API}/admin/events?search=concierto&sort=starts_at&direction=asc",
        headers=auth(admin_token),
        timeout=15,
    )
    assert r.status_code == 200
    items = r.json()["items"]
    if items:
        assert all("concierto" in (e.get("title", "")).lower() for e in items)


# ── Exports ─────────────────────────────────────────────────────────────────
def test_export_organizers_csv(admin_token):
    r = requests.get(
        f"{API}/admin/export/organizers.csv", headers=auth(admin_token), timeout=20
    )
    assert r.status_code == 200
    assert "text/csv" in r.headers.get("content-type", "")
    text = r.content.decode("utf-8-sig")
    assert "ID" in text and "Empresa" in text and "Ingresos USD" in text


def test_export_events_csv(admin_token):
    r = requests.get(
        f"{API}/admin/export/events.csv", headers=auth(admin_token), timeout=20
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Título" in text and "GMV USD" in text


def test_export_orders_csv(admin_token):
    r = requests.get(
        f"{API}/admin/export/orders.csv?status=paid", headers=auth(admin_token), timeout=20
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Orden" in text and "Total USD" in text


def test_export_audit_log_csv(admin_token):
    r = requests.get(
        f"{API}/admin/export/audit-log.csv", headers=auth(admin_token), timeout=20
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Acción" in text


def test_export_monthly_report(admin_token):
    r = requests.get(
        f"{API}/admin/export/monthly-report.csv?year=2026&month=5",
        headers=auth(admin_token),
        timeout=20,
    )
    assert r.status_code == 200
    text = r.content.decode("utf-8-sig")
    assert "Organizer" in text and "GMV USD" in text
    assert "TOTAL" in text  # totals row appended


def test_exports_rbac(organizer_token):
    r = requests.get(
        f"{API}/admin/export/organizers.csv", headers=auth(organizer_token), timeout=10
    )
    assert r.status_code in (401, 403)


if __name__ == "__main__":
    sys.exit(pytest.main([__file__, "-v"]))
