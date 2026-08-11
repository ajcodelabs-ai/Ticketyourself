"""
Pre-event platform fee calculator.

fee = (ticket_units * per_ticket_cents) + (estimated_gmv_cents * percent_bps / 10000)

Configurable per subscription plan from the superadmin panel.
Charged before the event can be published / started.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional


def _ticket_units_and_gmv(
    event: dict, ticket_types: Optional[List[dict]] = None
) -> tuple[int, int]:
    """Estimate capacity units and GMV from ticket types or locality pricing."""
    units = 0
    gmv = 0
    types = ticket_types or event.get("ticket_types") or []
    if types:
        for tt in types:
            qty = int(tt.get("quantity") or tt.get("capacity") or 0)
            price = int(tt.get("price_cents") or 0)
            units += max(qty, 0)
            gmv += max(qty, 0) * max(price, 0)
        if units:
            return units, gmv

    # Numbered: sum locality capacities × prices
    layout = event.get("venue_layout") or {}
    localities = layout.get("localities") or event.get("localities") or []
    pricing = {
        p.get("locality_id"): p
        for p in (event.get("locality_pricing") or [])
        if p.get("locality_id")
    }
    for loc in localities:
        lid = loc.get("id")
        cap = int(loc.get("capacity") or loc.get("seat_count") or 0)
        price = int((pricing.get(lid) or {}).get("price_cents") or 0)
        units += max(cap, 0)
        gmv += max(cap, 0) * max(price, 0)

    if not units:
        # Fallback: max_tickets_per_event style capacity on event
        units = int(event.get("capacity") or event.get("capacity_calculated") or 0)
    return units, gmv


def calculate_pre_event_fee(
    *,
    plan: dict,
    event: dict,
    ticket_types: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Return fee breakdown. If plan.event_fee_enabled is false → 0 / waived."""
    if not plan.get("event_fee_enabled"):
        return {
            "enabled": False,
            "fee_cents": 0,
            "status": "waived",
            "ticket_units": 0,
            "estimated_gmv_cents": 0,
            "per_ticket_cents": 0,
            "percent_bps": 0,
            "ticket_component_cents": 0,
            "gmv_component_cents": 0,
        }

    per_ticket = int(plan.get("event_fee_per_ticket_cents") or 0)
    percent_bps = int(plan.get("event_fee_percent_bps") or 0)
    units, gmv = _ticket_units_and_gmv(event, ticket_types)
    ticket_component = units * per_ticket
    gmv_component = (gmv * percent_bps) // 10_000 if percent_bps else 0
    total = ticket_component + gmv_component

    return {
        "enabled": True,
        "fee_cents": max(total, 0),
        "status": "pending" if total > 0 else "waived",
        "ticket_units": units,
        "estimated_gmv_cents": gmv,
        "per_ticket_cents": per_ticket,
        "percent_bps": percent_bps,
        "ticket_component_cents": ticket_component,
        "gmv_component_cents": gmv_component,
    }
