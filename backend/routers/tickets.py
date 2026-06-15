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

from datetime import datetime, timedelta, timezone

from database import AsyncSessionLocal, get_db
from db_helpers import get_event_by_id, get_organizer_by_id, get_venue_by_id, row_to_dict
from orm_models import Organizer, Ticket, TicketOrder, TicketScan
from security import get_current_user
from services import order_service
from services.ticket_jwt import verify_ticket_token
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger("tys.tickets")

router = APIRouter(prefix="/api", tags=["tickets"])


async def _require_event_for_user(event_id: str, user) -> tuple[dict, dict]:
    if not user.get("organizer_id"):
        raise HTTPException(403, "No organizer profile")
    organizer = await get_organizer_by_id(user["organizer_id"])
    if not organizer:
        raise HTTPException(404, "Organizer not found")
    from orm_models import Event
    async with AsyncSessionLocal() as pg:
        event_row = await pg.scalar(
            select(Event).where(
                Event.id == event_id, Event.organizer_id == organizer["id"]
            )
        )
    if not event_row:
        raise HTTPException(404, "Event not found")
    return organizer, row_to_dict(event_row)


@router.get("/events/me/{event_id}/orders")
async def list_event_orders(
    event_id: str,
    user=Depends(get_current_user),
    status: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
):
    _org, _event = await _require_event_for_user(event_id, user)
    base = select(TicketOrder).where(TicketOrder.event_id == event_id)
    count_base = select(func.count(TicketOrder.id)).where(TicketOrder.event_id == event_id)
    if status:
        base = base.where(TicketOrder.status == status)
        count_base = count_base.where(TicketOrder.status == status)
    async with AsyncSessionLocal() as session:
        total = await session.scalar(count_base) or 0
        result = await session.execute(
            base.order_by(TicketOrder.created_at.desc())
            .offset((page - 1) * limit).limit(limit)
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total}


@router.get("/events/me/{event_id}/orders/{order_id}")
async def organizer_get_order(
    event_id: str, order_id: str, user=Depends(get_current_user)
):
    _org, _event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(
                TicketOrder.id == order_id, TicketOrder.event_id == event_id
            )
        )
        if not order_row:
            raise HTTPException(404, "Order not found")
        order = row_to_dict(order_row)
        result = await session.execute(
            select(Ticket).where(Ticket.order_id == order_id)
        )
        tickets = [row_to_dict(r) for r in result.scalars().all()]
    return {"order": order, "tickets": tickets}


@router.get("/events/me/{event_id}/tickets")
async def list_event_tickets(event_id: str, user=Depends(get_current_user)):
    _org, _event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Ticket).where(Ticket.event_id == event_id)
            .order_by(Ticket.issued_at.desc())
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": len(items)}


@router.get("/events/me/{event_id}/tickets.csv")
async def export_event_tickets_csv(event_id: str, user=Depends(get_current_user)):
    _org, event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Ticket).where(Ticket.event_id == event_id)
        )
        tickets = [row_to_dict(r) for r in result.scalars().all()]

    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["ticket_id", "order_id", "holder_name", "holder_email", "status", "issued_at", "used_at"])
    for t in tickets:
        h = t.get("holder") or {}
        issued = t.get("issued_at")
        used = t.get("used_at")
        w.writerow([
            t["id"],
            t.get("order_id", ""),
            h.get("name", ""),
            h.get("email", ""),
            t.get("status", ""),
            (issued.isoformat() if hasattr(issued, "isoformat") else str(issued or ""))[:19],
            (used.isoformat() if hasattr(used, "isoformat") else str(used or ""))[:19],
        ])
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

    async with AsyncSessionLocal() as session:
        paid_orders = await session.scalar(
            select(func.count(TicketOrder.id)).where(
                TicketOrder.event_id == event_id, TicketOrder.status == "paid"
            )
        ) or 0
        pending_orders = await session.scalar(
            select(func.count(TicketOrder.id)).where(
                TicketOrder.event_id == event_id, TicketOrder.status == "pending"
            )
        ) or 0
        total_orders = await session.scalar(
            select(func.count(TicketOrder.id)).where(TicketOrder.event_id == event_id)
        ) or 0

        rev_row = (await session.execute(
            select(
                func.coalesce(func.sum(TicketOrder.subtotal_cents), 0).label("revenue"),
                func.coalesce(func.sum(TicketOrder.fees_cents), 0).label("fees"),
            ).where(TicketOrder.event_id == event_id, TicketOrder.status == "paid")
        )).first()
        revenue_cents = rev_row.revenue or 0
        fees_cents = rev_row.fees or 0

        issued = await session.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.event_id == event_id, Ticket.status.in_(["issued", "used"])
            )
        ) or 0
        used = await session.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.event_id == event_id, Ticket.status == "used"
            )
        ) or 0

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
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(
                TicketOrder.id == order_id, TicketOrder.event_id == event_id
            )
        )
    if not order_row:
        raise HTTPException(404, "Order not found")
    order = row_to_dict(order_row)
    refunded = await order_service.refund_order(order=order, reason=payload.reason)
    return refunded


