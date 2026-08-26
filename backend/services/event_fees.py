"""
Pre-event platform fee calculator.

fee = (ticket_units * per_ticket_cents) + (estimated_gmv_cents * percent_bps / 10000)

Configurable per subscription plan from the superadmin panel.
Charged before the event can be published / started.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import or_, select
from sqlalchemy.orm.attributes import flag_modified


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
    platform_required: bool = True,
) -> Dict[str, Any]:
    """Return fee breakdown.

    Waived when the platform master switch is off or the plan does not
    enable event fees.
    """
    waived = {
        "enabled": False,
        "fee_cents": 0,
        "status": "waived",
        "ticket_units": 0,
        "estimated_gmv_cents": 0,
        "per_ticket_cents": 0,
        "percent_bps": 0,
        "ticket_component_cents": 0,
        "gmv_component_cents": 0,
        "platform_required": bool(platform_required),
    }
    if not platform_required or not plan.get("event_fee_enabled"):
        return waived

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
        "platform_required": True,
    }


def fee_session_id(event_id: str) -> str:
    """Stable Paymentez/DEUNA client_unique_id for a pre-event fee checkout."""
    return f"pef{str(event_id).replace('-', '')}"


async def find_event_by_fee_session(session, *candidates: str):
    """Look up an event whose pending fee checkout used this session/order id."""
    from orm_models import Event

    ids = [str(c).strip() for c in candidates if c]
    if not ids:
        return None
    clauses = [Event.pre_event_fee_breakdown["session_id"].astext == c for c in ids]
    return await session.scalar(select(Event).where(or_(*clauses)))


def mark_pre_event_fee_paid(
    row,
    *,
    transaction_id: Optional[str] = None,
    payment_method: Optional[str] = None,
) -> bool:
    """Mark the event fee paid. Returns False if it was already paid."""
    if (getattr(row, "pre_event_fee_status", None) or "") == "paid":
        return False
    row.pre_event_fee_status = "paid"
    row.pre_event_fee_paid_at = datetime.now(timezone.utc)
    breakdown = dict(row.pre_event_fee_breakdown or {})
    if transaction_id:
        breakdown["transaction_id"] = transaction_id
    if payment_method:
        breakdown["payment_method"] = payment_method
    row.pre_event_fee_breakdown = breakdown
    flag_modified(row, "pre_event_fee_breakdown")
    return True
