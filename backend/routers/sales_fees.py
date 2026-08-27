"""Admin CRUD + organizer quote for per-ticket sales commissions."""

from datetime import datetime, timezone
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
from database import get_db
from orm_models import Organizer, SalesFeeRule, SubscriptionPlan
from security import get_current_user, require_role
from services.sales_fees import (
    PRICING_TYPES,
    find_overlapping_rule,
    list_sales_fee_rules,
    normalize_fee_amounts,
    quote_one,
    rule_to_dict,
)

router = APIRouter(prefix="/api/sales-fees", tags=["sales-fees"])
admin_router = APIRouter(
    prefix="/api/admin/sales-fee-rules",
    tags=["admin", "sales-fees"],
    dependencies=[Depends(require_role("super_admin"))],
)

PricingType = Literal["paid", "free", "donation"]
FeeMode = Literal["fixed", "percent"]


class SalesFeeRuleIn(BaseModel):
    plan_code: str = Field(min_length=2, max_length=40)
    pricing_type: PricingType
    min_price_cents: int = Field(default=0, ge=0)
    max_price_cents: Optional[int] = Field(default=None, ge=0)
    fee_mode: FeeMode = "percent"
    fee_fixed_cents: int = Field(default=0, ge=0, le=1_000_000)
    fee_percent_bps: int = Field(default=0, ge=0, le=10_000)
    active: bool = True


class SalesFeeRuleUpdate(BaseModel):
    plan_code: Optional[str] = Field(default=None, min_length=2, max_length=40)
    pricing_type: Optional[PricingType] = None
    min_price_cents: Optional[int] = Field(default=None, ge=0)
    max_price_cents: Optional[int] = Field(default=None, ge=0)
    fee_mode: Optional[FeeMode] = None
    fee_fixed_cents: Optional[int] = Field(default=None, ge=0, le=1_000_000)
    fee_percent_bps: Optional[int] = Field(default=None, ge=0, le=10_000)
    active: Optional[bool] = None


class QuoteBatchIn(BaseModel):
    pricing_type: PricingType
    prices_cents: List[int] = Field(default_factory=list, max_length=80)
    plan_code: Optional[str] = None  # admin preview; organizers ignore this


def _normalize_or_422(mode: str, fixed: int, bps: int) -> tuple[str, int, int]:
    try:
        return normalize_fee_amounts(mode, fixed, bps)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _validate_range(min_cents: int, max_cents: Optional[int]) -> None:
    if max_cents is not None and max_cents < min_cents:
        raise HTTPException(
            422, "El precio máximo debe ser mayor o igual al mínimo."
        )


async def _assert_plan_exists(session: AsyncSession, code: str) -> None:
    row = await session.scalar(
        select(SubscriptionPlan.id).where(SubscriptionPlan.code == code)
    )
    if not row:
        raise HTTPException(404, f"No existe el plan '{code}'")


async def _assert_no_overlap(
    session: AsyncSession,
    *,
    plan_code: str,
    pricing_type: str,
    min_price_cents: int,
    max_price_cents: Optional[int],
    exclude_id: Optional[str] = None,
) -> None:
    existing = await list_sales_fee_rules(session, active_only=False)
    hit = find_overlapping_rule(
        existing,
        plan_code=plan_code,
        pricing_type=pricing_type,
        min_price_cents=min_price_cents,
        max_price_cents=max_price_cents,
        exclude_id=exclude_id,
    )
    if hit:
        raise HTTPException(
            409,
            "Ya hay una combinación activa que se solapa con este plan, "
            "tipo de evento y rango de precio.",
        )


async def _organizer_plan_code(session: AsyncSession, user: dict) -> Optional[str]:
    org_id = user.get("organizer_id")
    if not org_id:
        return None
    row = (
        await session.execute(
            select(Organizer.plan_code, Organizer.signup_plan_code).where(
                Organizer.id == org_id
            )
        )
    ).one_or_none()
    if not row:
        return None
    return row[0] or row[1]


@admin_router.get("")
async def admin_list_rules(session: AsyncSession = Depends(get_db)):
    return await list_sales_fee_rules(session)


