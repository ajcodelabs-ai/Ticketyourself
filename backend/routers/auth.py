"""Auth router — Phase 2: users, tenants, organizers migrated to PostgreSQL."""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from db_helpers import organizer_row_to_dict, row_to_dict
from models import (
    AuthMeResponse,
    LoginRequest,
    OrganizerOut,
    RegisterRequest,
    SlugCheckResponse,
    UserOut,
)
from orm_models import Organizer, OrganizerAdminComment, Tenant, User
from security import (
    clear_auth_cookies,
    create_access_token,
    create_refresh_token,
    get_current_user,
    get_refresh_payload,
    hash_password,
    set_auth_cookies,
    verify_password,
)
from services.activation import (
    create_activation_token,
    ensure_activation_record,
)
from services.email_service import send_welcome_email
from slugs import find_unique_slug_pg, is_valid_slug, normalize_slug

logger = logging.getLogger("tys.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_row_to_out(row: User) -> UserOut:
    return UserOut(**row_to_dict(row))


def _org_row_to_out(row: Optional[Organizer]) -> Optional[OrganizerOut]:
    if not row:
        return None
    return OrganizerOut(**organizer_row_to_dict(row))


# ── Slug check ────────────────────────────────────────────────────────────────

@router.post("/check-slug", response_model=SlugCheckResponse)
async def check_slug(
    payload: dict,
    session: AsyncSession = Depends(get_db),
):
    raw = (payload.get("slug") or payload.get("company_name") or "").strip()
    base = normalize_slug(raw)
    if not base:
        return SlugCheckResponse(slug="", available=False, suggestion=None, reason="empty")
    if not is_valid_slug(base):
        reason = "too_short" if len(base) < 2 else "invalid"
        return SlugCheckResponse(slug=base, available=False, suggestion=None, reason=reason)
    suggestion = await find_unique_slug_pg(base, session, Organizer)
    available = suggestion == base
    return SlugCheckResponse(
        slug=base,
        available=available,
        suggestion=suggestion if not available else None,
        reason=None if available else "taken",
    )


# ── Register ──────────────────────────────────────────────────────────────────

@router.post("/register", response_model=AuthMeResponse)
async def register(payload: RegisterRequest, session: AsyncSession = Depends(get_db)):
    email = payload.email.lower().strip()

    existing = await session.execute(select(User).where(User.email == email))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Email already registered")

    desired_slug = (payload.slug or "").strip()
    base_slug = normalize_slug(desired_slug) if desired_slug else normalize_slug(payload.company_name)
    if not base_slug:
        raise HTTPException(status_code=400, detail="Invalid slug")
    if not is_valid_slug(base_slug):
        raise HTTPException(status_code=400, detail="Slug contains invalid characters")
    slug = await find_unique_slug_pg(base_slug, session, Organizer)
    if desired_slug and slug != base_slug:
        raise HTTPException(
            status_code=409,
            detail=f"Slug '{base_slug}' is taken. Suggestion: {slug}",
        )

    now = datetime.now(timezone.utc)
    user_id = str(uuid.uuid4())
    organizer_id = str(uuid.uuid4())

    # User → PostgreSQL
    user_row = User(
        id=user_id,
        email=email,
        password_hash=hash_password(payload.password),
        role="organizer",
        organizer_id=organizer_id,
        created_at=now,
        last_login=None,
    )
    session.add(user_row)

    # Tenant → PostgreSQL
    tenant_result = await session.execute(select(Tenant).where(Tenant.slug == slug))
    tenant_row = tenant_result.scalar_one_or_none()
    if tenant_row:
        tenant_row.name = payload.company_name.strip()
        tenant_row.status = "inactive"
    else:
        session.add(Tenant(slug=slug, name=payload.company_name.strip(), status="inactive", created_at=now))

    # Organizer → PostgreSQL
    org_row = Organizer(
        id=organizer_id,
        user_id=user_id,
        company_name=payload.company_name.strip(),
        legal_id=payload.legal_id.strip(),
        org_type=payload.org_type,
        email=email,
        phone=payload.phone.strip(),
        country=payload.country.strip(),
        slug=slug,
        status="pending",
        rejection_reason=None,
        plan_id=None,
        plan_code=None,
        subscription_status="none",
        stripe_customer_id=None,
        stripe_subscription_id=None,
        current_period_end=None,
        created_at=now,
        approved_at=None,
        approved_by=None,
    )
    session.add(org_row)
    await session.flush()

    logger.info("Registered organizer slug=%s email=%s", slug, email)

    # Welcome email + activation (best-effort)
    try:
        token = create_activation_token(user_id=user_id, organizer_id=organizer_id)
        token_payload = jwt.decode(token, options={"verify_signature": False})
        await ensure_activation_record(
            user_id=user_id,
            organizer_id=organizer_id,
            token_jti=token_payload.get("jti", ""),
        )
        frontend_base = os.environ.get("FRONTEND_URL", "").rstrip("/")
        continue_url = (
            f"{frontend_base}/onboarding?at={token}" if frontend_base else f"/onboarding?at={token}"
        )
        await send_welcome_email(
            to=email,
            company_name=payload.company_name.strip(),
            continue_url=continue_url,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Welcome flow side-effects failed for %s: %s", email, exc)

    # Reload with relationships for response
    await session.refresh(org_row, ["admin_comments"])
    return AuthMeResponse(
        user=_user_row_to_out(user_row),
        organizer=_org_row_to_out(org_row),
    )


# ── Login ─────────────────────────────────────────────────────────────────────

@router.post("/login", response_model=AuthMeResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    email = payload.email.lower().strip()

    result = await session.execute(select(User).where(User.email == email))
    user_row = result.scalar_one_or_none()
    if not user_row or not verify_password(payload.password, user_row.password_hash):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    access = create_access_token(user_row.id, user_row.email, user_row.role)
    refresh = create_refresh_token(user_row.id)
    set_auth_cookies(response, access, refresh)

    user_row.last_login = datetime.now(timezone.utc)

    org_row = None
    if user_row.organizer_id:
        org_result = await session.execute(
            select(Organizer)
            .where(Organizer.id == user_row.organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_row = org_result.scalar_one_or_none()

    await session.flush()

    return AuthMeResponse(
        user=_user_row_to_out(user_row),
        organizer=_org_row_to_out(org_row),
        access_token=access,
        refresh_token=refresh,
    )


# ── Logout ────────────────────────────────────────────────────────────────────

@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}


# ── Refresh ───────────────────────────────────────────────────────────────────

@router.post("/refresh")
async def refresh_token(
    request: Request,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    payload = await get_refresh_payload(request)
    result = await session.execute(select(User).where(User.id == payload["sub"]))
    user_row = result.scalar_one_or_none()
    if not user_row:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user_row.id, user_row.email, user_row.role)
    new_refresh = create_refresh_token(user_row.id)
    set_auth_cookies(response, access, new_refresh)
    return {"ok": True, "access_token": access, "refresh_token": new_refresh}


# ── Me ────────────────────────────────────────────────────────────────────────

@router.get("/me", response_model=AuthMeResponse)
async def me(
    user: dict = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(select(User).where(User.id == user["id"]))
    user_row = result.scalar_one_or_none()
    if not user_row:
        raise HTTPException(status_code=401, detail="User not found")

    org_row = None
    if user_row.organizer_id:
        org_result = await session.execute(
            select(Organizer)
            .where(Organizer.id == user_row.organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_row = org_result.scalar_one_or_none()

    return AuthMeResponse(
        user=_user_row_to_out(user_row),
        organizer=_org_row_to_out(org_row),
    )