@router.post("/events/me/{event_id}/orders/{order_id}/resend-email")
async def organizer_resend_email(
    event_id: str, order_id: str, user=Depends(get_current_user)
):
    _org, event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(
                TicketOrder.id == order_id, TicketOrder.event_id == event_id
            )
        )
        if not order_row or order_row.status != "paid":
            raise HTTPException(404, "Order not found or not paid")
        order = row_to_dict(order_row)
        result = await session.execute(
            select(Ticket).where(Ticket.order_id == order_id)
        )
        tickets = [row_to_dict(r) for r in result.scalars().all()]
    organizer = await get_organizer_by_id(order["organizer_id"])
    from services.email_service import send_purchase_confirmation
    await send_purchase_confirmation(
        order=order, event=event, organizer=organizer, tickets=tickets
    )
    return {"ok": True}


# ── Manual payment confirm / reject (Phase 5b) ──────────────────────────────
class ConfirmManualBody(BaseModel):
    notes: Optional[str] = Field(default=None, max_length=500)
    reference: Optional[str] = Field(default=None, max_length=120)


class RejectManualBody(BaseModel):
    reason: str = Field(min_length=2, max_length=500)


@router.post("/events/me/{event_id}/orders/{order_id}/confirm-payment")
async def organizer_confirm_payment(
    event_id: str,
    order_id: str,
    payload: ConfirmManualBody,
    user=Depends(get_current_user),
):
    organizer, event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(
                TicketOrder.id == order_id, TicketOrder.event_id == event_id
            )
        )
    if not order_row:
        raise HTTPException(404, "Order not found")
    order = row_to_dict(order_row)
    refreshed, tickets = await order_service.confirm_manual_payment(
        order=order,
        confirmer_user_id=user["id"],
        notes=payload.notes,
        reference=payload.reference,
    )
    try:
        from services.email_service import send_purchase_confirmation
        await send_purchase_confirmation(
            order=refreshed, event=event, organizer=organizer, tickets=tickets
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed sending manual confirmation email")
    try:
        from audit import log_audit
        await log_audit(
            user["id"], "confirm_manual_payment", "ticket_order", refreshed["id"],
            {"order_number": refreshed["order_number"], "reference": payload.reference},
        )
    except Exception:  # noqa: BLE001
        logger.exception("Audit log failed for confirm_manual_payment")
    return {"ok": True, "order": refreshed, "tickets": tickets}


@router.post("/events/me/{event_id}/orders/{order_id}/reject-payment")
async def organizer_reject_payment(
    event_id: str,
    order_id: str,
    payload: RejectManualBody,
    user=Depends(get_current_user),
):
    organizer, event = await _require_event_for_user(event_id, user)
    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(
                TicketOrder.id == order_id, TicketOrder.event_id == event_id
            )
        )
    if not order_row:
        raise HTTPException(404, "Order not found")
    order = row_to_dict(order_row)
    rejected = await order_service.reject_manual_payment(
        order=order, reason=payload.reason, rejecter_user_id=user["id"]
    )
    try:
        from services.email_service import send_manual_payment_rejected
        await send_manual_payment_rejected(
            order=rejected, event=event, organizer=organizer, reason=payload.reason
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed sending manual rejection email")
    try:
        from audit import log_audit
        await log_audit(
            user["id"], "reject_manual_payment", "ticket_order", rejected["id"],
            {"order_number": rejected["order_number"], "reason": payload.reason},
        )
    except Exception:  # noqa: BLE001
        logger.exception("Audit log failed for reject_manual_payment")
    return {"ok": True, "order": rejected}


# ── Ticket validation (QR scan) ─────────────────────────────────────────────
class ValidateBody(BaseModel):
    qr_token: str


async def _log_scan(
    *, event_id: str, ticket_id: Optional[str], scanned_by: str,
    result: str, reason: Optional[str] = None,
    holder_name: Optional[str] = None, seat_label: Optional[str] = None,
) -> None:
    """Append one row to the per-event scan log."""
    import uuid as _uuid
    async with AsyncSessionLocal() as session:
        session.add(TicketScan(
            id=str(_uuid.uuid4()),
            event_id=event_id,
            ticket_id=ticket_id,
            scanned_by=scanned_by,
            scanned_at=datetime.now(timezone.utc),
            result=result,
            reason=reason,
            holder_name=holder_name,
            seat_label=seat_label,
        ))
        await session.commit()


@router.post("/tickets/validate")
async def validate_ticket(payload: ValidateBody, user=Depends(get_current_user)):
    """
    Decodes the QR JWT, ensures the ticket belongs to one of the user's events,
    and marks it as used. Concurrent-safe via SELECT FOR UPDATE on `status`.
    Always writes a row in `ticket_scans` for audit, including rejections.
    """
    try:
        claims = verify_ticket_token(payload.qr_token)
    except ValueError as e:
        await _log_scan(
            event_id="unknown", ticket_id=None, scanned_by=user["id"],
            result="invalid", reason=str(e)[:200],
        )
        return {"valid": False, "reason": "invalid_token", "detail": str(e)}

    ticket_id = claims.get("ticket_id")

    async with AsyncSessionLocal() as session:
        ticket_row = await session.scalar(
            select(Ticket).where(Ticket.id == ticket_id)
        )

    if not ticket_row:
        await _log_scan(
            event_id=claims.get("event_id") or "unknown",
            ticket_id=ticket_id, scanned_by=user["id"],
            result="not_found", reason="ticket-not-found",
        )
        return {"valid": False, "reason": "not_found"}

    ticket = row_to_dict(ticket_row)

    if user.get("role") != "super_admin":
        if ticket.get("organizer_id") != user.get("organizer_id"):
            await _log_scan(
                event_id=ticket.get("event_id"),
                ticket_id=ticket_id, scanned_by=user["id"],
                result="invalid", reason="wrong_organizer",
                holder_name=(ticket.get("holder") or {}).get("name"),
                seat_label=ticket.get("seat_label"),
            )
            raise HTTPException(403, "Ticket belongs to another organizer")

    holder = ticket.get("holder") or {}
    seat_label = ticket.get("seat_label")

    if ticket["status"] == "revoked":
        await _log_scan(
            event_id=ticket["event_id"], ticket_id=ticket_id,
            scanned_by=user["id"], result="revoked",
            holder_name=holder.get("name"), seat_label=seat_label,
        )
        return {"valid": False, "reason": "revoked", "ticket": ticket}

    # Concurrent-safe via SELECT FOR UPDATE
    now = datetime.now(timezone.utc)
    already_used = False
    fresh: dict = {}
    updated_ticket: dict = {}

    async with AsyncSessionLocal() as session:
        async with session.begin():
            row = await session.scalar(
                select(Ticket)
                .where(
                    Ticket.id == ticket_id,
                    Ticket.status.notin_(["used", "revoked"]),
                )
                .with_for_update()
            )
            if not row:
                already_used = True
                fresh_row = await session.scalar(select(Ticket).where(Ticket.id == ticket_id))
                fresh = row_to_dict(fresh_row) if fresh_row else {}
            else:
                row.status = "used"
                row.used_at = now
                row.used_by = user["id"]
                updated_ticket = row_to_dict(row)

    if already_used:
        await _log_scan(
            event_id=ticket["event_id"], ticket_id=ticket_id,
            scanned_by=user["id"], result="already_used",
            holder_name=holder.get("name"), seat_label=seat_label,
        )
        return {
            "valid": False,
            "reason": "already_used",
            "used_at": fresh.get("used_at"),
            "used_by": fresh.get("used_by"),
            "ticket": fresh,
        }

    await _log_scan(
        event_id=ticket["event_id"], ticket_id=ticket_id,
        scanned_by=user["id"], result="valid",
        holder_name=holder.get("name"), seat_label=seat_label,
    )
    logger.info("Ticket %s validated by user=%s", ticket_id, user["id"])
    return {"valid": True, "ticket": updated_ticket, "holder": updated_ticket.get("holder") or {}}


# ── Phase 9: scan log + stats ───────────────────────────────────────────────
@router.get("/events/me/{event_id}/scan-log")
async def get_scan_log(
    event_id: str,
    page: int = 1, limit: int = 50,
    user=Depends(get_current_user),
):
    if user.get("role") != "super_admin":
        ev = await get_event_by_id(event_id)
        if not ev or ev.get("organizer_id") != user.get("organizer_id"):
            raise HTTPException(404, "Evento no encontrado")
    skip = (max(1, page) - 1) * max(1, min(200, limit))
    async with AsyncSessionLocal() as session:
        total = await session.scalar(
            select(func.count(TicketScan.id)).where(TicketScan.event_id == event_id)
        ) or 0
        result = await session.execute(
            select(TicketScan).where(TicketScan.event_id == event_id)
            .order_by(TicketScan.scanned_at.desc())
            .offset(skip).limit(limit)
        )
        items = [row_to_dict(r) for r in result.scalars().all()]
    return {"items": items, "total": total, "page": page, "limit": limit}


@router.get("/events/me/{event_id}/scan-log.csv")
async def get_scan_log_csv(event_id: str, user=Depends(get_current_user)):
    from io import StringIO
    if user.get("role") != "super_admin":
        ev = await get_event_by_id(event_id)
        if not ev or ev.get("organizer_id") != user.get("organizer_id"):
            raise HTTPException(404, "Evento no encontrado")
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(TicketScan).where(TicketScan.event_id == event_id)
            .order_by(TicketScan.scanned_at.desc())
        )
        rows = [row_to_dict(r) for r in result.scalars().all()]

    buf = StringIO()
    writer = csv.writer(buf)
    writer.writerow(["scanned_at", "result", "reason", "holder_name", "seat_label", "ticket_id"])
    for r in rows:
        sat = r.get("scanned_at")
        writer.writerow([
            (sat.isoformat() if hasattr(sat, "isoformat") else str(sat or ""))[:19],
            r.get("result", ""), r.get("reason") or "",
            r.get("holder_name") or "", r.get("seat_label") or "", r.get("ticket_id") or "",
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="scan-log-{event_id}.csv"'},
    )


@router.get("/events/me/{event_id}/scan-stats")
async def get_scan_stats(event_id: str, user=Depends(get_current_user)):
    ev = await get_event_by_id(event_id)
    if not ev:
        raise HTTPException(404, "Evento no encontrado")
    if user.get("role") != "super_admin" and ev.get("organizer_id") != user.get("organizer_id"):
        raise HTTPException(404, "Evento no encontrado")

    now = datetime.now(timezone.utc)
    ten_min_ago = now - timedelta(minutes=10)

    async with AsyncSessionLocal() as session:
        total_tickets = await session.scalar(
            select(func.count(Ticket.id)).where(Ticket.event_id == event_id)
        ) or 0
        tickets_issued = await session.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.event_id == event_id,
                Ticket.status.in_(["issued", "used"]),
            )
        ) or 0
        scanned_count = await session.scalar(
            select(func.count(Ticket.id)).where(
                Ticket.event_id == event_id, Ticket.status == "used"
            )
        ) or 0
        valid_count = await session.scalar(
            select(func.count(TicketScan.id)).where(
                TicketScan.event_id == event_id, TicketScan.result == "valid"
            )
        ) or 0
        rejected_count = await session.scalar(
            select(func.count(TicketScan.id)).where(
                TicketScan.event_id == event_id, TicketScan.result != "valid"
            )
        ) or 0
        last_row = await session.scalar(
            select(TicketScan).where(TicketScan.event_id == event_id)
            .order_by(TicketScan.scanned_at.desc()).limit(1)
        )
        last_scan_at = row_to_dict(last_row).get("scanned_at") if last_row else None
        recent_count = await session.scalar(
            select(func.count(TicketScan.id)).where(
                TicketScan.event_id == event_id,
                TicketScan.result == "valid",
                TicketScan.scanned_at >= ten_min_ago,
            )
        ) or 0

        by_loc_result = await session.execute(
            select(Ticket.locality_id, func.count(Ticket.id).label("count"))
            .where(
                Ticket.event_id == event_id,
                Ticket.status == "used",
                Ticket.locality_id.isnot(None),
            )
            .group_by(Ticket.locality_id)
        )
        by_locality = {r.locality_id: r.count for r in by_loc_result.all()}

    localities = []
    if ev.get("venue_id"):
        venue = await get_venue_by_id(ev["venue_id"])
        for loc in (venue or {}).get("localities", []) or []:
            lid = loc.get("id")
            localities.append({
                "locality_id": lid,
                "name": loc.get("name"),
                "color": loc.get("color"),
                "scanned": int(by_locality.get(lid, 0)),
            })
        localities.sort(key=lambda x: (-x["scanned"], x["name"] or ""))

    attendance_pct = (
        round(100.0 * valid_count / tickets_issued, 1) if tickets_issued > 0 else 0.0
    )
    scanned_pct = (
        round(100.0 * scanned_count / tickets_issued, 1) if tickets_issued > 0 else 0.0
    )
    return {
        "total_tickets": total_tickets,
        "tickets_issued": tickets_issued,
        "scanned_count": scanned_count,
        "scanned_pct": scanned_pct,
        "valid_count": valid_count,
        "rejected_count": rejected_count,
        "attendance_pct": attendance_pct,
        "last_scan_at": last_scan_at,
        "scan_rate_per_minute": round(recent_count / 10, 1),
        "scanned_by_locality": by_locality,
        "localities": localities,
    }
