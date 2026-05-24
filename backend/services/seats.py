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
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

from db import db

logger = logging.getLogger("tys.seats")

SEAT_HOLD_WINDOW_MIN_DEFAULT = 10


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


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


# ── Live status (available / held / sold) for an event ──────────────────
async def compute_event_seats_status(
    *, event: Dict[str, Any], venue: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Returns one entry per seat with its current public status."""
    seats = expand_venue_seats(venue)
    now_iso = _now_iso()
    held_cursor = db.seat_holds.find(
        {
            "event_id": event["id"],
            "status": "held",
            "expires_at": {"$gt": now_iso},
        },
        {"_id": 0, "seat_id": 1, "expires_at": 1, "holder.session_token": 1},
    )
    held: Dict[str, Dict[str, Any]] = {}
    async for h in held_cursor:
        held[h["seat_id"]] = h

    sold_cursor = db.event_seat_assignments.find(
        {"event_id": event["id"]}, {"_id": 0, "seat_id": 1},
    )
    sold = set()
    async for r in sold_cursor:
        sold.add(r["seat_id"])

    for s in seats:
        if s["seat_id"] in sold:
            s["status"] = "sold"
        elif s["seat_id"] in held:
            s["status"] = "held"
            s["expires_at"] = held[s["seat_id"]].get("expires_at")
        else:
            s["status"] = "available"
    return seats


# ── Active locality-pricing validation ──────────────────────────────────
def active_localities(venue: Dict[str, Any]) -> List[str]:
    """List of locality_ids that are referenced by at least one addressable element."""
    used: set[str] = set()
    for el in venue.get("elements", []):
        if el.get("kind") in (
            "seat_row_straight", "seat_row_curved", "seat_individual",
            "table_round", "table_rect", "unnumbered_zone",
        ):
            if el.get("locality_id"):
                used.add(el["locality_id"])
    return list(used)


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

    now_iso = _now_iso()
    expires = (_now() + timedelta(minutes=window_minutes)).isoformat()

    # 1. Verify availability
    sold = await db.event_seat_assignments.find(
        {"event_id": event_id, "seat_id": {"$in": seat_ids}}, {"_id": 0, "seat_id": 1},
    ).to_list(length=None)
    sold_ids = {s["seat_id"] for s in sold}
    held_others = await db.seat_holds.find(
        {
            "event_id": event_id, "seat_id": {"$in": seat_ids},
            "status": "held", "expires_at": {"$gt": now_iso},
            "holder.session_token": {"$ne": session_token},
        },
        {"_id": 0, "seat_id": 1},
    ).to_list(length=None)
    held_ids = {h["seat_id"] for h in held_others}
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

    # 2. Release any previous holds of this session for these seats (extension).
    await db.seat_holds.delete_many({
        "event_id": event_id, "seat_id": {"$in": seat_ids},
        "holder.session_token": session_token,
    })

    # 3. Insert new holds
    import uuid
    rows = []
    for sid in seat_ids:
        rows.append({
            "id": str(uuid.uuid4()),
            "event_id": event_id,
            "venue_id": venue_id,
            "seat_id": sid,
            "holder": {"session_token": session_token, "buyer_email": buyer_email},
            "status": "held",
            "held_at": now_iso,
            "expires_at": expires,
            "order_id": None,
        })
    if rows:
        await db.seat_holds.insert_many(rows)
    # Strip Mongo's auto-injected _id before returning
    for r in rows:
        r.pop("_id", None)
    return rows


async def release_holds_for_session(*, event_id: str, session_token: str) -> int:
    res = await db.seat_holds.delete_many({
        "event_id": event_id,
        "holder.session_token": session_token,
        "status": "held",
    })
    return res.deleted_count or 0


async def consume_holds_for_order(
    *, event_id: str, session_token: str, seat_ids: List[str], order_id: str,
) -> None:
    """Transitions held → converted at order-creation time."""
    from fastapi import HTTPException
    now_iso = _now_iso()
    res = await db.seat_holds.update_many(
        {
            "event_id": event_id,
            "seat_id": {"$in": seat_ids},
            "holder.session_token": session_token,
            "status": "held",
            "expires_at": {"$gt": now_iso},
        },
        {"$set": {"status": "converted", "order_id": order_id, "updated_at": now_iso}},
    )
    if res.modified_count != len(seat_ids):
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
    seat_ids = order.get("seat_ids") or []
    if not seat_ids:
        return
    by_id = seats_by_id(venue)
    now_iso = _now_iso()
    assignments = []
    for ticket, sid in zip(tickets, seat_ids, strict=False):
        seat = by_id.get(sid)
        if not seat:
            logger.warning("seat_id %s not found in venue at assignment time", sid)
            continue
        label = seat["label"]
        loc_id = seat.get("locality_id")
        # Resolve locality name from venue.localities[]
        loc = next((it for it in venue.get("localities", []) if it["id"] == loc_id), None)
        full_label = f"{label} · {loc['name']}" if loc else label
        await db.tickets.update_one(
            {"id": ticket["id"]},
            {"$set": {"seat_label": full_label, "seat_id": sid, "locality_id": loc_id}},
        )
        ticket["seat_label"] = full_label
        ticket["seat_id"] = sid
        ticket["locality_id"] = loc_id
        assignments.append({
            "id": ticket["id"],  # 1:1 with ticket for simpler lookup
            "event_id": event_id,
            "venue_id": venue["id"],
            "seat_id": sid,
            "ticket_id": ticket["id"],
            "order_id": order["id"],
            "holder_email": (order.get("buyer") or {}).get("email"),
            "locality_id": loc_id,
            "assigned_at": now_iso,
        })
    if assignments:
        await db.event_seat_assignments.insert_many(assignments)


async def release_seat_holds_for_order(order_id: str) -> int:
    """Called when an order is cancelled/rejected — frees its converted holds."""
    res = await db.seat_holds.delete_many({"order_id": order_id})
    return res.deleted_count or 0
