"""
Phase 7 — Seat helpers.

Two responsibilities:
1. Translate between (venue_element, index) ⇄ stable seat_id strings.
2. Compute the seat-by-seat status (available / held / sold) for an event.

Seat-id format (string):
  seat_row_straight | seat_row_curved: "{element_id}::s::{index}"
  seat_individual:                     "{element_id}"
  table_round:                         "{element_id}::c::{index}"
  table_rect:                          "{element_id}::c::{index}"   (idx walks top→right→bottom→left)
  unnumbered_zone:                     NOT a seat — sold as quantity, no map.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger("tys.seats")

SEAT_HOLD_WINDOW_MIN_DEFAULT = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Expand a venue into the list of named seats ──────────────────────────
def _row_seat_label(element: Dict[str, Any], i: int) -> str:
    seats = element.get("seats_count") or 0
    start = element.get("numbering_start") or 1
    direction = element.get("numbering_direction") or "ltr"
    if direction == "rtl":
        num = start + seats - 1 - i
    else:
        num = start + i
    return f"{element.get('row_label') or element.get('label') or '?'}-{num}"


def expand_venue_seats(venue: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Returns a flat list of seats for the venue. Each seat:
      {seat_id, label, locality_id, element_id, kind, sub_index, x, y}
    Stage and unnumbered_zone elements are skipped — they're not individually
    addressable.
    """
    out: List[Dict[str, Any]] = []
    for el in venue.get("elements", []):
        kind = el.get("kind")
        if kind in ("stage", "unnumbered_zone"):
            continue
        if kind in ("seat_row_straight", "seat_row_curved"):
            n = int(el.get("seats_count") or 0)
            for i in range(n):
                out.append({
                    "seat_id": f"{el['id']}::s::{i}",
                    "label": _row_seat_label(el, i),
                    "locality_id": el.get("locality_id"),
                    "element_id": el["id"],
                    "kind": kind,
                    "sub_index": i,
                })
        elif kind == "seat_individual":
            out.append({
                "seat_id": el["id"],
                "label": el.get("label") or "Asiento",
                "locality_id": el.get("locality_id"),
                "element_id": el["id"],
                "kind": kind,
                "sub_index": 0,
            })
        elif kind == "table_round":
            n = int(el.get("chairs_count") or 0)
            for i in range(n):
                out.append({
                    "seat_id": f"{el['id']}::c::{i}",
                    "label": f"{el.get('label') or 'Mesa'}-{i + 1}",
                    "locality_id": el.get("locality_id"),
                    "element_id": el["id"],
                    "kind": kind,
                    "sub_index": i,
                })
        elif kind == "table_rect":
            cps = el.get("chairs_per_side") or {}
            idx = 0
            for side in ("top", "right", "bottom", "left"):
                c = int(cps.get(side) or 0)
                for _ in range(c):
                    out.append({
                        "seat_id": f"{el['id']}::c::{idx}",
                        "label": f"{el.get('label') or 'Mesa'}-{idx + 1}",
                        "locality_id": el.get("locality_id"),
                        "element_id": el["id"],
                        "kind": kind,
                        "sub_index": idx,
                    })
                    idx += 1
    return out


