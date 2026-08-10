"""
Public ticket order endpoints (no auth — buyers don't have TYS accounts).

Free events: instant paid + ticket issuance.
Paid + donation events: Stripe Checkout Session, finalize via webhook
(or via DEV simulator when sk_test_emergent doesn't deliver webhooks).
"""

import logging
import os
from typing import Literal, Optional

import stripe
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select

from database import AsyncSessionLocal
from db_helpers import (
    get_event_by_id,
    get_microsite_by_organizer,
    get_organizer_by_id,
    get_organizer_by_slug,
    row_to_dict,
)
from orm_models import Organizer
from services import discount_service, order_service
from services.event_venue import resolve_event_venue
from services.pdf_service import render_ticket_pdf

logger = logging.getLogger("tys.public_orders")
router = APIRouter(prefix="/api/public/orders", tags=["public-orders"])


def _frontend_base(payload_origin: Optional[str]) -> str:
    """Resolve the origin used to build Stripe success/cancel URLs."""
    candidate = (payload_origin or "").rstrip("/")
    if candidate.startswith("http://") or candidate.startswith("https://"):
        return candidate
    env_url = (os.environ.get("FRONTEND_URL") or "").rstrip("/")
    if env_url:
        return env_url
    # Last resort — must be absolute or Stripe rejects it.
    raise HTTPException(500, "FRONTEND_URL not configured and origin_url missing")


# ── Schemas ──────────────────────────────────────────────────────────────────
class BuyerIn(BaseModel):
    name: str = Field(min_length=2, max_length=140)
    email: EmailStr = Field(max_length=140)
    phone: Optional[str] = Field(default=None, max_length=40)
    document_id: Optional[str] = Field(default=None, max_length=40)
    document_type: Optional[str] = Field(default=None, max_length=20)


class TicketTypeSelection(BaseModel):
    ticket_type_id: str
    quantity: int = Field(ge=1, le=20)


class CreateOrderBody(BaseModel):
    tenant_slug: str
    event_slug: str
    quantity: int = Field(default=1, ge=1, le=20)
    buyer: BuyerIn
    donation_amount_cents: Optional[int] = None
    origin_url: Optional[str] = None  # for success/cancel URL construction
    payment_method: str = Field(
        default="nuvei"
    )  # nuvei | deuna | transfer | cash | stripe
    # Phase 7 — numbered events
    seat_holds_session_token: Optional[str] = None
    seat_ids: Optional[list[str]] = None
    # Phase 9.5 — promo codes (Bloque E)
    promo_code: Optional[str] = Field(default=None, max_length=40)
    # §4.2.7 — descuentos por ley (declaración del comprador + doc de verificación)
    law_category: Optional[Literal["disability", "senior"]] = None
    law_document_id: Optional[str] = Field(default=None, max_length=80)
    # Phase 8 — multi-función + ticket types
    function_id: Optional[str] = None
    ticket_type_selections: Optional[list[TicketTypeSelection]] = None
    # Fase 9 — access control (lista verificada / código de acceso)
    access_code: Optional[str] = Field(default=None, max_length=40)
    # §4.2.8 — respuestas a las preguntas adicionales del evento, por id
    custom_answers: Optional[dict[str, str]] = None


class PreviewOrderBody(BaseModel):
    tenant_slug: str
    event_slug: str
    quantity: int = Field(ge=1, le=20)
    seat_ids: Optional[list[str]] = None
    promo_code: Optional[str] = Field(default=None, max_length=40)
    payment_method: Optional[str] = Field(default=None, max_length=20)
    law_category: Optional[Literal["disability", "senior"]] = None
    ticket_type_selections: Optional[list[TicketTypeSelection]] = None
    buyer_email: Optional[EmailStr] = None


async def _resolve_event_for_pricing(tenant_slug: str, event_slug: str):
    organizer, event = await _load_event_or_404(tenant_slug, event_slug)
    venue = await resolve_event_venue(event) if event.get("venue_id") else None
    return organizer, event, venue


def _apply_discount_breakdown(totals: dict, applied: list[dict]) -> dict:
    """Subtract discount amounts from `subtotal_cents` and recompute fees +
    total. The original totals dict is returned in-place (mutated copy)."""
    if not applied:
        return {**totals, "discounts_applied": [], "discount_total_cents": 0}
    discount_total = sum(int(a.get("amount_cents") or 0) for a in applied)
    new_subtotal = max(0, int(totals.get("subtotal_cents") or 0) - discount_total)
    # Re-apply 5% service fee on net (only when the original totals had fees,
    # i.e. paid pricing — donations and free events leave fees at 0).
    fees = totals.get("fees_cents") or 0
    if fees > 0:
        fees = int(round(new_subtotal * order_service.DEFAULT_FEE_PERCENT / 100))
    return {
        **totals,
        "discount_total_cents": discount_total,
        "fees_cents": fees,
        "total_cents": new_subtotal + fees,
        "discounts_applied": applied,
    }


