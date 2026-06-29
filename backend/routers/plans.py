"""Plans router — fully migrated to PostgreSQL."""
import uuid
from datetime import datetime, timezone
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from audit import log_audit
from database import get_db
from db_helpers import row_to_dict
from models import PlanCreate, PlanOut, PlanUpdate
from orm_models import Organizer, SubscriptionPlan
from security import get_current_user, require_role
from services.plan_features import get_plan_features

router = APIRouter(prefix="/api/plans", tags=["plans"])
admin_router = APIRouter(
    prefix="/api/admin/plans",
    tags=["admin", "plans"],
    dependencies=[Depends(require_role("super_admin"))],
)


def _to_out(row) -> PlanOut:
    return PlanOut(**row_to_dict(row))


@router.get("/me/features")
async def my_plan_features(
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    plan_code = None
    if user.get("organizer_id"):
        result = await session.execute(
            select(Organizer.plan_id).where(Organizer.id == user["organizer_id"])
        )
        plan_id = result.scalar_one_or_none()
        if plan_id:
            code_result = await session.execute(
                select(SubscriptionPlan.code).where(SubscriptionPlan.id == plan_id)
            )
            plan_code = code_result.scalar_one_or_none()
    return get_plan_features(plan_code)


@router.get("", response_model=List[PlanOut])
async def list_active_plans(session: AsyncSession = Depends(get_db)):
    result = await session.execute(
        select(SubscriptionPlan)
        .where(SubscriptionPlan.active == True)  # noqa: E712
        .order_by(SubscriptionPlan.price_cents)
    )
    return [_to_out(row) for row in result.scalars().all()]


@router.get("/{code}", response_model=PlanOut)
async def get_plan(code: str, session: AsyncSession = Depends(get_db)):
    result = await session.execute(
        select(SubscriptionPlan).where(
            SubscriptionPlan.code == code,
            SubscriptionPlan.active == True,  # noqa: E712
        )
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Plan not found")
    return _to_out(row)


# ── Admin CRUD ────────────────────────────────────────────────────────────────

@admin_router.get("", response_model=List[PlanOut])
async def admin_list_plans(session: AsyncSession = Depends(get_db)):
    result = await session.execute(
        select(SubscriptionPlan).order_by(SubscriptionPlan.price_cents)
    )
    return [_to_out(row) for row in result.scalars().all()]


@admin_router.post("", response_model=PlanOut, status_code=201)
async def admin_create_plan(
    payload: PlanCreate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    existing = await session.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.code == payload.code)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(409, "Plan code already exists")

    now = datetime.now(timezone.utc)
    plan = SubscriptionPlan(
        id=str(uuid.uuid4()),
        created_at=now,
        updated_at=now,
        **payload.model_dump(),
    )
    session.add(plan)
    await session.flush()
    await log_audit(admin["id"], "plan.created", "plan", plan.id, {"code": plan.code})
    return _to_out(plan)


@admin_router.patch("/{code}", response_model=PlanOut)
async def admin_update_plan(
    code: str,
    payload: PlanUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    updates["updated_at"] = datetime.now(timezone.utc)

    result = await session.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.code == code)
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Plan not found")
    for key, val in updates.items():
        setattr(row, key, val)
    await session.flush()
    await log_audit(admin["id"], "plan.updated", "plan", row.id, {"fields": list(updates.keys())})
    return _to_out(row)


@admin_router.delete("/{code}", status_code=204)
async def admin_delete_plan(
    code: str,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(SubscriptionPlan).where(SubscriptionPlan.code == code)
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(404, "Plan not found")

    subscribed = await session.scalar(
        select(func.count(Organizer.id)).where(Organizer.plan_id == plan.id)
    ) or 0
    if subscribed > 0:
        raise HTTPException(
            409,
            f"Cannot delete plan: {subscribed} organizer(s) are subscribed.",
        )

    await session.delete(plan)
    await log_audit(admin["id"], "plan.deleted", "plan", plan.id, {"code": code})
    return None
