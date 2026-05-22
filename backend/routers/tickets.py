"""
Organizer-facing endpoints for ticket orders / tickets / stats,
plus the cross-cutting `/api/tickets/validate` for QR scanning.
"""
import csv
import io
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from db import db
from security import get_current_user
from services import order_service
from services.ticket_jwt import verify_ticket_token
from datetime import datetime, timezone

logger = logging.getLogger("tys.tickets")

router = APIRouter(prefix="/api", tags=["tickets"])


async def _require_event_for_user(event_id: str, user) -> tuple[dict, dict]:
    if not user.get("organizer_id"):
        raise HTTPException(403, "No organizer profile")
    organizer = await db.organizers.find_one({"id": user["organizer_id"]}, {"_id": 0})
    if not organizer:
        raise HTTPException(404, "Organizer not found")
    event = await db.events.find_one(
        {"id": event_id, "organizer_id": organizer["id"]}, {"_id": 0}
    )
    if not event:
        raise HTTPException(404, "Event not found")
    return organizer, event


@router.get("/events/me/{event_id}/orders")
async def list_event_orders(
    event_id: str,
    user=Depends(get_current_user),
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    _org, _event = await _require_event_for_user(event_id, user)
    query: dict = {"event_id": event_id}
    if status:
        query["status"] = status
    total = await db.ticket_orders.count_documents(query)
    cursor = (
        db.ticket_orders.find(query, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [d async for d in cursor]
    return {"items": items, "total": total}


@router.get("/events/me/{event_id}/orders/{order_id}")
async def organizer_get_order(
    event_id: str, order_id: str, user=Depends(get_current_user)
):
    _org, _event = await _require_event_for_user(event_id, user)
    order = await db.ticket_orders.find_one(
        {"id": order_id, "event_id": event_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(404, "Order not found")
    tickets_cursor = db.tickets.find({"order_id": order_id}, {"_id": 0})
    tickets = [t async for t in tickets_cursor]
    return {"order": order, "tickets": tickets}


@router.get("/events/me/{event_id}/tickets")
async def list_event_tickets(event_id: str, user=Depends(get_current_user)):
    _org, _event = await _require_event_for_user(event_id, user)
    cursor = db.tickets.find({"event_id": event_id}, {"_id": 0}).sort("issued_at", -1)
    items = [t async for t in cursor]
    return {"items": items, "total": len(items)}


@router.get("/events/me/{event_id}/tickets.csv")
async def export_event_tickets_csv(event_id: str, user=Depends(get_current_user)):
    _org, event = await _require_event_for_user(event_id, user)
    cursor = db.tickets.find({"event_id": event_id}, {"_id": 0})
    tickets = [t async for t in cursor]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ticket_id", "order_id", "holder_name", "holder_email", "status", "issued_at", "used_at"])
    for t in tickets:
        h = t.get("holder") or {}
        w.writerow(
            [
                t["id"],
                t.get("order_id", ""),
                h.get("name", ""),
                h.get("email", ""),
                t.get("status", ""),
                t.get("issued_at", ""),
                t.get("used_at", "") or "",
            ]
        )
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="tickets-{event["slug"]}.csv"'
        },
    )


@router.get("/events/me/{event_id}/stats")
async def event_stats(event_id: str, user=Depends(get_current_user)):
    _org, event = await _require_event_for_user(event_id, user)

    paid_orders = await db.ticket_orders.count_documents(
        {"event_id": event_id, "status": "paid"}
    )
    pending_orders = await db.ticket_orders.count_documents(
        {"event_id": event_id, "status": "pending"}
    )
    total_orders = await db.ticket_orders.count_documents({"event_id": event_id})

    # Revenue sum.
    revenue_cents = 0
    fees_cents = 0
    cursor = db.ticket_orders.find(
        {"event_id": event_id, "status": "paid"},
        {"_id": 0, "subtotal_cents": 1, "fees_cents": 1},
    )
    async for o in cursor:
        revenue_cents += o.get("subtotal_cents") or 0
        fees_cents += o.get("fees_cents") or 0

    issued = await db.tickets.count_documents(
        {"event_id": event_id, "status": "issued"}
    )
    used = await db.tickets.count_documents({"event_id": event_id, "status": "used"})

    avail = await order_service.compute_availability(event)
    conv = (paid_orders / total_orders) if total_orders else 0.0

    return {
        "total_orders": total_orders,
        "paid_orders": paid_orders,
        "pending_orders": pending_orders,
        "tickets_issued": issued,
        "tickets_used": used,
        "capacity": avail["capacity"],
        "sold": avail["sold"],
        "available": avail["available"],
        "revenue_cents": revenue_cents,
        "fees_cents": fees_cents,
        "net_revenue_cents": revenue_cents - fees_cents,
        "conversion_rate": conv,
    }


# ── Refund + resend ─────────────────────────────────────────────────────────
class RefundBody(BaseModel):
    reason: str = Field(default="", max_length=400)


@router.post("/events/me/{event_id}/orders/{order_id}/refund")
async def organizer_refund_order(
    event_id: str,
    order_id: str,
    payload: RefundBody,
    user=Depends(get_current_user),
):
    _org, _event = await _require_event_for_user(event_id, user)
    order = await db.ticket_orders.find_one(
        {"id": order_id, "event_id": event_id}, {"_id": 0}
    )
    if not order:
        raise HTTPException(404, "Order not found")
    refunded = await order_service.refund_order(order=order, reason=payload.reason)
    return refunded


@router.post("/events/me/{event_id}/orders/{order_id}/resend-email")
async def organizer_resend_email(
    event_id: str, order_id: str, user=Depends(get_current_user)
):
    _org, event = await _require_event_for_user(event_id, user)
    order = await db.ticket_orders.find_one(
        {"id": order_id, "event_id": event_id}, {"_id": 0}
    )
    if not order or order["status"] != "paid":
        raise HTTPException(404, "Order not found or not paid")
    organizer = await db.organizers.find_one({"id": order["organizer_id"]}, {"_id": 0})
    tickets_cursor = db.tickets.find({"order_id": order_id}, {"_id": 0})
    tickets = [t async for t in tickets_cursor]
    from services.email_service import send_purchase_confirmation
    await send_purchase_confirmation(
        order=order, event=event, organizer=organizer, tickets=tickets
    )
    return {"ok": True}


# ── Ticket validation (Fase 5 UI consumes this) ─────────────────────────────
class ValidateBody(BaseModel):
    qr_token: str


@router.post("/tickets/validate")
async def validate_ticket(payload: ValidateBody, user=Depends(get_current_user)):
    """
    Decodes the QR JWT, ensures the ticket belongs to one of the user's events,
    and marks it as used (idempotent: returns reason=already_used if so).
    """
    try:
        claims = verify_ticket_token(payload.qr_token)
    except ValueError as e:
        return {"valid": False, "reason": "invalid_token", "detail": str(e)}

    ticket_id = claims.get("ticket_id")
    ticket = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not ticket:
        return {"valid": False, "reason": "not_found"}

    # RBAC: super_admin can validate any; organizer only own events.
    if user.get("role") != "super_admin":
        if ticket.get("organizer_id") != user.get("organizer_id"):
            raise HTTPException(403, "Ticket belongs to another organizer")

    if ticket["status"] == "used":
        return {
            "valid": False,
            "reason": "already_used",
            "used_at": ticket.get("used_at"),
            "ticket": ticket,
        }
    if ticket["status"] == "revoked":
        return {"valid": False, "reason": "revoked", "ticket": ticket}

    now_iso = datetime.now(timezone.utc).isoformat()
    await db.tickets.update_one(
        {"id": ticket_id},
        {"$set": {"status": "used", "used_at": now_iso, "used_by": user["id"]}},
    )
    refreshed = await db.tickets.find_one({"id": ticket_id}, {"_id": 0})
    holder = refreshed.get("holder") or {}
    logger.info("Ticket %s validated by user=%s", ticket_id, user["id"])
    return {"valid": True, "ticket": refreshed, "holder": holder}
