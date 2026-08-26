"""Admin router: organizer management + stats — Phase 2: PostgreSQL."""

import os
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from audit import log_audit
from database import get_db
from db_helpers import organizer_row_to_dict, row_to_dict
from models import (
    AdminOrganizerUpdate,
    AdminStats,
    ApproveBody,
    BillingIntentOut,
    CommentBody,
    ConfirmPlanPaymentBody,
    DocumentTypeCreate,
    DocumentTypeOut,
    OrganizerOut,
    OrganizersList,
    RegistrationCountryCreate,
    RegistrationCountryOut,
    RegistrationCountryUpdate,
    RejectBody,
    RequiredDocumentSetOut,
    RequiredDocumentsOut,
    RequiredDocumentsUpdate,
    SuspendBody,
    PlatformSettingsOut,
    PlatformSettingsUpdate,
)
from orm_models import (
    BillingIntent,
    Organizer,
    OrganizerAdminComment,
    SubscriptionPlan,
    Tenant,
)
from security import require_role
from services.document_types import create_document_type, list_document_types
from services.email_service import (
    send_organizer_approved_email,
    send_organizer_rejected_email,
)
from services.registration_countries import (
    get_country,
    list_countries,
    upsert_country,
)
from services.required_documents import (
    get_all_required_document_sets,
    get_required_documents,
    set_required_documents,
)


