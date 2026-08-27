"""Event-scoped venue layout (snapshot) helpers.

When an event links a master venue, we deep-copy only the *shape* (canvas +
elements) into `event.venue_layout`. Locality names, colors and prices belong
to the event — they are created later in the Localidades tab — so master
venue localities and element locality_id assignments are not copied.

Runtime (purchase, holds, public map) resolves that snapshot first so two
events can share the same master Teatro without sharing edits.
"""

from __future__ import annotations

import copy
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from db_helpers import get_venue_by_id


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def compute_capacity(elements: List[Dict[str, Any]]) -> int:
    """Sum of seat counts across element kinds that contribute (mirrors venues router)."""
    total = 0
    for e in elements or []:
        k = e.get("kind")
        if k == "unnumbered_zone":
            total += int(e.get("capacity") or 0)
        elif k in ("seat_row_straight", "seat_row_curved"):
            total += int(e.get("seats_count") or 0)
        elif k == "seat_individual":
            total += 1
        elif k == "table_round":
            total += int(e.get("chairs_count") or 0)
        elif k == "table_rect":
            cps = e.get("chairs_per_side") or {}
            total += sum(
                int(cps.get(s) or 0) for s in ("top", "right", "bottom", "left")
            )
    return total


def _strip_locality_assignments(elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Clear locality_id on elements so the event assigns its own localities."""
    cleaned: List[Dict[str, Any]] = []
    for el in elements or []:
        next_el = dict(el)
        if "locality_id" in next_el:
            next_el["locality_id"] = None
        cleaned.append(next_el)
    return cleaned


def snapshot_from_venue(venue: Dict[str, Any]) -> Dict[str, Any]:
    """Deep-copy map shape only. Localities start empty — they are event-owned."""
    venue_id = venue.get("id")
    elements = _strip_locality_assignments(copy.deepcopy(venue.get("elements") or []))
    return {
        "canvas": copy.deepcopy(venue.get("canvas") or {}),
        "elements": elements,
        "localities": [],
        "capacity_calculated": int(
            venue.get("capacity_calculated") or compute_capacity(elements) or 0
        ),
        "snapshotted_at": _now_iso(),
        "source_venue_id": venue_id,
    }


def layout_as_venue(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Build a venue-shaped dict from event.venue_layout, or None if missing."""
    layout = event.get("venue_layout")
    if not layout or not isinstance(layout, dict):
        return None
    source = (
        event.get("source_venue_id")
        or event.get("venue_id")
        or layout.get("source_venue_id")
    )
    return {
        "id": source,
        "slug": event.get("venue_slug"),
        "name": event.get("venue_name") or "Mapa del evento",
        "canvas": layout.get("canvas") or {},
        "elements": layout.get("elements") or [],
        "localities": layout.get("localities") or [],
        "capacity_calculated": int(layout.get("capacity_calculated") or 0),
        "status": "published",
        "organizer_id": event.get("organizer_id"),
        "tenant_slug": event.get("tenant_slug"),
        "is_event_snapshot": True,
        "source_venue_id": source,
    }


async def resolve_event_venue(event: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Prefer event.venue_layout; fall back to live master venue (legacy)."""
    snap = layout_as_venue(event)
    if snap is not None:
        return snap
    vid = event.get("venue_id")
    if not vid:
        return None
    return await get_venue_by_id(vid)


def recalc_layout_capacity(layout: Dict[str, Any]) -> int:
    """Recompute capacity from elements; mutate layout and return the value."""
    cap = compute_capacity(layout.get("elements") or [])
    layout["capacity_calculated"] = int(cap or 0)
    return layout["capacity_calculated"]


def structural_diff(old: List[Dict[str, Any]], new: List[Dict[str, Any]]) -> bool:
    """True if add/delete/move/resize/kind/locality changed (ignores labels)."""
    if len(old) != len(new):
        return True
    by_id_old = {e["id"]: e for e in old}
    by_id_new = {e["id"]: e for e in new}
    if set(by_id_old) != set(by_id_new):
        return True
    keys_structural = (
        "x",
        "y",
        "width",
        "height",
        "rotation",
        "kind",
        "seats_count",
        "capacity",
        "locality_id",
    )
    for k, a in by_id_old.items():
        b = by_id_new[k]
        for kk in keys_structural:
            if a.get(kk) != b.get(kk):
                return True
    return False


def locality_structural_diff(
    old: List[Dict[str, Any]], new: List[Dict[str, Any]]
) -> bool:
    if len(old) != len(new):
        return True
    by_id_old = {it["id"]: it for it in old}
    by_id_new = {it["id"]: it for it in new}
    if set(by_id_old) != set(by_id_new):
        return True
    for k, a in by_id_old.items():
        b = by_id_new[k]
        if a.get("color") != b.get("color"):
            return True
        if a.get("default_price_cents") != b.get("default_price_cents"):
            return True
        if _normalize_seating_type(a.get("seating_type")) != _normalize_seating_type(
            b.get("seating_type")
        ):
            return True
    return False


_SEAT_KINDS = frozenset(
    {
        "seat_row_straight",
        "seat_row_curved",
        "seat_individual",
        "table_round",
        "table_rect",
    }
)


def plan_layout_seating_conflict(
    elements: List[Dict[str, Any]] | None, allow_numbered: bool
) -> str:
    """How a layout collides with a plan that has no numbered seating.

    none — no seats, or the plan allows butacas.
    numbered_unused — mixed map: GA zones can sell; seats stay unsellable.
    numbered_only_blocked — seat-only map cannot be published/sold.
    """
    if allow_numbered:
        return "none"
    seats = any((e or {}).get("kind") in _SEAT_KINDS for e in elements or [])
    if not seats:
        return "none"
    zones = any((e or {}).get("kind") == "unnumbered_zone" for e in elements or [])
    return "numbered_unused" if zones else "numbered_only_blocked"


def _normalize_seating_type(value: Any) -> str:
    """Localities are numbered or unnumbered. Legacy `mixed` ≡ numbered."""
    return "unnumbered" if value == "unnumbered" else "numbered"


def normalize_layout_localities(
    localities: List[Dict[str, Any]] | None,
) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    for loc in localities or []:
        next_loc = dict(loc)
        next_loc["seating_type"] = _normalize_seating_type(next_loc.get("seating_type"))
        out.append(next_loc)
    return out
