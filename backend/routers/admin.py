"""Admin router: organizer management + stats — Phase 2: PostgreSQL."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from audit import log_audit
from database import get_db
from db_helpers import organizer_row_to_dict
from models import (
    AdminStats,
    ApproveBody,
    CommentBody,
    OrganizerOut,
    OrganizersList,
    RejectBody,
    SuspendBody,
)
from orm_models import Organizer, OrganizerAdminComment, SubscriptionPlan, Tenant
from security import require_role

router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_role("super_admin"))],
)


def _org_to_out(row: Organizer) -> OrganizerOut:
    return OrganizerOut(**organizer_row_to_dict(row))


async def _load_organizer(organizer_id: str, session: AsyncSession) -> Organizer:
    result = await session.execute(
        select(Organizer)
        .where(Organizer.id == organizer_id)
        .options(selectinload(Organizer.admin_comments))
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Organizer not found")
    return row


@router.get("/dashboard/stats-legacy", response_model=AdminStats, deprecated=True)
async def admin_stats_legacy(session: AsyncSession = Depends(get_db)):
    """Deprecated — replaced by GET /api/admin/dashboard/stats."""
    def _count(status):
        return session.scalar(
            select(func.count(Organizer.id)).where(Organizer.status == status)
        )

    organizers_total = await session.scalar(select(func.count(Organizer.id)))
    organizers_pending = await _count("pending")
    organizers_approved = await _count("approved")
    organizers_rejected = await _count("rejected")
    organizers_suspended = await _count("suspended")
    active_subs = await session.scalar(
        select(func.count(Organizer.id)).where(Organizer.subscription_status == "active")
    )

    # Revenue estimate from active monthly subscribers
    plans_result = await session.execute(
        select(SubscriptionPlan.id, SubscriptionPlan.price_cents, SubscriptionPlan.billing_period)
    )
    plan_price = {row.id: row for row in plans_result.all()}

    orgs_result = await session.execute(
        select(Organizer.plan_id).where(
            Organizer.subscription_status == "active",
            Organizer.plan_id.isnot(None),
        )
    )
    revenue_cents = 0
    for (plan_id,) in orgs_result.all():
        plan = plan_price.get(plan_id)
        if plan and plan.billing_period == "monthly":
            revenue_cents += plan.price_cents

    return AdminStats(
        organizers_total=organizers_total or 0,
        organizers_pending=organizers_pending or 0,
        organizers_approved=organizers_approved or 0,
        organizers_rejected=organizers_rejected or 0,
        organizers_suspended=organizers_suspended or 0,
        active_subscriptions=active_subs or 0,
        monthly_revenue_estimate_cents=revenue_cents,
    )


@router.get("/organizers", response_model=OrganizersList)
async def list_organizers(
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_db),
):
    stmt = select(Organizer).options(selectinload(Organizer.admin_comments))
    if status:
        stmt = stmt.where(Organizer.status == status)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Organizer.company_name.ilike(like),
                Organizer.email.ilike(like),
                Organizer.slug.ilike(like),
            )
        )

    total_stmt = select(func.count()).select_from(stmt.subquery())
    total = await session.scalar(total_stmt) or 0

    stmt = stmt.order_by(Organizer.created_at.desc()).offset((page - 1) * limit).limit(limit)
    result = await session.execute(stmt)
    items = [_org_to_out(row) for row in result.scalars().all()]
    return OrganizersList(items=items, total=total, page=page, limit=limit)


@router.get("/organizers/{organizer_id}", response_model=OrganizerOut)
async def get_organizer(organizer_id: str, session: AsyncSession = Depends(get_db)):
    row = await _load_organizer(organizer_id, session)
    return _org_to_out(row)


async def _add_comment(
    organizer_id: str, admin: dict, comment: str, session: AsyncSession
) -> OrganizerAdminComment:
    entry = OrganizerAdminComment(
        id=str(uuid.uuid4()),
        organizer_id=organizer_id,
        admin_id=admin["id"],
        admin_email=admin.get("email"),
        comment=comment,
        created_at=datetime.now(timezone.utc),
    )
    session.add(entry)
    await session.flush()
    return entry


@router.post("/organizers/{organizer_id}/approve", response_model=OrganizerOut)
async def approve_organizer(
    organizer_id: str,
    payload: ApproveBody,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    if payload.comment:
        await _add_comment(organizer_id, admin, payload.comment, session)
    now = datetime.now(timezone.utc)
    row.status = "approved"
    row.rejection_reason = None
    row.approved_at = now
    row.approved_by = admin["id"]

    # Activate tenant
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == row.slug))
    tenant = tenant_result.scalar_one_or_none()
    if tenant:
        tenant.status = "active"

    await session.flush()

    # Auto-create default microsite (no-op if exists)
    from routers.microsite import _get_or_create_microsite_row
    await _get_or_create_microsite_row({"id": organizer_id, "slug": row.slug, "company_name": row.company_name or row.slug})
    await log_audit(admin["id"], "organizer.approved", "organizer", organizer_id, {"comment": payload.comment or ""})

    # Reload admin_comments after adding
    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post("/organizers/{organizer_id}/reject", response_model=OrganizerOut)
async def reject_organizer(
    organizer_id: str,
    payload: RejectBody,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    await _add_comment(organizer_id, admin, payload.comment, session)
    row.status = "rejected"
    row.rejection_reason = payload.comment

    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == row.slug))
    tenant = tenant_result.scalar_one_or_none()
    if tenant:
        tenant.status = "inactive"

    await session.flush()
    await log_audit(admin["id"], "organizer.rejected", "organizer", organizer_id, {"reason": payload.comment})

    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post("/organizers/{organizer_id}/suspend", response_model=OrganizerOut)
async def suspend_organizer(
    organizer_id: str,
    payload: SuspendBody,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    await _add_comment(organizer_id, admin, payload.comment, session)
    row.status = "suspended"

    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == row.slug))
    tenant = tenant_result.scalar_one_or_none()
    if tenant:
        tenant.status = "suspended"

    await session.flush()
    await log_audit(admin["id"], "organizer.suspended", "organizer", organizer_id, {"reason": payload.comment})

    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post("/organizers/{organizer_id}/comment", response_model=OrganizerOut)
async def add_comment(
    organizer_id: str,
    payload: CommentBody,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    await _add_comment(organizer_id, admin, payload.comment, session)
    await session.flush()
    await log_audit(admin["id"], "organizer.commented", "organizer", organizer_id, {})

    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)
