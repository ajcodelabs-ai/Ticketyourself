"""
Super-admin payment inbox — verification, plan, pre-event, ticket sales.

One list for money waiting on TYS (or a buyer) vs already collected.
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional, Sequence

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from orm_models import BillingIntent, Event, Organizer, SubscriptionPlan, TicketOrder
from security import require_role

router = APIRouter(
    prefix="/api/admin/payments",
    tags=["admin", "payments"],
    dependencies=[Depends(require_role("super_admin"))],
)

Kind = Literal["verification", "plan", "pre_event", "ticket"]
StatusFilter = Literal["pending", "paid", "all"]

PENDING_ORDER_STATUSES = ("pending", "pending_gateway", "pending_manual_payment")
PENDING_PLAN_STATUSES = ("pending", "pending_gateway")
SOURCE_CAP = 250


def _iso(dt: Optional[datetime]) -> Optional[str]:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


def _as_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _item(
    *,
    id: str,
    kind: str,
    status: str,
    amount_cents: int,
    organizer_id: Optional[str],
    organizer_name: Optional[str],
    organizer_slug: Optional[str],
    title: str,
    reference: Optional[str],
    created_at: Optional[datetime],
    paid_at: Optional[datetime] = None,
    event_id: Optional[str] = None,
    extra: Optional[dict] = None,
) -> Dict[str, Any]:
    return {
        "id": id,
        "kind": kind,
        "status": status,
        "amount_cents": int(amount_cents or 0),
        "organizer_id": organizer_id,
        "organizer_name": organizer_name,
        "organizer_slug": organizer_slug,
        "title": title,
        "reference": reference,
        "created_at": _iso(created_at),
        "paid_at": _iso(paid_at),
        "event_id": event_id,
        "extra": extra or {},
    }


def _matches_q(item: dict, q: str) -> bool:
    extra = item.get("extra") or {}
    blob = " ".join(
        [
            str(item.get(k) or "")
            for k in (
                "organizer_name",
                "organizer_slug",
                "title",
                "reference",
                "kind",
            )
        ]
        + [str(v) for v in extra.values()]
    ).lower()
    return q in blob


def _status_list(
    status: StatusFilter, pending: Sequence[str], paid: Sequence[str]
) -> List[str]:
    out: List[str] = []
    if status in ("pending", "all"):
        out.extend(pending)
    if status in ("paid", "all"):
        out.extend(paid)
    return out


async def _count_sum(
    session: AsyncSession, count_col, sum_col, *where
) -> Dict[str, int]:
    stmt = select(func.count(count_col), func.coalesce(func.sum(sum_col), 0))
    for clause in where:
        stmt = stmt.where(clause)
    count, total = (await session.execute(stmt)).one()
    return {"count": _as_int(count), "cents": _as_int(total)}


async def _summary(session: AsyncSession) -> Dict[str, Any]:
    verification = await _count_sum(
        session,
        Organizer.id,
        Organizer.verification_fee_cents,
        Organizer.verification_fee_status == "pending",
    )

    plan_row = (
        await session.execute(
            select(
                func.count(BillingIntent.id),
                func.coalesce(func.sum(SubscriptionPlan.price_cents), 0),
            )
            .outerjoin(
                SubscriptionPlan,
                SubscriptionPlan.code == BillingIntent.plan_code,
            )
            .where(BillingIntent.status.in_(PENDING_PLAN_STATUSES))
        )
    ).one()
    plan = {"count": _as_int(plan_row[0]), "cents": _as_int(plan_row[1])}

    pre_event = await _count_sum(
        session,
        Event.id,
        Event.pre_event_fee_cents,
        Event.pre_event_fee_status == "pending",
    )

    ticket = await _count_sum(
        session,
        TicketOrder.id,
        TicketOrder.total_cents,
        TicketOrder.status.in_(PENDING_ORDER_STATUSES),
    )

    by_kind = {
        "verification": verification,
        "plan": plan,
        "pre_event": pre_event,
        "ticket": ticket,
    }
    return {
        "pending_by_kind": by_kind,
        "pending_count": sum(v["count"] for v in by_kind.values()),
        "pending_cents": sum(v["cents"] for v in by_kind.values()),
    }


@router.get("")
async def list_payments(
    status: StatusFilter = Query(default="pending"),
    kind: Optional[Kind] = Query(default=None),
    q: Optional[str] = Query(default=None, max_length=80),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=30, ge=1, le=100),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    items: List[dict] = []
    want = {kind} if kind else {"verification", "plan", "pre_event", "ticket"}

    if "verification" in want:
        ver_statuses = _status_list(status, ["pending"], ["paid"])
        if ver_statuses:
            rows = (
                (
                    await session.execute(
                        select(Organizer).where(
                            Organizer.verification_fee_status.in_(ver_statuses)
                        )
                    )
                )
                .scalars()
                .all()
            )
            for org in rows:
                st = "paid" if org.verification_fee_status == "paid" else "pending"
                items.append(
                    _item(
                        id=f"verification:{org.id}",
                        kind="verification",
                        status=st,
                        amount_cents=int(org.verification_fee_cents or 0),
                        organizer_id=org.id,
                        organizer_name=org.company_name,
                        organizer_slug=org.slug,
                        title="Pago de verificación",
                        reference=None,
                        created_at=org.approved_at or org.created_at,
                        extra={
                            "action": "mark_verification" if st == "pending" else None
                        },
                    )
                )

    if "plan" in want:
        plan_statuses = _status_list(status, list(PENDING_PLAN_STATUSES), ["completed"])
        if plan_statuses:
            stmt = (
                select(BillingIntent, Organizer, SubscriptionPlan)
                .join(Organizer, Organizer.id == BillingIntent.organizer_id)
                .outerjoin(
                    SubscriptionPlan,
                    SubscriptionPlan.code == BillingIntent.plan_code,
                )
                .where(BillingIntent.status.in_(plan_statuses))
                .order_by(BillingIntent.created_at.desc())
                .limit(SOURCE_CAP)
            )
            for intent, org, plan in (await session.execute(stmt)).all():
                st = "paid" if intent.status == "completed" else "pending"
                items.append(
                    _item(
                        id=f"plan:{intent.id}",
                        kind="plan",
                        status=st,
                        amount_cents=int((plan.price_cents if plan else 0) or 0),
                        organizer_id=org.id,
                        organizer_name=org.company_name,
                        organizer_slug=org.slug,
                        title=f"Plan {intent.plan_code}",
                        reference=intent.session_id,
                        created_at=intent.created_at,
                        paid_at=intent.completed_at,
                        extra={
                            "intent_id": intent.id,
                            "payment_method": intent.payment_method,
                            "plan_code": intent.plan_code,
                            "intent_status": intent.status,
                            "action": "confirm_plan" if st == "pending" else None,
                        },
                    )
                )

    if "pre_event" in want:
        fee_statuses = _status_list(status, ["pending"], ["paid"])
        if fee_statuses:
            stmt = (
                select(Event, Organizer)
                .join(Organizer, Organizer.id == Event.organizer_id)
                .where(Event.pre_event_fee_status.in_(fee_statuses))
                .order_by(Event.updated_at.desc())
                .limit(SOURCE_CAP)
            )
            for event, org in (await session.execute(stmt)).all():
                st = "paid" if event.pre_event_fee_status == "paid" else "pending"
                items.append(
                    _item(
                        id=f"pre_event:{event.id}",
                        kind="pre_event",
                        status=st,
                        amount_cents=int(event.pre_event_fee_cents or 0),
                        organizer_id=org.id,
                        organizer_name=org.company_name,
                        organizer_slug=org.slug,
                        title=event.title or "Evento",
                        reference=event.slug,
                        created_at=event.updated_at or event.created_at,
                        paid_at=event.pre_event_fee_paid_at,
                        event_id=event.id,
                        extra={
                            "action": "mark_pre_event" if st == "pending" else None,
                        },
                    )
                )

    if "ticket" in want:
        order_statuses = _status_list(status, list(PENDING_ORDER_STATUSES), ["paid"])
        if order_statuses:
            stmt = (
                select(TicketOrder, Event, Organizer)
                .join(Event, Event.id == TicketOrder.event_id)
                .join(Organizer, Organizer.id == TicketOrder.organizer_id)
                .where(TicketOrder.status.in_(order_statuses))
                .order_by(TicketOrder.created_at.desc())
                .limit(SOURCE_CAP)
            )
            for order, event, org in (await session.execute(stmt)).all():
                st = "paid" if order.status == "paid" else "pending"
                items.append(
                    _item(
                        id=f"ticket:{order.id}",
                        kind="ticket",
                        status=st,
                        amount_cents=int(order.total_cents or 0),
                        organizer_id=org.id,
                        organizer_name=org.company_name,
                        organizer_slug=org.slug,
                        title=event.title or "Evento",
                        reference=order.order_number,
                        created_at=order.created_at,
                        paid_at=order.paid_at,
                        event_id=event.id,
                        extra={
                            "order_id": order.id,
                            "order_status": order.status,
                            "payment_method": order.payment_method,
                            "fees_cents": int(order.fees_cents or 0),
                            "buyer_email": order.buyer_email,
                            "platform_fee_bearer": event.platform_fee_bearer or "buyer",
                        },
                    )
                )

    needle = (q or "").strip().lower()
    if needle:
        items = [i for i in items if _matches_q(i, needle)]

    items.sort(key=lambda i: i.get("created_at") or "", reverse=True)

    total = len(items)
    start = (page - 1) * limit
    page_items = items[start : start + limit]
    summary = await _summary(session)

    return {
        "items": page_items,
        "total": total,
        "page": page,
        "limit": limit,
        "summary": summary,
    }
