"""Abono de Temporada (season pass) — Fase 4.

Routes
------
# Organizer
POST   /api/events/me/{event_id}/season-passes
GET    /api/events/me/{event_id}/season-passes
PUT    /api/events/me/{event_id}/season-passes/{season_pass_id}
DELETE /api/events/me/{event_id}/season-passes/{season_pass_id}

# Public
GET    /api/public/events/{event_id}/season-passes
POST   /api/public/season-passes/{season_pass_id}/purchase
GET    /api/public/season-pass-purchases/{purchase_token}
POST   /api/public/season-pass-purchases/{purchase_token}/redeem
"""
import logging
import os
import uuid
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import stripe

from database import AsyncSessionLocal, get_db
from db_helpers import row_to_dict
from orm_models import (
    Event,
    EventFunction,
    Organizer,
    SeasonPass,
    SeasonPassPurchase,
    TicketType,
)
from security import get_current_user, require_role
from services import order_service, season_pass_service

logger = logging.getLogger("tys.season_passes")
router = APIRouter(tags=["season-passes"])
public_router = APIRouter(tags=["season-passes-public"])


def _frontend_base(payload_origin: Optional[str]) -> str:
    candidate = (payload_origin or "").rstrip("/")
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate
    env_url = (os.environ.get("FRONTEND_URL") or "").rstrip("/")
    if env_url:
        return env_url
    raise HTTPException(500, "FRONTEND_URL not configured and origin_url missing")


# ═══════════════════════════════════════════════════════════════════════════
# Organizer CRUD
# ═══════════════════════════════════════════════════════════════════════════

async def _get_org(user: dict, session: AsyncSession) -> Organizer:
    result = await session.execute(select(Organizer).where(Organizer.user_id == user["id"]))
    org = result.scalar_one_or_none()
    if not org:
        raise HTTPException(status_code=404, detail="Organizer not found")
    return org