@router.post("/preview")
async def preview_order(payload: PreviewOrderBody):
    """Computes the price breakdown for a tentative purchase (no DB commit).
    Lets the buyer see the discount before paying. Soft warnings — e.g.
    rejected promo code — are returned in `warnings` so the frontend can
    surface a toast without aborting the rest of the preview."""
    organizer, event, venue = await _resolve_event_for_pricing(
        payload.tenant_slug,
        payload.event_slug,
    )
    if event["status"] != "published":
        raise HTTPException(409, "El evento no está disponible para compra")

    # Gross totals (re-uses the existing pricing helpers so we never diverge).
    if payload.seat_ids and venue:
        totals = order_service.compute_totals_with_seats(
            event=event,
            venue=venue,
            seat_ids=payload.seat_ids,
        )
        quantity = len(payload.seat_ids)
    else:
        totals = order_service.compute_totals(
            event=event,
            quantity=payload.quantity,
        )
        quantity = payload.quantity

    items = discount_service.items_from_payload(
        event=event,
        venue=venue,
        seat_ids=payload.seat_ids,
        quantity=quantity,
    )
    if payload.ticket_type_selections:
        from orm_models import TicketType as _TTModel

        async with AsyncSessionLocal() as pg:
            tt_ids = [s.ticket_type_id for s in payload.ticket_type_selections]
            result = await pg.execute(
                select(_TTModel).where(
                    _TTModel.id.in_(tt_ids), _TTModel.event_id == event["id"]
                )
            )
            tt_map = {r.id: row_to_dict(r) for r in result.scalars().all()}
        items = discount_service.items_from_ticket_types(
            selections=[s.model_dump() for s in payload.ticket_type_selections],
            ticket_types_by_id=tt_map,
        )
        # Align gross totals with ticket-type pricing when seats aren't used.
        if not (payload.seat_ids and venue):
            subtotal = sum(it["price_cents"] for it in items)
            fees = (
                int(round(subtotal * order_service.DEFAULT_FEE_PERCENT / 100))
                if subtotal > 0 and event.get("pricing_type") == "paid"
                else 0
            )
            totals = {
                **totals,
                "subtotal_cents": subtotal,
                "fees_cents": fees,
                "total_cents": subtotal + fees,
                "unit_price_cents": int(subtotal / max(1, len(items))),
            }
    applied, warnings = discount_service.evaluate_discounts(
        event=event,
        items=items,
        promo_code=payload.promo_code,
        payment_method=payload.payment_method,
        law_category=payload.law_category,
    )
    if payload.promo_code and payload.buyer_email:
        try:
            await discount_service.enforce_promo_max_per_buyer(
                event=event,
                promo_code=payload.promo_code,
                buyer_email=str(payload.buyer_email),
            )
        except HTTPException as exc:
            warnings.append(exc.detail if isinstance(exc.detail, str) else str(exc.detail))
    out = _apply_discount_breakdown(totals, applied)
    out["organizer_id"] = organizer["id"]
    out["currency"] = event.get("currency", "USD")
    out["warnings"] = warnings
    return out


async def _load_event_or_404(tenant_slug: str, event_slug: str) -> tuple[dict, dict]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Organizer).where(Organizer.slug == tenant_slug)
        )
        org_row = result.scalar_one_or_none()
    if not org_row:
        raise HTTPException(404, "Organizador no encontrado")
    organizer = row_to_dict(org_row)
    async with AsyncSessionLocal() as pg:
        from sqlalchemy import select as _select

        from orm_models import Event

        event_row = await pg.scalar(
            _select(Event).where(
                Event.organizer_id == organizer["id"],
                Event.slug == event_slug,
            )
        )
    if not event_row:
        raise HTTPException(404, "Evento no encontrado")
    event = row_to_dict(event_row)
    return organizer, event