@admin_router.post("", status_code=201)
async def admin_create_rule(
    payload: SalesFeeRuleIn,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    _validate_range(payload.min_price_cents, payload.max_price_cents)
    mode, fixed, bps = _normalize_or_422(
        payload.fee_mode, payload.fee_fixed_cents, payload.fee_percent_bps
    )
    await _assert_plan_exists(session, payload.plan_code)
    if payload.active:
        await _assert_no_overlap(
            session,
            plan_code=payload.plan_code,
            pricing_type=payload.pricing_type,
            min_price_cents=payload.min_price_cents,
            max_price_cents=payload.max_price_cents,
        )
    now = datetime.now(timezone.utc)
    row = SalesFeeRule(
        plan_code=payload.plan_code,
        pricing_type=payload.pricing_type,
        min_price_cents=payload.min_price_cents,
        max_price_cents=payload.max_price_cents,
        fee_mode=mode,
        fee_fixed_cents=fixed,
        fee_percent_bps=bps,
        active=payload.active,
        created_at=now,
        updated_at=now,
    )
    session.add(row)
    await session.flush()
    await log_audit(
        admin["id"],
        "sales_fee_rule.created",
        "sales_fee_rule",
        row.id,
        {"plan_code": row.plan_code, "pricing_type": row.pricing_type},
    )
    return rule_to_dict(row)


@admin_router.patch("/{rule_id}")
async def admin_update_rule(
    rule_id: str,
    payload: SalesFeeRuleUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await session.scalar(select(SalesFeeRule).where(SalesFeeRule.id == rule_id))
    if not row:
        raise HTTPException(404, "Regla no encontrada")
    data = payload.model_dump(exclude_unset=True)
    if "max_price_cents" not in payload.model_fields_set:
        data.pop("max_price_cents", None)
    for key, val in data.items():
        setattr(row, key, val)
    mode, fixed, bps = _normalize_or_422(
        getattr(row, "fee_mode", None) or "percent",
        int(row.fee_fixed_cents or 0),
        int(row.fee_percent_bps or 0),
    )
    row.fee_mode = mode
    row.fee_fixed_cents = fixed
    row.fee_percent_bps = bps
    min_c = int(row.min_price_cents or 0)
    max_c = row.max_price_cents
    _validate_range(min_c, max_c)
    await _assert_plan_exists(session, row.plan_code)
    if row.active:
        await _assert_no_overlap(
            session,
            plan_code=row.plan_code,
            pricing_type=row.pricing_type,
            min_price_cents=min_c,
            max_price_cents=max_c,
            exclude_id=row.id,
        )
    row.updated_at = datetime.now(timezone.utc)
    await session.flush()
    await log_audit(
        admin["id"],
        "sales_fee_rule.updated",
        "sales_fee_rule",
        row.id,
        {"fields": list(data.keys())},
    )
    return rule_to_dict(row)


@admin_router.delete("/{rule_id}", status_code=204)
async def admin_delete_rule(
    rule_id: str,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await session.scalar(select(SalesFeeRule).where(SalesFeeRule.id == rule_id))
    if not row:
        raise HTTPException(404, "Regla no encontrada")
    await session.delete(row)
    await log_audit(admin["id"], "sales_fee_rule.deleted", "sales_fee_rule", rule_id, {})
    return None


@router.get("/quote")
async def quote_sales_fee(
    pricing_type: str = Query(...),
    price_cents: int = Query(0, ge=0),
    plan_code: Optional[str] = Query(default=None),
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    if pricing_type not in PRICING_TYPES:
        raise HTTPException(422, "Tipo de evento inválido")
    rules = await list_sales_fee_rules(session, active_only=True)
    code = await _organizer_plan_code(session, user)
    if user.get("role") == "super_admin" and plan_code:
        code = plan_code
    return quote_one(
        rules=rules,
        plan_code=code,
        pricing_type=pricing_type,
        price_cents=price_cents,
    )


@router.post("/quote-batch")
async def quote_sales_fee_batch(
    payload: QuoteBatchIn,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    rules = await list_sales_fee_rules(session, active_only=True)
    code = await _organizer_plan_code(session, user)
    if user.get("role") == "super_admin" and payload.plan_code:
        code = payload.plan_code
    quotes = {}
    for cents in payload.prices_cents:
        key = str(max(0, int(cents or 0)))
        if key in quotes:
            continue
        quotes[key] = quote_one(
            rules=rules,
            plan_code=code,
            pricing_type=payload.pricing_type,
            price_cents=int(cents or 0),
        )
    return {"plan_code": code, "pricing_type": payload.pricing_type, "quotes": quotes}
