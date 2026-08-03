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


def _create_draft_event(client: requests.Session, title: str) -> dict:
    slug = f"snap-{uuid.uuid4().hex[:8]}"
    from datetime import datetime, timedelta, timezone

    starts = datetime.now(timezone.utc) + timedelta(days=30)
    ends = starts + timedelta(hours=2)
    r = client.post(
        f"{API}/events/me",
        json={
            "title": title,
            "slug": slug,
            "pricing_type": "paid",
            "base_price_cents": 1000,
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