@router.post("")
async def create_order(payload: CreateOrderBody, background_tasks: BackgroundTasks):
    organizer, event = await _load_event_or_404(payload.tenant_slug, payload.event_slug)
    if event["status"] != "published":
        raise HTTPException(409, "El evento no está disponible para compra")

    buyer = order_service.validate_buyer(payload.buyer.model_dump())

    # Phase 8 — multi-función: validate function_id belongs to this event and
    # is still active, and fetch its ticket-type overrides for pricing/capacity.
    function = None
    function_overrides: dict = {}
    if payload.function_id:
        from orm_models import EventFunction as _EFModel
        from orm_models import FunctionTicketType as _FTTModel

        async with AsyncSessionLocal() as pg:
            func_row = await pg.scalar(
                select(_EFModel).where(
                    _EFModel.id == payload.function_id,
                    _EFModel.event_id == event["id"],
                    _EFModel.status == "active",
                )
            )
            if not func_row:
                raise HTTPException(
                    422, "La función seleccionada no existe o ya no está disponible."
                )
            function = row_to_dict(func_row)
            ov_result = await pg.execute(
                select(_FTTModel).where(_FTTModel.function_id == function["id"])
            )
            function_overrides = {
                o.ticket_type_id: row_to_dict(o) for o in ov_result.scalars().all()
            }

    # Phase 7 — numbered event: use seat-based totals
    seat_ids = payload.seat_ids or None
    venue = None
    items_override = None
    selected_locality_ids: set[str] = set()
    if seat_ids and event.get("venue_id"):
        venue = await resolve_event_venue(event)
        if not venue:
            raise HTTPException(409, "El venue del evento ya no está disponible.")
        if not payload.seat_holds_session_token:
            raise HTTPException(
                422, "Falta el token de reservas (seat_holds_session_token)."
            )
        # A función may override per-locality pricing; fall back to the
        # event's own locality_pricing when it doesn't set its own.
        pricing_event = event
        if function and function.get("locality_pricing"):
            pricing_event = {**event, "locality_pricing": function["locality_pricing"]}
        totals = order_service.compute_totals_with_seats(
            event=pricing_event,
            venue=venue,
            seat_ids=seat_ids,
        )
        quantity = len(seat_ids)
        from services.seats import seats_by_id

        by_id = seats_by_id(venue)
        for sid in seat_ids:
            loc = (by_id.get(sid) or {}).get("locality_id")
            if loc:
                selected_locality_ids.add(loc)
    elif payload.ticket_type_selections:
        # Phase 8 — ticket types: compute totals from per-type pricing
        from sqlalchemy import select as _sel

        from orm_models import TicketType as _TTModel

        async with AsyncSessionLocal() as pg:
            tt_ids = [s.ticket_type_id for s in payload.ticket_type_selections]
            result = await pg.execute(
                _sel(_TTModel).where(
                    _TTModel.id.in_(tt_ids), _TTModel.event_id == event["id"]
                )
            )
            tt_map = {r.id: row_to_dict(r) for r in result.scalars().all()}
        if len(tt_map) != len(tt_ids):
            raise HTTPException(
                422, "Uno o más tipos de ticket no son válidos para este evento."
            )
        # A función may override per-locality pricing; fall back to the
        # event's own locality_pricing when it doesn't set its own (mirrors
        # the seat-based branch above).
        pricing_event = event
        if function and function.get("locality_pricing"):
            pricing_event = {**event, "locality_pricing": function["locality_pricing"]}
        pricing_map = order_service.locality_pricing_map(pricing_event)
        subtotal = 0
        entrada_subtotal = 0
        service_subtotal = 0
        admin_subtotal = 0
        vxs_subtotal = 0
        wallet_subtotal = 0
        items_override = []
        for sel in payload.ticket_type_selections:
            tt = tt_map[sel.ticket_type_id]
            override = function_overrides.get(sel.ticket_type_id)
            if override and not override.get("active", True):
                raise HTTPException(
                    409,
                    f"El tipo '{tt['name']}' no está disponible para la función seleccionada.",
                )
            if not tt.get("active", True):
                raise HTTPException(
                    409, f"El tipo '{tt['name']}' ya no está disponible."
                )
            # §4.2.6 — mínimo de compra / cantidad exacta por tipo de ticket
            exact_qty = tt.get("exact_quantity")
            if exact_qty and sel.quantity != exact_qty:
                raise HTTPException(
                    422,
                    f"'{tt['name']}' se vende en paquetes de exactamente {exact_qty} entradas.",
                )
            min_qty = tt.get("min_quantity")
            if min_qty and sel.quantity < min_qty:
                raise HTTPException(
                    422, f"'{tt['name']}' requiere comprar al menos {min_qty} entradas."
                )
            unit = (
                override["price_cents_override"]
                if override and override.get("price_cents_override") is not None
                else int(tt.get("price_cents") or 0)
            )
            cap_override = override.get("capacity_override") if override else None
            if cap_override is not None:
                sold_for_type = override.get("tickets_sold") or 0
                if sold_for_type + sel.quantity > cap_override:
                    raise HTTPException(
                        409,
                        f"No hay suficiente aforo de '{tt['name']}' para esta función.",
                    )
            service, admin = order_service.locality_fee_cents(
                pricing_map, tt.get("venue_locality_id")
            )
            loc_pricing = pricing_map.get(tt.get("venue_locality_id")) or {}
            vxs = int(loc_pricing.get("vxs_cents") or 0)
            wallet = int(loc_pricing.get("wallet_fee_cents") or 0)
            sel_subtotal = (unit + service + admin + vxs + wallet) * sel.quantity
            subtotal += sel_subtotal
            entrada_subtotal += unit * sel.quantity
            service_subtotal += service * sel.quantity
            admin_subtotal += admin * sel.quantity
            vxs_subtotal += vxs * sel.quantity
            wallet_subtotal += wallet * sel.quantity
            items_override.append(
                {
                    "ticket_type_id": tt["id"],
                    "ticket_type": tt["name"],
                    "quantity": sel.quantity,
                    "unit_price_cents": unit,
                    "subtotal_cents": sel_subtotal,
                    "venue_locality_id": tt.get("venue_locality_id"),
                }
            )
        quantity = sum(s.quantity for s in payload.ticket_type_selections)
        fees = int(round(entrada_subtotal * order_service.DEFAULT_FEE_PERCENT / 100))
        totals = {
            "unit_price_cents": entrada_subtotal // max(1, quantity),
            "subtotal_cents": subtotal,
            "entrada_cents": entrada_subtotal,
            "service_fee_cents": service_subtotal,
            "admin_fee_cents": admin_subtotal,
            "vxs_cents": vxs_subtotal,
            "wallet_fee_cents": wallet_subtotal,
            "fees_cents": fees,
            "total_cents": subtotal + fees,
            "donation_amount_cents": 0,
        }
    else:
        totals = order_service.compute_totals(
            event=event,
            quantity=payload.quantity,
            donation_amount_cents=payload.donation_amount_cents or 0,
        )
        quantity = payload.quantity

    # Access gate after quantity is known (guest list / access code ticket caps).
    from services.access_control import check_purchase_access

    async with AsyncSessionLocal() as access_session:
        try:
            access_code_id = await check_purchase_access(
                event=event,
                session=access_session,
                buyer_email=payload.buyer.email,
                buyer_document_id=payload.buyer.document_id,
                access_code=payload.access_code,
                quantity=quantity,
            )
        except ValueError as exc:
            raise HTTPException(403, str(exc))

    # §4.2.6 — límites por compra / transacción configurados en el evento.
    access_params = event.get("access_params") or {}
    max_per_purchase = access_params.get("max_per_purchase")
    if max_per_purchase and quantity > max_per_purchase:
        raise HTTPException(
            422,
            f"Esta compra admite un máximo de {max_per_purchase} entradas por transacción.",
        )
    min_per_purchase = access_params.get("min_per_purchase") or 1
    if min_per_purchase and quantity < min_per_purchase:
        raise HTTPException(
            422,
            f"Esta compra requiere al menos {min_per_purchase} entradas por transacción.",
        )

    # §4.2.8 — preguntas adicionales; filtrar por localidad y validar tipo number.
    custom_answers = payload.custom_answers or {}
    for q in event.get("custom_questions") or []:
        q_locs = q.get("locality_ids") or []
        if (
            q_locs
            and selected_locality_ids
            and not (selected_locality_ids & set(q_locs))
        ):
            continue  # question does not apply to selected localities
        if q_locs and not selected_locality_ids:
            # Non-seated purchase: locality-scoped questions are skipped
            continue
        raw = custom_answers.get(q["id"])
        raw_s = ("" if raw is None else str(raw)).strip()
        if q.get("required") and not raw_s:
            raise HTTPException(422, f"Falta responder: {q['label']}")
        if raw_s and q.get("type") == "number":
            try:
                float(raw_s.replace(",", "."))
            except ValueError:
                raise HTTPException(422, f"'{q['label']}' debe ser un número.")

    # Free events ignore payment_method unless optional donation > 0
    donation_cents = int(payload.donation_amount_cents or 0)
    is_pure_free = (
        event.get("pricing_type") == "free"
        and not (event.get("optional_donation_enabled") and donation_cents > 0)
    )
    effective_method = "stripe" if is_pure_free else payload.payment_method

    # Phase 9.5 — apply discount rules (promo + auto/NxM + preventa/ley)
    # BEFORE creating the order so the persisted totals match what the buyer was
    # shown. Resolved against `effective_method` so payment-method-conditioned
    # rules see the form of payment that will actually be charged.
    if items_override and not seat_ids:
        items = []
        for io in items_override:
            for _ in range(int(io.get("quantity") or 0)):
                items.append(
                    {
                        "seat_id": None,
                        "locality_id": io.get("venue_locality_id"),
                        "price_cents": int(io.get("unit_price_cents") or 0),
                    }
                )
    else:
        items = discount_service.items_from_payload(
            event=event,
            venue=venue,
            seat_ids=seat_ids,
            quantity=quantity,
        )

    # §4.2.7 — verificación mínima de descuentos por ley
    if payload.law_category:
        discounts_cfg = event.get("discounts") or {}
        if payload.law_category == "disability":
            law = discounts_cfg.get("disability_law") or {}
            if not law.get("enabled"):
                raise HTTPException(
                    422, "Este evento no tiene descuento por discapacidad."
                )
        elif payload.law_category == "senior":
            law = discounts_cfg.get("senior_law") or {}
            if not law.get("enabled"):
                raise HTTPException(
                    422, "Este evento no tiene descuento por tercera edad."
                )
            if law.get("require_document", True) and not (
                payload.law_document_id or buyer.get("document_id")
            ):
                raise HTTPException(
                    422,
                    "Para el descuento de tercera edad indicá el número de cédula o carné.",
                )
        if payload.law_category == "disability" and not (
            payload.law_document_id or buyer.get("document_id")
        ):
            raise HTTPException(
                422,
                "Para el descuento por discapacidad indicá el número de carné CONADIS o cédula.",
            )

    await discount_service.enforce_promo_max_per_buyer(
        event=event,
        promo_code=payload.promo_code,
        buyer_email=buyer.get("email") or "",
    )

    applied_discounts, discount_warnings = discount_service.evaluate_discounts(
        event=event,
        items=items,
        promo_code=payload.promo_code,
        payment_method=effective_method,
        law_category=payload.law_category,
    )
    if payload.promo_code and not any(
        a.get("type") == "promo_code" for a in applied_discounts
    ):
        # Buyer typed a code but it didn't resolve into a real discount — fail hard
        # so they don't pay for a code that won't apply.
        reason = discount_warnings[0] if discount_warnings else "Código no válido."
        raise HTTPException(422, reason)
    if payload.law_category and not any(
        a.get("type") in ("disability_law", "senior_law") for a in applied_discounts
    ):
        reason = (
            discount_warnings[0]
            if discount_warnings
            else "No se pudo aplicar el descuento por ley."
        )
        raise HTTPException(422, reason)
    totals = _apply_discount_breakdown(totals, applied_discounts)

    order = await order_service.create_order_skeleton(
        event=event,
        organizer=organizer,
        quantity=quantity,
        buyer=buyer,
        totals=totals,
        payment_method=effective_method,
        seat_ids=seat_ids,
        seat_holds_session_token=payload.seat_holds_session_token,
        function=function,
        items_override=items_override,
        access_code_id=access_code_id,
        custom_answers=custom_answers or None,
        law_category=payload.law_category,
        law_document_id=payload.law_document_id,
    )

    # FREE event without optional donation — confirm instantly.
    if is_pure_free:
        finalized, tickets = await order_service.finalize_paid_order(order=order)
        from services.email_service import send_purchase_confirmation

        background_tasks.add_task(
            send_purchase_confirmation,
            order=finalized,
            event=event,
            organizer=organizer,
            tickets=tickets,
        )
        return {
            "order_number": finalized["order_number"],
            "status": "paid",
            "tickets": tickets,
            "redirect_to": f"/o/{organizer['slug']}/orden/{finalized['order_number']}",
        }

    # ── Manual payment (transfer / cash) — no Stripe, 48h reservation ─────
    if effective_method in ("transfer", "cash"):
        await order_service.reserve_capacity(
            event=event,
            order_id=order["id"],
            quantity=quantity,
            ttl_minutes=order_service.MANUAL_RESERVATION_TTL_HOURS * 60,
            function_id=function["id"] if function else None,
        )
        instructions = order_service.get_payment_instructions(
            event=event, payment_method=effective_method
        )
        from services.email_service import send_manual_payment_instructions

        background_tasks.add_task(
            send_manual_payment_instructions,
            order=order,
            event=event,
            organizer=organizer,
            instructions=instructions,
        )
        return {
            "order_number": order["order_number"],
            "status": "pending_manual_payment",
            "payment_method": effective_method,
            "payment_instructions": instructions,
            "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}/instrucciones",
        }

    # ── Nuvei — openOrder + Simply Connect (REST API) ─────────────────────────
    if effective_method == "nuvei":
        from services import nuvei_service

        if not nuvei_service.is_configured():
            async with AsyncSessionLocal() as _pg:
                from orm_models import TicketOrder as _TOModel

                _row = await _pg.scalar(
                    select(_TOModel).where(_TOModel.id == order["id"])
                )
                if _row:
                    _row.status = "pending_gateway"
                    await _pg.commit()
            await order_service.reserve_capacity(
                event=event,
                order_id=order["id"],
                quantity=quantity,
                ttl_minutes=order_service.RESERVATION_TTL_MIN,
                function_id=function["id"] if function else None,
            )
            return {
                "order_number": order["order_number"],
                "status": "pending_gateway",
                "payment_method": "nuvei",
                "message": (
                    "Nuvei aún no está configurado en este entorno. "
                    "Tu reserva quedó registrada; contactá a soporte TYS."
                ),
                "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}",
            }

        origin = _frontend_base(payload.origin_url)
        success_url = (
            f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}"
        )
        cancel_url = (
            f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}/cancelado"
        )
        first_name, last_name = nuvei_service.split_buyer_name(
            (payload.buyer.name if payload.buyer else "") or ""
        )
        try:
            nuvei = nuvei_service.open_order(
                amount_cents=order["total_cents"],
                currency=order.get("currency") or event.get("currency") or "USD",
                client_unique_id=order["order_number"],
                user_token_id=order["buyer_email"],
                email=order["buyer_email"],
                first_name=first_name,
                last_name=last_name,
                success_url=success_url,
                failure_url=cancel_url,
                pending_url=success_url,
                custom_data=f"ticket:{order['id']}",
            )
        except nuvei_service.NuveiError as e:
            logger.error(
                "Nuvei openOrder failed for %s: %s",
                order["order_number"],
                type(e).__name__,
            )
            raise HTTPException(
                502,
                "No pudimos iniciar el pago con Nuvei. Intentá de nuevo en unos minutos.",
            ) from e

        async with AsyncSessionLocal() as _pg:
            from orm_models import TicketOrder as _TOModel

            _row = await _pg.scalar(select(_TOModel).where(_TOModel.id == order["id"]))
            _row.stripe_session_id = nuvei["session_token"]
            meta = dict(_row.metadata_ or {})
            meta["nuvei_order_id"] = nuvei.get("order_id")
            meta["nuvei_client_unique_id"] = order["order_number"]
            _row.metadata_ = meta
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(_row, "metadata_")
            # Ensure status is pending (openOrder path), not leftover stub state
            _row.status = "pending"
            await _pg.commit()

        await order_service.reserve_capacity(
            event=event,
            order_id=order["id"],
            quantity=quantity,
            function_id=function["id"] if function else None,
        )
        return {
            "order_number": order["order_number"],
            "status": "nuvei_checkout",
            "payment_method": "nuvei",
            "session_token": nuvei["session_token"],
            "session_id": nuvei["session_token"],
            "merchant_id": nuvei["merchant_id"],
            "merchant_site_id": nuvei["merchant_site_id"],
            "nuvei_env": nuvei["env"],
            "checkout_js_url": nuvei["checkout_js_url"],
            "client_unique_id": order["order_number"],
            "amount": nuvei["amount"],
            "currency": nuvei["currency"],
            "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}",
        }

    # ── DEUNA — Create Order + Payment Widget Web SDK ─────────────────────────
    if effective_method == "deuna":
        from services import deuna_service

        if not deuna_service.is_configured():
            async with AsyncSessionLocal() as _pg:
                from orm_models import TicketOrder as _TOModel

                _row = await _pg.scalar(
                    select(_TOModel).where(_TOModel.id == order["id"])
                )
                if _row:
                    _row.status = "pending_gateway"
                    await _pg.commit()
            await order_service.reserve_capacity(
                event=event,
                order_id=order["id"],
                quantity=quantity,
                ttl_minutes=order_service.RESERVATION_TTL_MIN,
                function_id=function["id"] if function else None,
            )
            return {
                "order_number": order["order_number"],
                "status": "pending_gateway",
                "payment_method": "deuna",
                "message": (
                    "DEUNA aún no está configurado en este entorno. "
                    "Tu reserva quedó registrada; contactá a soporte TYS."
                ),
                "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}",
            }

        first_name, last_name = deuna_service.split_buyer_name(
            (payload.buyer.name if payload.buyer else "") or ""
        )
        try:
            deuna = deuna_service.create_order(
                order_id=order["order_number"],
                amount_cents=order["total_cents"],
                currency=order.get("currency") or event.get("currency") or "USD",
                item_name=f"{event.get('title') or 'Evento'} · {order['quantity_total']} entradas",
                item_description=order["buyer_email"],
                email=order["buyer_email"],
                first_name=first_name,
                last_name=last_name,
                phone=(payload.buyer.phone if payload.buyer else None),
                metadata={
                    "tys_purpose": "ticket_purchase",
                    "order_id": order["id"],
                    "event_id": event["id"],
                },
            )
        except deuna_service.DeunaError as e:
            logger.error(
                "DEUNA create_order failed for %s: %s",
                order["order_number"],
                type(e).__name__,
            )
            raise HTTPException(
                502,
                "No pudimos iniciar el pago con DEUNA. Intentá de nuevo en unos minutos.",
            ) from e

        async with AsyncSessionLocal() as _pg:
            from orm_models import TicketOrder as _TOModel

            _row = await _pg.scalar(select(_TOModel).where(_TOModel.id == order["id"]))
            _row.stripe_session_id = deuna["order_token"]
            meta = dict(_row.metadata_ or {})
            meta["deuna_order_token"] = deuna["order_token"]
            meta["deuna_order_id"] = order["order_number"]
            _row.metadata_ = meta
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(_row, "metadata_")
            _row.status = "pending"
            await _pg.commit()

        await order_service.reserve_capacity(
            event=event,
            order_id=order["id"],
            quantity=quantity,
            function_id=function["id"] if function else None,
        )
        return {
            "order_number": order["order_number"],
            "status": "deuna_checkout",
            "payment_method": "deuna",
            "order_token": deuna["order_token"],
            "session_id": deuna["order_token"],
            "public_api_key": deuna["public_api_key"],
            "deuna_env": deuna["env"],
            "checkout_js_url": deuna["checkout_js_url"],
            "client_unique_id": order["order_number"],
            "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}",
        }

    # ── Gateway stubs (PayPal) — order held; real charge not wired yet ──
    if effective_method == "paypal":
        await order_service.reserve_capacity(
            event=event,
            order_id=order["id"],
            quantity=quantity,
            ttl_minutes=order_service.RESERVATION_TTL_MIN,
            function_id=function["id"] if function else None,
        )
        return {
            "order_number": order["order_number"],
            "status": "pending_gateway",
            "payment_method": effective_method,
            "message": (
                "Integración pendiente: el cobro con PayPal aún no está disponible. "
                "Tu reserva quedó registrada; te avisaremos cuando puedas completar el pago."
            ),
            "redirect_to": f"/o/{organizer['slug']}/orden/{order['order_number']}",
        }

    # Paid or donation > 0 — Stripe checkout.
    origin = _frontend_base(payload.origin_url)
    success_url = (
        f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}"
        "?session_id={CHECKOUT_SESSION_ID}"
    )
    cancel_url = (
        f"{origin}/o/{organizer['slug']}/orden/{order['order_number']}/cancelado"
    )
    try:
        session = order_service.create_ticket_checkout_session(
            order=order, event=event, success_url=success_url, cancel_url=cancel_url
        )
    except stripe.error.StripeError as e:
        # logger.error, not .exception — Stripe error messages can echo back
        # request data; type(e).__name__ is enough to triage without it, and
        # the same reasoning means `e` must not reach the client either.
        logger.error(
            "Stripe checkout failed for order %s: %s",
            order["order_number"],
            type(e).__name__,
        )
        raise HTTPException(
            502,
            "No pudimos iniciar el pago con Stripe. Intentá de nuevo en unos minutos.",
        ) from e

    async with AsyncSessionLocal() as _pg:
        from orm_models import TicketOrder as _TOModel

        _row = await _pg.scalar(select(_TOModel).where(_TOModel.id == order["id"]))
        _row.stripe_session_id = session["id"]
        await _pg.commit()
    await order_service.reserve_capacity(
        event=event,
        order_id=order["id"],
        quantity=quantity,
        function_id=function["id"] if function else None,
    )
    return {
        "order_number": order["order_number"],
        "checkout_url": session["url"],
        "session_id": session["id"],
        "status": "pending",
    }