def _onboarding_url() -> str:
    frontend = os.environ.get("FRONTEND_URL", "").rstrip("/")
    return f"{frontend}/onboarding" if frontend else "/onboarding"


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
        select(func.count(Organizer.id)).where(
            Organizer.subscription_status == "active"
        )
    )

    # Revenue estimate from active monthly subscribers
    plans_result = await session.execute(
        select(
            SubscriptionPlan.id,
            SubscriptionPlan.price_cents,
            SubscriptionPlan.billing_period,
        )
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

    stmt = (
        stmt.order_by(Organizer.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    result = await session.execute(stmt)
    items = [_org_to_out(row) for row in result.scalars().all()]
    return OrganizersList(items=items, total=total, page=page, limit=limit)


@router.get("/organizers/{organizer_id}", response_model=OrganizerOut)
async def get_organizer(organizer_id: str, session: AsyncSession = Depends(get_db)):
    row = await _load_organizer(organizer_id, session)
    return _org_to_out(row)


@router.patch("/organizers/{organizer_id}", response_model=OrganizerOut)
async def update_organizer(
    organizer_id: str,
    payload: AdminOrganizerUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    raw_updates = payload.model_dump(exclude_unset=True)
    # plan_code=null is handled below as "leave the current plan alone" —
    # unassigning a plan is a distinct action, not implied by this generic PATCH.
    if raw_updates.get("plan_code") is None:
        raw_updates.pop("plan_code", None)
    null_ok = {
        "social_links",
        "pep_details",
        "uafe_declaration",
        "org_references",
        "signup_plan_code",
    }
    for key, val in raw_updates.items():
        if val is None and key not in null_ok:
            raise HTTPException(422, f"El campo '{key}' no puede quedar vacío.")
    updates = raw_updates
    if not updates:
        raise HTTPException(400, "No fields to update")

    # Plan assignment override
    if "plan_code" in updates:
        plan_code = updates.pop("plan_code")
        plan_result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code)
        )
        plan = plan_result.scalar_one_or_none()
        if not plan:
            raise HTTPException(404, f"Plan '{plan_code}' not found")
        row.plan_code = plan.code
        row.plan_id = plan.id
        if "subscription_status" not in updates:
            if row.subscription_status == "none":
                row.subscription_status = "active"

    if "country_code" in updates:
        code = updates["country_code"].upper()
        country = await get_country(session, code)
        if not country:
            raise HTTPException(400, f"Unknown country_code '{code}'")
        updates["country_code"] = code
        if "country" not in updates:
            updates["country"] = country.name

    for key, val in updates.items():
        setattr(row, key, val)

    if "company_name" in updates:
        tenant_result = await session.execute(
            select(Tenant).where(Tenant.slug == row.slug)
        )
        tenant_row = tenant_result.scalar_one_or_none()
        if tenant_row:
            tenant_row.name = updates["company_name"]

    await session.flush()
    await log_audit(
        admin["id"],
        "organizer.updated",
        "organizer",
        organizer_id,
        payload.model_dump(exclude_unset=True),
    )
    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.get(
    "/organizers/{organizer_id}/billing-intents",
    response_model=List[BillingIntentOut],
)
async def list_organizer_billing_intents(
    organizer_id: str, session: AsyncSession = Depends(get_db)
):
    await _load_organizer(organizer_id, session)
    result = await session.execute(
        select(BillingIntent)
        .where(BillingIntent.organizer_id == organizer_id)
        .order_by(BillingIntent.created_at.desc())
    )
    return [BillingIntentOut(**row_to_dict(r)) for r in result.scalars().all()]


@router.post(
    "/organizers/{organizer_id}/confirm-plan-payment",
    response_model=OrganizerOut,
)
async def confirm_organizer_plan_payment(
    organizer_id: str,
    payload: ConfirmPlanPaymentBody,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    """Confirm a pending Nuvei/DeUna plan payment and activate the subscription."""
    from routers.billing import complete_gateway_billing_intent

    row = await _load_organizer(organizer_id, session)
    if payload.intent_id:
        intent = await session.get(BillingIntent, payload.intent_id)
        if not intent or intent.organizer_id != organizer_id:
            raise HTTPException(404, "Billing intent not found")
    else:
        result = await session.execute(
            select(BillingIntent)
            .where(
                BillingIntent.organizer_id == organizer_id,
                BillingIntent.status == "pending_gateway",
            )
            .order_by(BillingIntent.created_at.desc())
            .limit(1)
        )
        intent = result.scalar_one_or_none()
        if not intent:
            raise HTTPException(404, "No pending gateway payment for this organizer")

    await complete_gateway_billing_intent(
        session, organizer=row, intent=intent, admin_id=admin["id"]
    )
    if payload.comment:
        await _add_comment(organizer_id, admin, payload.comment, session)
    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post(
    "/organizers/{organizer_id}/mark-verification-paid",
    response_model=OrganizerOut,
)
async def mark_verification_paid(
    organizer_id: str,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    row.verification_fee_status = "paid"
    await session.flush()
    await log_audit(
        admin["id"], "organizer.verification_paid", "organizer", organizer_id, {}
    )
    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post(
    "/organizers/{organizer_id}/mark-contract-signed",
    response_model=OrganizerOut,
)
async def mark_contract_signed(
    organizer_id: str,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    row = await _load_organizer(organizer_id, session)
    row.contract_status = "signed"
    row.contract_signed_at = datetime.now(timezone.utc)
    await session.flush()
    await log_audit(
        admin["id"], "organizer.contract_signed", "organizer", organizer_id, {}
    )
    await session.refresh(row, ["admin_comments"])
    return _org_to_out(row)


@router.post(
    "/organizers/{organizer_id}/resend-contract",
    response_model=OrganizerOut,
)
async def resend_contract(
    organizer_id: str,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    from services.oneshot import send_contract

    row = await _load_organizer(organizer_id, session)
    try:
        contract = await send_contract(
            organizer_id=row.id,
            organizer_email=row.email,
            company_name=row.company_name or row.slug,
            legal_id=row.legal_id,
            plan_code=row.plan_code or row.signup_plan_code,
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(502, f"No se pudo enviar el contrato: {type(exc).__name__}")
    row.contract_status = contract.get("status") or "sent"
    row.contract_external_id = contract.get("external_id")
    await session.flush()
    await log_audit(
        admin["id"],
        "organizer.contract_resent",
        "organizer",
        organizer_id,
        {"external_id": row.contract_external_id},
    )
    await session.refresh(row, ["admin_comments"])
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

    # Verification fee from signup plan (or assigned plan)
    plan_code = row.signup_plan_code or row.plan_code
    if plan_code:
        plan_result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code)
        )
        plan = plan_result.scalar_one_or_none()
        if plan:
            fee = int(getattr(plan, "verification_fee_cents", 0) or 0)
            row.verification_fee_cents = fee
            row.verification_fee_status = "waived" if fee <= 0 else "pending"

    # Activate tenant
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == row.slug))
    tenant = tenant_result.scalar_one_or_none()
    if tenant:
        tenant.status = "active"

    await session.flush()

    # Send contract via OneShot (stub until credentials configured)
    try:
        from services.oneshot import send_contract

        contract = await send_contract(
            organizer_id=row.id,
            organizer_email=row.email,
            company_name=row.company_name or row.slug,
            legal_id=row.legal_id,
            plan_code=plan_code,
        )
        row.contract_status = contract.get("status") or "sent"
        row.contract_external_id = contract.get("external_id")
        await session.flush()
    except Exception as exc:  # noqa: BLE001
        logger = __import__("logging").getLogger("tys.admin")
        logger.warning("OneShot send on approve failed: %s", type(exc).__name__)
        if row.contract_status == "none":
            row.contract_status = "pending"
            await session.flush()

    # Auto-create default microsite (no-op if exists)
    from routers.microsite import _get_or_create_microsite_row

    await _get_or_create_microsite_row(
        {
            "id": organizer_id,
            "slug": row.slug,
            "company_name": row.company_name or row.slug,
        }
    )
    await log_audit(
        admin["id"],
        "organizer.approved",
        "organizer",
        organizer_id,
        {"comment": payload.comment or ""},
    )

    if row.email:
        await send_organizer_approved_email(
            to=row.email,
            company_name=row.company_name or row.slug,
            continue_url=_onboarding_url(),
        )

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
    await log_audit(
        admin["id"],
        "organizer.rejected",
        "organizer",
        organizer_id,
        {"reason": payload.comment},
    )

    if row.email:
        await send_organizer_rejected_email(
            to=row.email,
            company_name=row.company_name or row.slug,
            reason=payload.comment,
            continue_url=_onboarding_url(),
        )

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
    await log_audit(
        admin["id"],
        "organizer.suspended",
        "organizer",
        organizer_id,
        {"reason": payload.comment},
    )

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


@router.get("/settings/required-documents", response_model=RequiredDocumentsOut)
async def get_required_documents_settings(
    country: Optional[str] = Query(default="*"),
    session: AsyncSession = Depends(get_db),
):
    docs = await get_required_documents(session, country)
    return RequiredDocumentsOut(country_code=(country or "*").upper(), **docs)


@router.get(
    "/settings/required-documents/all", response_model=List[RequiredDocumentSetOut]
)
async def get_all_required_documents_settings(session: AsyncSession = Depends(get_db)):
    return await get_all_required_document_sets(session)


@router.put("/settings/required-documents", response_model=RequiredDocumentsOut)
async def update_required_documents_settings(
    payload: RequiredDocumentsUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    country = (payload.country_code or "*").upper()
    await set_required_documents(
        session, "individual", payload.individual, admin["id"], country_code=country
    )
    await set_required_documents(
        session, "company", payload.company, admin["id"], country_code=country
    )
    await log_audit(
        admin["id"],
        "settings.required_documents_updated",
        "settings",
        "required_documents",
        payload.model_dump(),
    )
    docs = await get_required_documents(session, country)
    return RequiredDocumentsOut(country_code=country, **docs)


@router.get("/settings/document-types", response_model=List[DocumentTypeOut])
async def get_document_types_settings(session: AsyncSession = Depends(get_db)):
    return await list_document_types(session)


@router.post(
    "/settings/document-types", response_model=DocumentTypeOut, status_code=201
)
async def create_document_type_settings(
    payload: DocumentTypeCreate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    created = await create_document_type(session, payload.label, admin["id"])
    await log_audit(
        admin["id"],
        "settings.document_type_created",
        "document_type",
        created["code"],
        {"label": payload.label},
    )
    return created


@router.get(
    "/settings/registration-countries", response_model=List[RegistrationCountryOut]
)
async def get_registration_countries_settings(session: AsyncSession = Depends(get_db)):
    return await list_countries(session, active_only=False)


@router.post(
    "/settings/registration-countries",
    response_model=RegistrationCountryOut,
    status_code=201,
)
async def create_registration_country(
    payload: RegistrationCountryCreate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    created = await upsert_country(
        session, payload.code, payload.model_dump(), admin["id"]
    )
    await log_audit(
        admin["id"],
        "settings.registration_country_created",
        "registration_country",
        created["code"],
        {"name": payload.name},
    )
    return created


@router.put(
    "/settings/registration-countries/{code}",
    response_model=RegistrationCountryOut,
)
async def update_registration_country(
    code: str,
    payload: RegistrationCountryUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    data = payload.model_dump(exclude_unset=True)
    if not data:
        raise HTTPException(400, "No fields to update")
    # Ensure row exists
    existing = await get_country(session, code)
    if not existing:
        raise HTTPException(404, f"Country '{code}' not found")
    updated = await upsert_country(session, code, data, admin["id"])
    await log_audit(
        admin["id"],
        "settings.registration_country_updated",
        "registration_country",
        code.upper(),
        data,
    )
    return updated


@router.get("/settings/platform", response_model=PlatformSettingsOut)
async def get_platform_settings_admin(session: AsyncSession = Depends(get_db)):
    from services.platform_settings import get_platform_settings

    return PlatformSettingsOut(**(await get_platform_settings(session)))


@router.put("/settings/platform", response_model=PlatformSettingsOut)
async def update_platform_settings_admin(
    payload: PlatformSettingsUpdate,
    admin=Depends(require_role("super_admin")),
    session: AsyncSession = Depends(get_db),
):
    from services.platform_settings import (
        get_platform_settings,
        set_pre_event_fee_required,
    )

    await set_pre_event_fee_required(
        session, enabled=payload.pre_event_fee_required, admin_id=admin["id"]
    )
    await log_audit(
        admin["id"],
        "settings.platform_updated",
        "settings",
        "platform",
        payload.model_dump(),
    )
    return PlatformSettingsOut(**(await get_platform_settings(session)))