async def _get_event_for_org(event_id: str, org_id: str, session: AsyncSession) -> Event:
    result = await session.execute(
        select(Event).where(Event.id == event_id, Event.organizer_id == org_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event


class SeasonPassCreate(BaseModel):
    name: str
    description: Optional[str] = None
    price_cents: int = Field(default=0, ge=0)
    currency: str = "USD"
    credits_total: int = Field(ge=1)
    max_passes: Optional[int] = Field(default=None, ge=1)
    redemption_starts_at: Optional[datetime] = None
    redemption_ends_at: Optional[datetime] = None


class SeasonPassUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    price_cents: Optional[int] = Field(default=None, ge=0)
    currency: Optional[str] = None
    credits_total: Optional[int] = Field(default=None, ge=1)
    max_passes: Optional[int] = Field(default=None, ge=1)
    redemption_starts_at: Optional[datetime] = None
    redemption_ends_at: Optional[datetime] = None
    status: Optional[str] = None


@router.post("/api/events/me/{event_id}/season-passes", status_code=201)
async def create_season_pass(
    event_id: str,
    body: SeasonPassCreate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    event = await _get_event_for_org(event_id, org.id, session)
    if event.venue_id:
        raise HTTPException(
            422,
            "El abono de temporada solo está disponible para eventos de admisión "
            "general (sin venue numerado).",
        )

    pass_row = SeasonPass(
        id=str(uuid.uuid4()),
        event_id=event_id,
        organizer_id=org.id,
        name=body.name,
        description=body.description,
        price_cents=body.price_cents,
        currency=body.currency,
        credits_total=body.credits_total,
        max_passes=body.max_passes,
        redemption_starts_at=body.redemption_starts_at,
        redemption_ends_at=body.redemption_ends_at,
    )
    session.add(pass_row)
    await session.commit()
    await session.refresh(pass_row)
    return row_to_dict(pass_row)


@router.get("/api/events/me/{event_id}/season-passes")
async def list_season_passes(
    event_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(SeasonPass)
        .where(SeasonPass.event_id == event_id)
        .order_by(SeasonPass.created_at)
    )
    return [row_to_dict(r) for r in result.scalars().all()]


@router.put("/api/events/me/{event_id}/season-passes/{season_pass_id}")
async def update_season_pass(
    event_id: str,
    season_pass_id: str,
    body: SeasonPassUpdate,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(SeasonPass).where(
            SeasonPass.id == season_pass_id, SeasonPass.event_id == event_id,
        )
    )
    pass_row = result.scalar_one_or_none()
    if not pass_row:
        raise HTTPException(status_code=404, detail="Season pass not found")

    for field, val in body.model_dump(exclude_none=True).items():
        setattr(pass_row, field, val)
    await session.commit()
    await session.refresh(pass_row)
    return row_to_dict(pass_row)


@router.delete("/api/events/me/{event_id}/season-passes/{season_pass_id}", status_code=204)
async def delete_season_pass(
    event_id: str,
    season_pass_id: str,
    user: dict = Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org = await _get_org(user, session)
    await _get_event_for_org(event_id, org.id, session)
    result = await session.execute(
        select(SeasonPass).where(
            SeasonPass.id == season_pass_id, SeasonPass.event_id == event_id,
        )
    )
    pass_row = result.scalar_one_or_none()
    if not pass_row:
        raise HTTPException(status_code=404, detail="Season pass not found")
    if pass_row.passes_sold > 0:
        raise HTTPException(
            status_code=409,
            detail="No se puede eliminar: ya hay abonos vendidos. Cancelalo en su lugar.",
        )
    await session.delete(pass_row)
    await session.commit()


# ═══════════════════════════════════════════════════════════════════════════
# Public — list / purchase / redeem
# ═══════════════════════════════════════════════════════════════════════════

@public_router.get("/api/public/events/{event_id}/season-passes")
async def public_list_season_passes(event_id: str, session: AsyncSession = Depends(get_db)):
    result = await session.execute(
        select(SeasonPass).where(
            SeasonPass.event_id == event_id, SeasonPass.status == "active",
        )
    )
    out = []
    for r in result.scalars().all():
        d = row_to_dict(r)
        avail = season_pass_service.compute_pass_availability(d)
        d["available"] = avail["available"]
        out.append(d)
    return out


class PassBuyerIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    email: str = Field(max_length=140)
    phone: Optional[str] = Field(default=None, max_length=40)
    document_id: Optional[str] = Field(default=None, max_length=40)
    document_type: Optional[str] = Field(default=None, max_length=20)


class PurchasePassBody(BaseModel):
    buyer: PassBuyerIn
    origin_url: Optional[str] = None


async def _load_pass_or_404(season_pass_id: str) -> tuple[dict, dict, dict]:
    async with AsyncSessionLocal() as pg:
        pass_row = await pg.scalar(select(SeasonPass).where(SeasonPass.id == season_pass_id))
    if not pass_row:
        raise HTTPException(404, "Abono no encontrado")
    season_pass = row_to_dict(pass_row)
    async with AsyncSessionLocal() as pg:
        event_row = await pg.scalar(select(Event).where(Event.id == season_pass["event_id"]))
    if not event_row or event_row.status != "published":
        raise HTTPException(404, "Evento no disponible")
    event = row_to_dict(event_row)
    async with AsyncSessionLocal() as pg:
        org_row = await pg.scalar(select(Organizer).where(Organizer.id == season_pass["organizer_id"]))
    organizer = row_to_dict(org_row) if org_row else None
    if not organizer:
        raise HTTPException(404, "Organizador no encontrado")
    return season_pass, event, organizer


@public_router.post("/api/public/season-passes/{season_pass_id}/purchase")
async def purchase_season_pass(
    season_pass_id: str, payload: PurchasePassBody, background_tasks: BackgroundTasks,
):
    season_pass, event, organizer = await _load_pass_or_404(season_pass_id)
    buyer = order_service.validate_buyer(payload.buyer.model_dump())

    purchase = await season_pass_service.create_purchase_skeleton(
        season_pass=season_pass, event=event, organizer=organizer, buyer=buyer,
    )

    # Free pass (price_cents == 0) — confirm instantly, mirrors free ticket events.
    if purchase["total_cents"] == 0:
        finalized = await season_pass_service.finalize_paid_purchase(purchase=purchase)
        background_tasks.add_task(_send_pass_confirmation_safe, finalized, season_pass, event, organizer)
        return {
            "order_number": finalized["order_number"],
            "status": "paid",
            "redirect_to": f"/o/{organizer['slug']}/abono/{finalized['purchase_token']}",
        }

    origin = _frontend_base(payload.origin_url)
    success_url = (
        f"{origin}/o/{organizer['slug']}/abono/{purchase['purchase_token']}"
        "?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = f"{origin}/o/{organizer['slug']}/abono/{purchase['purchase_token']}/cancelado"
    try:
        checkout = season_pass_service.create_pass_checkout_session(
            purchase=purchase, season_pass=season_pass, event=event,
            success_url=success_url, cancel_url=cancel_url,
        )
    except stripe.error.StripeError as e:
        logger.error("Stripe checkout failed for pass purchase %s: %s", purchase["order_number"], e)
        raise HTTPException(502, f"Stripe checkout error: {e.user_message or str(e)}") from e

    async with AsyncSessionLocal() as _pg:
        _row = await _pg.scalar(select(SeasonPassPurchase).where(SeasonPassPurchase.id == purchase["id"]))
        _row.stripe_session_id = checkout["id"]
        await _pg.commit()

    return {
        "order_number": purchase["order_number"],
        "checkout_url": checkout["url"],
        "session_id": checkout["id"],
        "status": "pending",
    }


async def _send_pass_confirmation_safe(finalized, season_pass, event, organizer) -> None:
    try:
        from services.email_service import send_season_pass_confirmation
        await send_season_pass_confirmation(
            purchase=finalized, season_pass=season_pass, event=event, organizer=organizer,
        )
    except Exception:  # noqa: BLE001
        logger.exception("Failed sending season pass confirmation email")


async def _load_purchase_or_404(purchase_token: str) -> dict:
    async with AsyncSessionLocal() as pg:
        row = await pg.scalar(
            select(SeasonPassPurchase).where(SeasonPassPurchase.purchase_token == purchase_token)
        )
    if not row:
        raise HTTPException(404, "Abono no encontrado")
    return row_to_dict(row)


@public_router.get("/api/public/season-pass-purchases/{purchase_token}")
async def get_pass_purchase(
    purchase_token: str, background_tasks: BackgroundTasks, session_id: Optional[str] = None,
):
    purchase = await _load_purchase_or_404(purchase_token)
    season_pass, event, organizer = await _load_pass_or_404(purchase["season_pass_id"])

    if purchase["status"] == "pending" and session_id and purchase.get("stripe_session_id") == session_id:
        try:
            stripe_session = stripe.checkout.Session.retrieve(session_id)
            if stripe_session.get("payment_status") == "paid":
                purchase = await season_pass_service.finalize_paid_purchase(
                    purchase=purchase, stripe_session_id=session_id,
                )
                background_tasks.add_task(_send_pass_confirmation_safe, purchase, season_pass, event, organizer)
        except stripe.error.StripeError as e:
            logger.warning("Could not refresh pass session %s: %s", session_id, e)

    async with AsyncSessionLocal() as pg:
        fn_result = await pg.execute(
            select(EventFunction).where(
                EventFunction.event_id == event["id"], EventFunction.status == "active",
            ).order_by(EventFunction.sort_order, EventFunction.starts_at)
        )
        functions = [row_to_dict(f) for f in fn_result.scalars().all()]

    return {
        "purchase": purchase,
        "season_pass": season_pass,
        "event": {
            "id": event["id"], "title": event["title"], "slug": event["slug"],
            "timezone": event.get("timezone"),
        },
        "organizer": {"slug": organizer["slug"], "company_name": organizer.get("company_name")},
        "functions": functions,
    }


class RedeemBody(BaseModel):
    function_id: str
    ticket_type_id: Optional[str] = None


@public_router.post("/api/public/season-pass-purchases/{purchase_token}/redeem")
async def redeem_pass_credit(
    purchase_token: str, body: RedeemBody, background_tasks: BackgroundTasks,
):
    purchase = await _load_purchase_or_404(purchase_token)
    season_pass, event, organizer = await _load_pass_or_404(purchase["season_pass_id"])

    async with AsyncSessionLocal() as pg:
        fn_row = await pg.scalar(
            select(EventFunction).where(
                EventFunction.id == body.function_id, EventFunction.event_id == event["id"],
            )
        )
    if not fn_row:
        raise HTTPException(404, "Función no encontrada para este evento.")
    function = row_to_dict(fn_row)

    ticket_type = None
    if body.ticket_type_id:
        async with AsyncSessionLocal() as pg:
            tt_row = await pg.scalar(
                select(TicketType).where(
                    TicketType.id == body.ticket_type_id, TicketType.event_id == event["id"],
                )
            )
        if not tt_row:
            raise HTTPException(404, "Tipo de ticket no encontrado para este evento.")
        ticket_type = row_to_dict(tt_row)

    refreshed_purchase, order, tickets = await season_pass_service.redeem_credit(
        purchase=purchase, season_pass=season_pass, event=event, organizer=organizer,
        function=function, ticket_type=ticket_type,
    )
    from services.email_service import send_purchase_confirmation
    background_tasks.add_task(
        send_purchase_confirmation, order=order, event=event, organizer=organizer, tickets=tickets,
    )
    return {"purchase": refreshed_purchase, "tickets": tickets}