@router.get("/{order_number}")
async def get_order(
    order_number: str,
    background_tasks: BackgroundTasks,
    session_id: Optional[str] = Query(default=None),
):
    from orm_models import Ticket as _TModel
    from orm_models import TicketOrder as _TOModel

    async with AsyncSessionLocal() as _pg:
        order_row = await _pg.scalar(
            select(_TOModel).where(_TOModel.order_number == order_number)
        )
    if not order_row:
        raise HTTPException(404, "Orden no encontrada")
    order = row_to_dict(order_row)

    if (
        order["status"] == "pending"
        and session_id
        and order.get("stripe_session_id") == session_id
    ):
        try:
            stripe_session = stripe.checkout.Session.retrieve(session_id)
            if stripe_session.get("payment_status") == "paid":
                order, _tickets = await order_service.finalize_paid_order(
                    order=order, stripe_session_id=session_id
                )
                event = await get_event_by_id(order["event_id"])
                organizer = await get_organizer_by_id(order["organizer_id"])
                from services.email_service import send_purchase_confirmation

                background_tasks.add_task(
                    send_purchase_confirmation,
                    order=order,
                    event=event,
                    organizer=organizer,
                    tickets=_tickets,
                )
        except stripe.error.StripeError as e:
            # See the checkout-create catch above: log the exception type
            # only, since `e` can echo back request data.
            logger.warning(
                "Could not refresh session %s: %s", session_id, type(e).__name__
            )

    async with AsyncSessionLocal() as _pg:
        _t_result = await _pg.execute(
            select(_TModel).where(_TModel.order_id == order["id"])
        )
        tickets = [row_to_dict(r) for r in _t_result.scalars().all()]
    event = await get_event_by_id(order["event_id"])
    organizer = await get_organizer_by_id(order["organizer_id"])
    microsite = await get_microsite_by_organizer(order["organizer_id"])
    return {
        "order": {
            k: v
            for k, v in order.items()
            if k
            not in (
                "order_token",
                "stripe_session_id",
                "stripe_payment_intent_id",
                "metadata",
            )
        },
        "tickets": tickets,
        "event": event,
        "organizer": {
            "slug": organizer["slug"] if organizer else None,
            "company_name": organizer.get("company_name") if organizer else None,
        },
        "branding": (microsite or {}).get("branding") or {},
    }