def seats_by_id(venue: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {s["seat_id"]: s for s in expand_venue_seats(venue)}


# ── Active locality-pricing validation ──────────────────────────────────
def active_localities(venue: Dict[str, Any]) -> List[str]:
    used: set[str] = set()
    for el in venue.get("elements", []):
        if el.get("kind") in (
            "seat_row_straight", "seat_row_curved", "seat_individual",
            "table_round", "table_rect", "unnumbered_zone",
        ):
            if el.get("locality_id"):
                used.add(el["locality_id"])
    return list(used)


# ── Live status (available / held / sold) for an event ──────────────────
async def compute_event_seats_status(
    *, event: Dict[str, Any], venue: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Returns one entry per seat with its current public status."""
    from database import AsyncSessionLocal
    from orm_models import SeatHold, EventSeatAssignment
    from sqlalchemy import select

    seats = expand_venue_seats(venue)
    now = _now()

    async with AsyncSessionLocal() as session:
        held_result = await session.execute(
            select(SeatHold.seat_id, SeatHold.expires_at, SeatHold.session_token).where(
                SeatHold.event_id == event["id"],
                SeatHold.status == "held",
                SeatHold.expires_at > now,
            )
        )
        held: Dict[str, Dict[str, Any]] = {
            row.seat_id: {"expires_at": row.expires_at, "session_token": row.session_token}
            for row in held_result.all()
        }

        sold_result = await session.execute(
            select(EventSeatAssignment.seat_id).where(
                EventSeatAssignment.event_id == event["id"]
            )
        )
        sold = {row.seat_id for row in sold_result.all()}

    for s in seats:
        if s["seat_id"] in sold:
            s["status"] = "sold"
        elif s["seat_id"] in held:
            s["status"] = "held"
            exp = held[s["seat_id"]]["expires_at"]
            s["expires_at"] = exp.isoformat() if hasattr(exp, "isoformat") else exp
        else:
            s["status"] = "available"
    return seats


# ── Hold mutations ──────────────────────────────────────────────────────
async def create_seat_holds(
    *, event_id: str, venue_id: str, seat_ids: List[str],
    session_token: str, buyer_email: Optional[str] = None,
    window_minutes: int = SEAT_HOLD_WINDOW_MIN_DEFAULT,
) -> List[Dict[str, Any]]:
    """
    Atomically:
      - Check no requested seat is already sold OR currently held by ANOTHER session.
      - (Re-holds for the SAME session_token are allowed — extends the lock.)
      - Insert one seat_holds row per seat with status=held, expires_at=now+window.
    Raises if anything is unavailable.
    """
    from fastapi import HTTPException
    from database import AsyncSessionLocal
    from orm_models import SeatHold, EventSeatAssignment
    from sqlalchemy import select, delete
    from db_helpers import row_to_dict

    now = _now()
    expires = now + timedelta(minutes=window_minutes)

    async with AsyncSessionLocal() as session:
        # 1. Verify no sold seats
        sold_result = await session.execute(
            select(EventSeatAssignment.seat_id).where(
                EventSeatAssignment.event_id == event_id,
                EventSeatAssignment.seat_id.in_(seat_ids),
            )
        )
        sold_ids = {row.seat_id for row in sold_result.all()}

        # 2. Verify no held-by-others
        held_result = await session.execute(
            select(SeatHold.seat_id).where(
                SeatHold.event_id == event_id,
                SeatHold.seat_id.in_(seat_ids),
                SeatHold.status == "held",
                SeatHold.expires_at > now,
                SeatHold.session_token != session_token,
            )
        )
        held_ids = {row.seat_id for row in held_result.all()}

        conflicts = sold_ids | held_ids
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "error": "seats_unavailable",
                    "unavailable_seat_ids": list(conflicts),
                    "message": f"{len(conflicts)} asiento(s) ya no están disponibles.",
                },
            )

        # 3. Release any previous holds of this session for these seats
        await session.execute(
            delete(SeatHold).where(
                SeatHold.event_id == event_id,
                SeatHold.seat_id.in_(seat_ids),
                SeatHold.session_token == session_token,
            )
        )

        # 4. Insert new holds
        hold_rows = []
        for sid in seat_ids:
            hold = SeatHold(
                id=str(uuid.uuid4()),
                event_id=event_id,
                venue_id=venue_id,
                seat_id=sid,
                session_token=session_token,
                buyer_email=buyer_email,
                status="held",
                held_at=now,
                expires_at=expires,
            )
            session.add(hold)
            hold_rows.append(hold)

        await session.commit()
        for h in hold_rows:
            await session.refresh(h)
        return [row_to_dict(h) for h in hold_rows]


async def release_holds_for_session(*, event_id: str, session_token: str) -> int:
    from database import AsyncSessionLocal
    from orm_models import SeatHold
    from sqlalchemy import delete

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            delete(SeatHold).where(
                SeatHold.event_id == event_id,
                SeatHold.session_token == session_token,
                SeatHold.status == "held",
            ).execution_options(synchronize_session=False)
        )
        await session.commit()
    return result.rowcount or 0


async def consume_holds_for_order(
    *, event_id: str, session_token: str, seat_ids: List[str], order_id: str,
) -> None:
    """Transitions held → converted at order-creation time."""
    from fastapi import HTTPException
    from database import AsyncSessionLocal
    from orm_models import SeatHold
    from sqlalchemy import update

    now = _now()
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            update(SeatHold)
            .where(
                SeatHold.event_id == event_id,
                SeatHold.seat_id.in_(seat_ids),
                SeatHold.session_token == session_token,
                SeatHold.status == "held",
                SeatHold.expires_at > now,
            )
            .values(status="converted", order_id=order_id)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
    if result.rowcount != len(seat_ids):
        raise HTTPException(
            status_code=409,
            detail="Algunas reservas vencieron. Volvé al mapa y elegí asientos.",
        )


async def assign_seats_to_tickets(
    *, event_id: str, venue: Dict[str, Any], order: Dict[str, Any],
    tickets: List[Dict[str, Any]],
) -> None:
    """
    Called from finalize_paid_order when the order has seat_ids.
    Each ticket is bound to one seat (in the same order as seat_ids).
    Records event_seat_assignments + sets the ticket's seat_label.
    """
    from database import AsyncSessionLocal
    from orm_models import Ticket as TicketModel, EventSeatAssignment
    from sqlalchemy import update

    seat_ids = order.get("seat_ids") or []
    if not seat_ids:
        return

    by_id = seats_by_id(venue)
    now = _now()

    async with AsyncSessionLocal() as session:
        for ticket, sid in zip(tickets, seat_ids, strict=False):
            seat = by_id.get(sid)
            if not seat:
                logger.warning("seat_id %s not found in venue at assignment time", sid)
                continue
            label = seat["label"]
            loc_id = seat.get("locality_id")
            loc = next((it for it in venue.get("localities", []) if it["id"] == loc_id), None)
            full_label = f"{label} · {loc['name']}" if loc else label

            await session.execute(
                update(TicketModel)
                .where(TicketModel.id == ticket["id"])
                .values(seat_label=full_label, seat_id=sid, locality_id=loc_id)
                .execution_options(synchronize_session=False)
            )
            ticket["seat_label"] = full_label
            ticket["seat_id"] = sid
            ticket["locality_id"] = loc_id

            session.add(EventSeatAssignment(
                id=ticket["id"],  # 1:1 with ticket
                event_id=event_id,
                venue_id=venue["id"],
                seat_id=sid,
                ticket_id=ticket["id"],
                order_id=order["id"],
                holder_email=(order.get("buyer") or {}).get("email"),
                locality_id=loc_id,
                assigned_at=now,
            ))
        await session.commit()


async def release_seat_holds_for_order(order_id: str) -> int:
    """Called when an order is cancelled/rejected — frees its converted holds."""
    from database import AsyncSessionLocal
    from orm_models import SeatHold
    from sqlalchemy import delete

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            delete(SeatHold).where(SeatHold.order_id == order_id)
            .execution_options(synchronize_session=False)
        )
        await session.commit()
    return result.rowcount or 0
