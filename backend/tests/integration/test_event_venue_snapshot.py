"""Integration: event venue_layout snapshots are independent of the master venue."""

from __future__ import annotations

import copy
import uuid

import pytest
import requests

from tests.conftest import API, DEMO_TENANT

pytestmark = pytest.mark.skipif(
    not API or API == "/api", reason="REACT_APP_BACKEND_URL not set"
)


def _create_draft_event(
    client: requests.Session, title: str, pricing_type: str = "paid"
) -> dict:
    slug = f"snap-{uuid.uuid4().hex[:8]}"
    from datetime import datetime, timedelta, timezone

    starts = datetime.now(timezone.utc) + timedelta(days=30)
    ends = starts + timedelta(hours=2)
    r = client.post(
        f"{API}/events/me",
        json={
            "title": title,
            "slug": slug,
            "pricing_type": pricing_type,
            "base_price_cents": 1000 if pricing_type == "paid" else 0,
            "venue_name": "Temp",
            "venue_city": "Quito",
            "venue_country": "Ecuador",
            "starts_at": starts.isoformat(),
            "ends_at": ends.isoformat(),
        },
    )
    assert r.status_code in (200, 201), r.text
    return r.json()


def _first_published_venue(client: requests.Session) -> dict:
    r = client.get(f"{API}/venues/me", params={"status": "published"})
    assert r.status_code == 200, r.text
    items = r.json().get("items") or []
    assert items, "Need at least one published venue in demo org"
    for v in items:
        if v.get("elements"):
            return v
    return items[0]


class TestEventVenueSnapshot:
    def test_link_creates_shape_only_snapshot(self, demo_client):
        """Linking a venue copies shape only — no master localities/prices."""
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "Snapshot Link AA")
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={
                "venue_id": venue["id"],
                "locality_pricing": [],
                "seat_holds_window_minutes": 10,
            },
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["venue_id"] == venue["id"]
        assert body["source_venue_id"] == venue["id"]
        layout = body.get("venue_layout") or {}
        assert layout.get("elements")
        assert layout.get("localities") == []
        assert all(not e.get("locality_id") for e in layout["elements"])
        master_el_ids = {e["id"] for e in venue["elements"]}
        snap_el_ids = {e["id"] for e in layout["elements"]}
        assert snap_el_ids == master_el_ids

        demo_client.delete(f"{API}/events/me/{ev['id']}/venue")

    def test_aa_bb_layouts_independent_of_master(self, demo_client):
        venue = _first_published_venue(demo_client)
        master_before = copy.deepcopy(
            demo_client.get(f"{API}/venues/me/{venue['id']}").json()
        )

        aa = _create_draft_event(demo_client, "Snapshot AA")
        bb = _create_draft_event(demo_client, "Snapshot BB")
        for ev in (aa, bb):
            r = demo_client.put(
                f"{API}/events/me/{ev['id']}/venue",
                json={
                    "venue_id": venue["id"],
                    "locality_pricing": [],
                    "seat_holds_window_minutes": 10,
                },
            )
            assert r.status_code == 200, r.text

        layout_aa = demo_client.get(f"{API}/events/me/{aa['id']}/venue-layout").json()
        elements = copy.deepcopy(layout_aa["elements"])
        assert elements
        target = elements[0]
        if target.get("kind") in ("seat_row_straight", "seat_row_curved"):
            target["seats_count"] = int(target.get("seats_count") or 1) + 1
            target["label"] = "AA-ONLY"
        else:
            target["label"] = "AA-ONLY"

        r = demo_client.put(
            f"{API}/events/me/{aa['id']}/venue-layout",
            json={
                "canvas": layout_aa["canvas"],
                "elements": elements,
                "localities": layout_aa["localities"],
            },
        )
        assert r.status_code == 200, r.text
        updated_aa = r.json()
        assert any(e.get("label") == "AA-ONLY" for e in updated_aa["elements"])

        layout_bb = demo_client.get(f"{API}/events/me/{bb['id']}/venue-layout").json()
        assert not any(e.get("label") == "AA-ONLY" for e in layout_bb["elements"])
        assert layout_bb["elements"][0]["id"] == layout_aa["elements"][0]["id"]

        master_after = demo_client.get(f"{API}/venues/me/{venue['id']}").json()
        assert master_after["elements"] == master_before["elements"]
        assert master_after["localities"] == master_before["localities"]

        for ev in (aa, bb):
            demo_client.delete(f"{API}/events/me/{ev['id']}/venue")

    def test_layout_structural_lock_when_sold(self, demo_client):
        """Demo numbered event already has pre-sold seats → structural PUT → 409."""
        r = demo_client.get(f"{API}/events/me")
        assert r.status_code == 200
        items = r.json().get("items") or r.json()
        if isinstance(items, dict):
            items = items.get("items") or []
        numbered = next(
            (e for e in items if e.get("slug") == "funcion-especial-demo-numerado"),
            None,
        )
        if not numbered or not numbered.get("venue_id"):
            pytest.skip("Demo numbered event not seeded")
        layout = demo_client.get(
            f"{API}/events/me/{numbered['id']}/venue-layout"
        ).json()
        elements = copy.deepcopy(layout["elements"])
        row = next(
            (
                e
                for e in elements
                if e.get("kind") in ("seat_row_straight", "seat_row_curved")
            ),
            None,
        )
        if not row:
            pytest.skip("No seat row in numbered event layout")
        row["seats_count"] = int(row.get("seats_count") or 1) + 5
        r = demo_client.put(
            f"{API}/events/me/{numbered['id']}/venue-layout",
            json={
                "canvas": layout["canvas"],
                "elements": elements,
                "localities": layout["localities"],
            },
        )
        assert r.status_code == 409, r.text