@router.get("/{order_number}/instructions")
async def get_payment_instructions(order_number: str):
    """
    Public endpoint that returns the manual-payment instructions for an order.
    Only meaningful when status=pending_manual_payment. Buyer reaches this via
    the `redirect_to` from create_order or the email link.
    """
    from orm_models import TicketOrder as _TOModel

    async with AsyncSessionLocal() as _pg:
        _row = await _pg.scalar(
            select(_TOModel).where(_TOModel.order_number == order_number)
        )
    order = row_to_dict(_row) if _row else None
    if not order:
        raise HTTPException(404, "Orden no encontrada")
    event = await get_event_by_id(order["event_id"])
    organizer = await get_organizer_by_id(order["organizer_id"])
    microsite = await get_microsite_by_organizer(order["organizer_id"])
    method = order.get("payment_method") or "stripe"
    instructions = order_service.get_payment_instructions(
        event=event or {}, payment_method=method
    )
    return {
        "order": {
            k: v
            for k, v in order.items()
            if k
            not in (
                "order_token",
                "stripe_session_id",
                "stripe_payment_intent_id",
                "metadata",
            )
        },
        "event": event,
        "organizer": {
            "slug": organizer["slug"] if organizer else None,
            "company_name": organizer.get("company_name") if organizer else None,
            "email": organizer.get("email") if organizer else None,
        },
        "branding": (microsite or {}).get("branding") or {},
        "payment_method": method,
        "payment_instructions": instructions,
    }


