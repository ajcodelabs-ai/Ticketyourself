"""Buyer account endpoints — logged-in attendees viewing their tickets."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from models import BuyerProfileUpdate, UserOut
from orm_models import (
    Event,
    EventFunction,
    Organizer,
    SeasonPassPurchase,
    Ticket,
    TicketOrder,
    User,
)
from security import require_purchase_account
from services.einvoice_service import list_invoices_for_orders

router = APIRouter(prefix="/api/buyer", tags=["buyer"])

_TICKET_PUBLIC_KEYS = (
    "id",
    "ticket_number",
    "status",
    "seat_label",
    "locality_name",
    "holder_name",
    "holder_email",
    "qr_token",
    "function_id",
    "price_cents",
    "raffle_number",
    "issued_at",
    "used_at",
)

_EVENT_PUBLIC_KEYS = (
    "id",
    "title",
    "slug",
    "starts_at",
    "ends_at",
    "timezone",
    "venue_name",
    "venue_city",
    "poster_url",
    "tenant_slug",
    "status",
)

_ORDER_PUBLIC_KEYS = (
    "id",
    "order_number",
    "status",
    "payment_method",
    "quantity_total",
    "total_cents",
    "currency",
    "paid_at",
    "created_at",
    "function_id",
    "tenant_slug",
)


def _pick(d: dict, keys: tuple) -> dict:
    return {k: d.get(k) for k in keys}


def _user_out(row: User) -> UserOut:
    return UserOut(**row_to_dict(row))


@router.get("/me")
async def buyer_me(user: dict = Depends(require_purchase_account)):
    return {
        "id": user["id"],
        "email": user["email"],
        "role": user["role"],
        "display_name": user.get("display_name"),
        "phone": user.get("phone"),
    }


@router.patch("/me")
async def update_buyer_me(
    payload: BuyerProfileUpdate,
    user: dict = Depends(require_purchase_account),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(User).where(User.id == user["id"]))
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    if payload.name is not None:
        row.display_name = payload.name.strip()[:140]
    if payload.phone is not None:
        row.phone = (payload.phone or "").strip()[:40] or None
    await session.flush()
    return _user_out(row)


@router.get("/me/orders")
async def list_my_orders(
    user: dict = Depends(require_purchase_account),
    session: AsyncSession = Depends(get_db),
):
    """Orders + tickets + event for the current account, newest first."""
    result = await session.execute(
        select(TicketOrder)
        .where(TicketOrder.buyer_user_id == user["id"])
        .order_by(TicketOrder.created_at.desc())
    )
    orders = result.scalars().all()
    if not orders:
        return {"items": []}

    event_ids = {o.event_id for o in orders}
    org_ids = {o.organizer_id for o in orders}
    order_ids = [o.id for o in orders]
    function_ids = {o.function_id for o in orders if o.function_id}

    ev_result = await session.execute(select(Event).where(Event.id.in_(event_ids)))
    events = {e.id: row_to_dict(e) for e in ev_result.scalars().all()}

    org_result = await session.execute(
        select(Organizer).where(Organizer.id.in_(org_ids))
    )
    orgs = {o.id: o for o in org_result.scalars().all()}

    tk_result = await session.execute(
        select(Ticket).where(Ticket.order_id.in_(order_ids))
    )
    tickets_by_order: dict[str, list] = {}
    for t in tk_result.scalars().all():
        tickets_by_order.setdefault(t.order_id, []).append(
            _pick(row_to_dict(t), _TICKET_PUBLIC_KEYS)
        )

    functions = {}
    if function_ids:
        fn_result = await session.execute(
            select(EventFunction).where(EventFunction.id.in_(function_ids))
        )
        functions = {f.id: row_to_dict(f) for f in fn_result.scalars().all()}

    invoices = await list_invoices_for_orders(session, order_ids)

    items = []
    for o in orders:
        od = row_to_dict(o)
        ev = events.get(o.event_id) or {}
        org = orgs.get(o.organizer_id)
        fn = functions.get(o.function_id) if o.function_id else None
        items.append(
            {
                "order": _pick(od, _ORDER_PUBLIC_KEYS),
                "event": _pick(ev, _EVENT_PUBLIC_KEYS),
                "organizer": {
                    "slug": org.slug if org else od.get("tenant_slug"),
                    "company_name": org.company_name if org else None,
                },
                "function": (
                    {
                        "id": fn["id"],
                        "name": fn.get("name"),
                        "starts_at": fn.get("starts_at"),
                    }
                    if fn
                    else None
                ),
                "tickets": tickets_by_order.get(o.id, []),
                "invoice": invoices.get(o.id),
            }
        )
    return {"items": items}


@router.get("/me/passes")
async def list_my_passes(
    user: dict = Depends(require_purchase_account),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(SeasonPassPurchase)
        .where(SeasonPassPurchase.buyer_user_id == user["id"])
        .order_by(SeasonPassPurchase.created_at.desc())
    )
    purchases = result.scalars().all()
    if not purchases:
        return {"items": []}

    event_ids = {p.event_id for p in purchases}
    org_ids = {p.organizer_id for p in purchases}
    ev_result = await session.execute(select(Event).where(Event.id.in_(event_ids)))
    events = {e.id: row_to_dict(e) for e in ev_result.scalars().all()}
    org_result = await session.execute(
        select(Organizer).where(Organizer.id.in_(org_ids))
    )
    orgs = {o.id: o for o in org_result.scalars().all()}

    items = []
    for p in purchases:
        ev = events.get(p.event_id) or {}
        org = orgs.get(p.organizer_id)
        items.append(
            {
                "id": p.id,
                "order_number": p.order_number,
                "status": p.status,
                "credits_total": p.credits_total,
                "credits_used": p.credits_used,
                "total_cents": p.total_cents,
                "currency": p.currency,
                "purchase_token": p.purchase_token,
                "paid_at": p.paid_at,
                "created_at": p.created_at,
                "event": _pick(ev, _EVENT_PUBLIC_KEYS),
                "organizer": {
                    "slug": org.slug if org else None,
                    "company_name": org.company_name if org else None,
                },
            }
        )
    return {"items": items}