class TestFreeEventLocalityPricing:
    """TI-121: a Gratuito event must never end up with a priced locality —
    across every save path that can set locality_pricing, not just publish."""

    def test_link_venue_rejects_priced_locality_on_free_event(self, demo_client):
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "TI121 free link", pricing_type="free")
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={
                "venue_id": venue["id"],
                "locality_pricing": [
                    {"locality_id": "any-locality", "price_cents": 2500}
                ],
            },
        )
        assert r.status_code == 422, r.text

    def test_link_venue_allows_zero_priced_locality_on_free_event(self, demo_client):
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "TI121 free zero", pricing_type="free")
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={
                "venue_id": venue["id"],
                "locality_pricing": [
                    {"locality_id": "any-locality", "price_cents": 0}
                ],
            },
        )
        assert r.status_code == 200, r.text

    def test_venue_layout_clamps_new_locality_price_on_free_event(self, demo_client):
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "TI121 free layout", pricing_type="free")
        demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={"venue_id": venue["id"], "locality_pricing": []},
        )
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}/venue-layout",
            json={
                "canvas": {"width": 1200, "height": 800},
                "elements": [],
                "localities": [
                    {"id": "new-vip", "name": "VIP", "default_price_cents": 5000}
                ],
            },
        )
        assert r.status_code == 200, r.text
        pricing = {lp["locality_id"]: lp for lp in r.json()["locality_pricing"]}
        assert pricing["new-vip"]["price_cents"] == 0

    def test_cannot_switch_to_free_with_existing_priced_locality(self, demo_client):
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "TI121 flip to free", pricing_type="paid")
        demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={
                "venue_id": venue["id"],
                "locality_pricing": [
                    {"locality_id": "any-locality", "price_cents": 2500}
                ],
            },
        )
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}",
            json={"pricing_type": "free"},
        )
        assert r.status_code == 422, r.text

    def test_link_venue_rejects_fee_only_locality_on_free_event(self, demo_client):
        """price_cents=0 alone isn't enough — a nonzero fee still bills the
        buyer at checkout (compute_totals_with_seats has no free-event gate),
        so it must be rejected too, not just a positive price_cents."""
        venue = _first_published_venue(demo_client)
        ev = _create_draft_event(demo_client, "TI121 free fee-only", pricing_type="free")
        r = demo_client.put(
            f"{API}/events/me/{ev['id']}/venue",
            json={
                "venue_id": venue["id"],
                "locality_pricing": [
                    {
                        "locality_id": "any-locality",
                        "price_cents": 0,
                        "admin_fee_cents": 500,
                    }
                ],
            },
        )
        assert r.status_code == 422, r.text