@router.get("/by-token/{order_token}")
async def get_order_by_token(order_token: str):
    """Public guest order lookup by UUID token (no auth required).

    Returns order summary, tickets (with QR tokens), and event info.
    Used for the guest order history page (/orden/{token}).
    """
    from orm_models import Ticket as _TModel
    from orm_models import TicketOrder as _TOModel

    async with AsyncSessionLocal() as _pg:
        _o_row = await _pg.scalar(
            select(_TOModel).where(_TOModel.order_token == order_token)
        )
    if not _o_row:
        raise HTTPException(404, "Orden no encontrada")

    order = row_to_dict(_o_row)
    event = await get_event_by_id(order["event_id"])
    organizer = await get_organizer_by_id(order["organizer_id"])
    microsite = await get_microsite_by_organizer(order["organizer_id"])

    async with AsyncSessionLocal() as _pg:
        _t_rows = await _pg.scalars(
            select(_TModel).where(_TModel.order_id == order["id"])
        )
    tickets = [row_to_dict(t) for t in _t_rows.all()]

    return {
        "order": {
            k: v
            for k, v in order.items()
            if k
            not in (
                "order_token",
                "stripe_session_id",
                "stripe_payment_intent_id",
                "metadata",
            )
        },
        "tickets": tickets,
        "event": event,
        "organizer": {
            "slug": organizer["slug"] if organizer else None,
            "company_name": organizer.get("company_name") if organizer else None,
        },
        "branding": (microsite or {}).get("branding") or {},
    }


