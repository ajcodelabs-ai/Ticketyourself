"""Unit tests for event-scoped venue layout snapshots."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from services.event_venue import (
    compute_capacity,
    layout_as_venue,
    locality_structural_diff,
    recalc_layout_capacity,
    resolve_event_venue,
    snapshot_from_venue,
    structural_diff,
)


def _sample_venue():
    return {
        "id": "venue-master-1",
        "slug": "teatro-a",
        "name": "Teatro A",
        "organizer_id": "org-1",
        "tenant_slug": "demo-org",
        "status": "published",
        "canvas": {"width": 800, "height": 600},
        "elements": [
            {
                "id": "el-row-a",
                "kind": "seat_row_straight",
                "x": 10,
                "y": 20,
                "seats_count": 5,
                "locality_id": "loc-platea",
                "row_label": "A",
            },
        ],
        "localities": [
            {
                "id": "loc-platea",
                "name": "Platea",
                "color": "#112233",
                "default_price_cents": 1500,
            },
        ],
        "capacity_calculated": 5,
    }


def test_snapshot_copies_shape_only_without_localities():
    venue = _sample_venue()
    snap = snapshot_from_venue(venue)
    assert snap["source_venue_id"] == "venue-master-1"
    assert snap["elements"][0]["id"] == "el-row-a"
    # Shape only: master locality assignments are stripped; event owns localities.
    assert snap["elements"][0]["locality_id"] is None
    assert snap["localities"] == []
    assert snap["capacity_calculated"] == 5
    assert "snapshotted_at" in snap
    # Deep copy: mutating snapshot must not touch master
    snap["elements"][0]["seats_count"] = 99
    assert venue["elements"][0]["seats_count"] == 5
    assert venue["elements"][0]["locality_id"] == "loc-platea"
    assert venue["localities"][0]["id"] == "loc-platea"


def test_layout_as_venue_and_resolve_prefers_snapshot():
    event = {
        "id": "ev-aa",
        "venue_id": "venue-master-1",
        "source_venue_id": "venue-master-1",
        "venue_name": "Teatro A",
        "venue_slug": "teatro-a",
        "organizer_id": "org-1",
        "tenant_slug": "demo-org",
        "venue_layout": snapshot_from_venue(_sample_venue()),
    }
    event["venue_layout"]["elements"][0]["seats_count"] = 8
    as_v = layout_as_venue(event)
    assert as_v is not None
    assert as_v["is_event_snapshot"] is True
    assert as_v["elements"][0]["seats_count"] == 8
    assert as_v["id"] == "venue-master-1"
    # resolve with layout present must not need DB
    import asyncio

    resolved = asyncio.run(resolve_event_venue(event))
    assert resolved["is_event_snapshot"] is True
    assert resolved["elements"][0]["seats_count"] == 8


def test_structural_diff_detects_seat_count_change():
    old = _sample_venue()["elements"]
    new = [{**old[0], "seats_count": 6}]
    assert structural_diff(old, new) is True
    assert structural_diff(old, old) is False


def test_locality_structural_diff_detects_color():
    old = _sample_venue()["localities"]
    new = [{**old[0], "color": "#ffffff"}]
    assert locality_structural_diff(old, new) is True


def test_plan_layout_seating_conflict():
    from services.event_venue import plan_layout_seating_conflict

    seats = [{"kind": "seat_individual"}]
    mixed = [{"kind": "seat_row_straight"}, {"kind": "unnumbered_zone"}]
    zones = [{"kind": "unnumbered_zone"}]
    assert plan_layout_seating_conflict(seats, True) == "none"
    assert plan_layout_seating_conflict(zones, False) == "none"
    assert plan_layout_seating_conflict(mixed, False) == "numbered_unused"
    assert plan_layout_seating_conflict(seats, False) == "numbered_only_blocked"


def test_locality_structural_diff_mixed_equals_numbered():
    from services.event_venue import normalize_layout_localities

    loc = {
        "id": "l1",
        "color": "#111",
        "default_price_cents": 1000,
        "seating_type": "mixed",
    }
    numbered = {**loc, "seating_type": "numbered"}
    unnumbered = {**loc, "seating_type": "unnumbered"}
    assert locality_structural_diff([loc], [numbered]) is False
    assert locality_structural_diff([loc], [unnumbered]) is True
    assert normalize_layout_localities([loc])[0]["seating_type"] == "numbered"


def test_compute_capacity_and_recalc():
    els = _sample_venue()["elements"]
    assert compute_capacity(els) == 5
    layout = {"elements": els}
    assert recalc_layout_capacity(layout) == 5
    assert layout["capacity_calculated"] == 5
