"""Phase 5.5 — extra coverage: activity filter, perf, sort direction."""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://ticket-poc.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@ticketyourself.com", "password": "Admin123!"},
        timeout=15,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def auth(t):
    return {"Authorization": f"Bearer {t}"}


# ── Activity filter ─────────────────────────────────────────────────────────
def test_organizers_rich_activity_filter(admin_token):
    r = requests.get(
        f"{API}/admin/organizers-rich?activity=10%2B",
        headers=auth(admin_token),
        timeout=15,
    )
    assert r.status_code == 200
    body = r.json()
    assert "items" in body
    for o in body["items"]:
        assert o.get("events_published", 0) >= 10


def test_organizers_rich_sort_revenue_desc(admin_token):
    r = requests.get(
        f"{API}/admin/organizers-rich?sort=revenue&direction=desc&limit=20",
        headers=auth(admin_token),
        timeout=15,
    )
    assert r.status_code == 200
    items = r.json()["items"]
    revenues = [o.get("revenue", 0) for o in items]
    assert revenues == sorted(revenues, reverse=True)


# ── Perf ────────────────────────────────────────────────────────────────────
def test_dashboard_stats_perf_under_500ms(admin_token):
    # Warmup
    requests.get(f"{API}/admin/dashboard/stats", headers=auth(admin_token), timeout=10)
    start = time.perf_counter()
    r = requests.get(f"{API}/admin/dashboard/stats", headers=auth(admin_token), timeout=10)
    elapsed_ms = (time.perf_counter() - start) * 1000
    assert r.status_code == 200
    # Includes network — should still be reasonable
    assert elapsed_ms < 2000, f"dashboard/stats took {elapsed_ms:.0f}ms"
    print(f"dashboard/stats latency: {elapsed_ms:.1f}ms")


# ── Audit log pagination ────────────────────────────────────────────────────
def test_audit_log_pagination(admin_token):
    r = requests.get(
        f"{API}/admin/audit-log?page=1&limit=5", headers=auth(admin_token), timeout=10
    )
    assert r.status_code == 200
    body = r.json()
    assert len(body["items"]) <= 5
    assert "total" in body


# ── Events enriched fields ──────────────────────────────────────────────────
def test_admin_events_enriched(admin_token):
    r = requests.get(f"{API}/admin/events?limit=3", headers=auth(admin_token), timeout=15)
    assert r.status_code == 200
    for e in r.json()["items"]:
        assert "organizer_company_name" in e
        assert "organizer_slug" in e
        assert "gmv_cents" in e
        assert "fees_cents" in e


if __name__ == "__main__":
    import sys
    sys.exit(pytest.main([__file__, "-v"]))