@router.get("/{order_number}/tickets/{ticket_id}/pdf")
async def ticket_pdf(order_number: str, ticket_id: str):
    from orm_models import Ticket as _TModel
    from orm_models import TicketOrder as _TOModel

    async with AsyncSessionLocal() as _pg:
        _o_row = await _pg.scalar(
            select(_TOModel).where(_TOModel.order_number == order_number)
        )
    order = row_to_dict(_o_row) if _o_row else None
    if not order or order["status"] != "paid":
        raise HTTPException(404, "Orden no encontrada o no pagada")

    async with AsyncSessionLocal() as _pg:
        _t_row = await _pg.scalar(
            select(_TModel).where(
                _TModel.id == ticket_id, _TModel.order_id == order["id"]
            )
        )
    ticket = row_to_dict(_t_row) if _t_row else None
    if not ticket:
        raise HTTPException(404, "Ticket no encontrado")
    event = await get_event_by_id(ticket["event_id"])
    organizer = await get_organizer_by_id(ticket["organizer_id"])
    microsite = await get_microsite_by_organizer(ticket["organizer_id"])
    pdf_bytes = await render_ticket_pdf(
        event=event,
        order=order,
        ticket=ticket,
        organizer=organizer,
        microsite=microsite,
    )
    filename = f"ticket-{order_number}-{ticket_id[:8]}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )
