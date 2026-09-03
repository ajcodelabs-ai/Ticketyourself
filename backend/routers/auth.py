"""Auth router — Phase 2: users, tenants, organizers migrated to PostgreSQL."""

import logging
import os
import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import func, select
from sqlalchemy import update as sa_update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from database import get_db
from db_helpers import organizer_row_to_dict, row_to_dict
from models import (
    AuthMeResponse,
    BuyerRegisterRequest,
    LoginRequest,
    OrganizerOut,
    RegisterRequest,
    RegistrationCountryOut,
    SlugCheckResponse,
    SocialLoginRequest,
    UserOut,
)
from orm_models import (
    Organizer,
    Tenant,
    TicketOrder,
    User,
    UserOAuthIdentity,
)
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
from services import datil_service
from services import verificante_service as verificante
from services.activation import create_activation_token, ensure_activation_record
from services.email_service import send_welcome_email
from services.oauth import (
    display_name_from_social,
    enabled_social_providers,
    verify_social_token,
)
from services.registration_countries import (
    get_country,
    list_countries,
    validate_compliance_payload,
)
from slugs import find_unique_slug_pg, is_valid_slug, normalize_slug

logger = logging.getLogger("tys.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _user_row_to_out(row: User, tenant_slug: Optional[str] = None) -> UserOut:
    data = row_to_dict(row)
    data.pop("password_hash", None)
    if tenant_slug:
        data["tenant_slug"] = tenant_slug
    return UserOut(**data)


def _org_row_to_out(row: Optional[Organizer]) -> Optional[OrganizerOut]:
    if not row:
        return None
    return OrganizerOut(**organizer_row_to_dict(row))


async def _organizer_by_slug(session: AsyncSession, slug: str) -> Organizer:
    clean = (slug or "").strip().lower()
    if not clean:
        raise HTTPException(
            status_code=400, detail="Falta la página del organizador (tenant_slug)."
        )
    row = await session.scalar(select(Organizer).where(Organizer.slug == clean))
    if not row:
        raise HTTPException(
            status_code=404, detail="Página de organizador no encontrada."
        )
    return row


async def _find_buyer(
    session: AsyncSession, email: str, organizer_id: str
) -> Optional[User]:
    return await session.scalar(
        select(User).where(
            func.lower(User.email) == email,
            User.role == "buyer",
            User.organizer_id == organizer_id,
        )
    )


async def _find_platform_user(session: AsyncSession, email: str) -> Optional[User]:
    return await session.scalar(
        select(User).where(
            func.lower(User.email) == email,
            User.role.in_(("organizer", "super_admin")),
        )
    )


async def _slug_for_user(session: AsyncSession, row: User) -> Optional[str]:
    if not row.organizer_id:
        return None
    return await session.scalar(
        select(Organizer.slug).where(Organizer.id == row.organizer_id)
    )


def _issue_auth(
    response: Response,
    user_row: User,
    org_row: Optional[Organizer],
    tenant_slug: Optional[str],
) -> AuthMeResponse:
    access = create_access_token(user_row.id, user_row.email, user_row.role)
    refresh = create_refresh_token(user_row.id, user_row.token_version or 0)
    set_auth_cookies(response, access, refresh)
    return AuthMeResponse(
        user=_user_row_to_out(user_row, tenant_slug),
        organizer=_org_row_to_out(org_row) if user_row.role != "buyer" else None,
        access_token=access,
        refresh_token=refresh,
    )


async def _claim_guest_purchases(
    session: AsyncSession, user_id: str, email: str, organizer_id: Optional[str] = None
) -> None:
    """Attach leftover guest orders/abonos (same email, no user yet) to this account."""
    from orm_models import SeasonPassPurchase

    order_filters = [
        func.lower(TicketOrder.buyer_email) == email,
        TicketOrder.buyer_user_id.is_(None),
    ]
    pass_filters = [
        func.lower(SeasonPassPurchase.buyer_email) == email,
        SeasonPassPurchase.buyer_user_id.is_(None),
    ]
    if organizer_id:
        order_filters.append(TicketOrder.organizer_id == organizer_id)
        pass_filters.append(SeasonPassPurchase.organizer_id == organizer_id)

    await session.execute(
        sa_update(TicketOrder).where(*order_filters).values(buyer_user_id=user_id)
    )
    await session.execute(
        sa_update(SeasonPassPurchase).where(*pass_filters).values(buyer_user_id=user_id)
    )


# ── Registration countries (public) ───────────────────────────────────────────


@router.get("/registration-countries", response_model=List[RegistrationCountryOut])
async def registration_countries(session: AsyncSession = Depends(get_db)):
    return await list_countries(session, active_only=True)


# ── Slug check ────────────────────────────────────────────────────────────────


@router.post("/check-slug", response_model=SlugCheckResponse)
async def check_slug(
    payload: dict,
    session: AsyncSession = Depends(get_db),
):
    raw = (payload.get("slug") or payload.get("company_name") or "").strip()
    base = normalize_slug(raw)
    if not base:
        return SlugCheckResponse(
            slug="", available=False, suggestion=None, reason="empty"
        )
    if not is_valid_slug(base):
        reason = "too_short" if len(base) < 2 else "invalid"
        return SlugCheckResponse(
            slug=base, available=False, suggestion=None, reason=reason
        )
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
async def register(
    payload: RegisterRequest,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    email = payload.email.lower().strip()

    existing = await _find_platform_user(session, email)
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    # Resolve country (ISO-2 preferred; fall back to display name → EC)
    country_code = (payload.country_code or "").upper().strip()
    if not country_code:
        # Legacy clients send country="Ecuador" or "EC"
        raw = payload.country.strip()
        country_code = raw.upper() if len(raw) == 2 else "EC"
    country_row = await get_country(session, country_code)
    if not country_row or not country_row.is_active:
        raise HTTPException(
            status_code=400, detail=f"Country '{country_code}' is not available"
        )
    country_label = country_row.name

    validate_compliance_payload(
        country_row,
        is_pep=payload.is_pep,
        pep_details=payload.pep_details,
        uafe_declaration=payload.uafe_declaration,
        org_references=payload.org_references,
    )

    einvoice_config = None
    if country_code == "EC":
        addr = (payload.legal_address or "").strip()
        if len(addr) < 8:
            raise HTTPException(
                status_code=422,
                detail="Dirección fiscal del establecimiento requerida para Ecuador",
            )
        einvoice_config = datil_service.einvoice_config_from_registration(
            company_name=payload.company_name.strip(),
            legal_id=payload.legal_id.strip(),
            org_type=payload.org_type,
            country_code=country_code,
            legal_name=payload.legal_name,
            legal_address=addr,
            establecimiento=payload.establecimiento,
            punto_emision=payload.punto_emision,
        )

    if country_row.legal_id_pattern:
        if not re.match(country_row.legal_id_pattern, payload.legal_id.strip()):
            label = country_row.legal_id_label or "legal_id"
            raise HTTPException(400, f"Invalid {label} for {country_label}")

    desired_slug = (payload.slug or "").strip()
    base_slug = (
        normalize_slug(desired_slug)
        if desired_slug
        else normalize_slug(payload.company_name)
    )
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

    try:
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
            session.add(
                Tenant(
                    slug=slug,
                    name=payload.company_name.strip(),
                    status="inactive",
                    created_at=now,
                )
            )

        await session.flush()

        # Organizer → PostgreSQL
        org_row = Organizer(
            id=organizer_id,
            user_id=user_id,
            company_name=payload.company_name.strip(),
            legal_id=payload.legal_id.strip(),
            org_type=payload.org_type,
            email=email,
            phone=payload.phone.strip(),
            country=country_label,
            country_code=country_code,
            slug=slug,
            status="pending",
            rejection_reason=None,
            social_links=payload.social_links,
            is_pep=payload.is_pep,
            pep_details=payload.pep_details,
            uafe_declaration=payload.uafe_declaration,
            org_references=payload.org_references,
            signup_plan_code=payload.signup_plan_code,
            einvoice_config=einvoice_config,
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

        if verificante.applies_to(country_code, payload.org_type):
            try:
                org_row.verificante = await verificante.start_check(
                    organizer_id=organizer_id,
                    legal_id=payload.legal_id.strip(),
                    names=payload.company_name.strip(),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Verificante check failed for %s: %s", email, type(exc).__name__
                )
                org_row.verificante = verificante.failed_record(
                    identification=verificante.extract_cedula(payload.legal_id),
                    names=payload.company_name.strip(),
                    organizer_id=organizer_id,
                    error=type(exc).__name__,
                )
            await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(status_code=409, detail="Slug already taken, try another")

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
            f"{frontend_base}/onboarding?at={token}"
            if frontend_base
            else f"/onboarding?at={token}"
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

    return _issue_auth(response, user_row, org_row, slug)


# ── Buyer register (per organizer page) ───────────────────────────────────────


@router.post("/register-buyer", response_model=AuthMeResponse)
async def register_buyer(
    payload: BuyerRegisterRequest,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    email = payload.email.lower().strip()
    org_row = await _organizer_by_slug(session, payload.tenant_slug)
    existing = await _find_buyer(session, email, org_row.id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail="Este email ya tiene una cuenta en esta página. Iniciá sesión para comprar.",
        )

    now = datetime.now(timezone.utc)
    user_row = User(
        id=str(uuid.uuid4()),
        email=email,
        password_hash=hash_password(payload.password),
        role="buyer",
        organizer_id=org_row.id,
        display_name=payload.name.strip()[:140],
        phone=(payload.phone or "").strip()[:40] or None,
        created_at=now,
        last_login=now,
    )
    session.add(user_row)
    try:
        await session.flush()
    except IntegrityError:
        await session.rollback()
        raise HTTPException(
            status_code=409,
            detail="Este email ya tiene una cuenta en esta página. Iniciá sesión para comprar.",
        )
    await _claim_guest_purchases(session, user_row.id, email, org_row.id)

    return _issue_auth(response, user_row, None, org_row.slug)


# ── Login ─────────────────────────────────────────────────────────────────────


@router.post("/login", response_model=AuthMeResponse)
async def login(
    payload: LoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    email = payload.email.lower().strip()
    tenant_slug = (payload.tenant_slug or "").strip().lower() or None

    user_row: Optional[User] = None
    org_for_page: Optional[Organizer] = None
    if tenant_slug:
        org_for_page = await _organizer_by_slug(session, tenant_slug)
        candidate = await _find_platform_user(session, email)
        if candidate and candidate.organizer_id == org_for_page.id:
            user_row = candidate
        else:
            user_row = await _find_buyer(session, email, org_for_page.id)

    if user_row is None:
        user_row = await _find_platform_user(session, email)

    if (
        not user_row
        or not user_row.password_hash
        or not verify_password(payload.password, user_row.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    user_row.last_login = datetime.now(timezone.utc)
    await _claim_guest_purchases(
        session,
        user_row.id,
        email,
        user_row.organizer_id if user_row.role == "buyer" else None,
    )

    org_row = None
    tenant_out = None
    if user_row.role != "buyer" and user_row.organizer_id:
        org_result = await session.execute(
            select(Organizer)
            .where(Organizer.id == user_row.organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_row = org_result.scalar_one_or_none()
        tenant_out = org_row.slug if org_row else None
    elif user_row.role == "buyer":
        tenant_out = (
            org_for_page.slug
            if org_for_page
            else await _slug_for_user(session, user_row)
        )

    await session.flush()
    return _issue_auth(response, user_row, org_row, tenant_out)


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
    token_version = user_row.token_version or 0
    if payload.get("ver", 0) != token_version:
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    user_row.token_version = token_version + 1
    await session.flush()
    access = create_access_token(user_row.id, user_row.email, user_row.role)
    new_refresh = create_refresh_token(user_row.id, user_row.token_version)
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
    tenant_slug = None
    if user_row.organizer_id:
        org_result = await session.execute(
            select(Organizer)
            .where(Organizer.id == user_row.organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_row = org_result.scalar_one_or_none()
        tenant_slug = org_row.slug if org_row else None

    return AuthMeResponse(
        user=_user_row_to_out(user_row, tenant_slug),
        organizer=_org_row_to_out(org_row) if user_row.role != "buyer" else None,
    )


# ── Social login (Google / Apple) ─────────────────────────────────────────────


@router.get("/social-providers")
async def social_providers():
    return {"providers": enabled_social_providers()}


@router.post("/social", response_model=AuthMeResponse)
async def social_login(
    payload: SocialLoginRequest,
    response: Response,
    session: AsyncSession = Depends(get_db),
):
    org_row = await _organizer_by_slug(session, payload.tenant_slug)
    identity = verify_social_token(payload.provider, payload.id_token)
    subject = identity["subject"]
    email = (identity.get("email") or (payload.email or "")).strip().lower()
    name = display_name_from_social(identity.get("name") or "", email, payload.name)

    linked = await session.scalar(
        select(UserOAuthIdentity).where(
            UserOAuthIdentity.organizer_id == org_row.id,
            UserOAuthIdentity.provider == payload.provider,
            UserOAuthIdentity.provider_subject == subject,
        )
    )
    user_row: Optional[User] = None
    if linked:
        user_row = await session.scalar(select(User).where(User.id == linked.user_id))

    if user_row is None and email:
        user_row = await _find_buyer(session, email, org_row.id)
        if user_row is None:
            candidate = await _find_platform_user(session, email)
            if candidate and candidate.organizer_id == org_row.id:
                user_row = candidate

    if user_row is None:
        if not email:
            raise HTTPException(
                status_code=400,
                detail="No pudimos obtener tu email. Autorizá el email en Google/Apple o registrate con contraseña.",
            )
        now = datetime.now(timezone.utc)
        user_row = User(
            id=str(uuid.uuid4()),
            email=email,
            password_hash=None,
            role="buyer",
            organizer_id=org_row.id,
            display_name=name,
            created_at=now,
            last_login=now,
        )
        session.add(user_row)
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Este email ya tiene una cuenta en esta página. Iniciá sesión para comprar.",
            )
        await _claim_guest_purchases(session, user_row.id, email, org_row.id)

    if linked is None:
        session.add(
            UserOAuthIdentity(
                id=str(uuid.uuid4()),
                user_id=user_row.id,
                organizer_id=org_row.id,
                provider=payload.provider,
                provider_subject=subject,
                email=email or user_row.email,
            )
        )
        try:
            await session.flush()
        except IntegrityError:
            await session.rollback()
            raise HTTPException(
                status_code=409,
                detail="Esta cuenta social ya está vinculada en esta página.",
            )

    user_row.last_login = datetime.now(timezone.utc)
    org_out = None
    if user_row.role != "buyer" and user_row.organizer_id:
        org_result = await session.execute(
            select(Organizer)
            .where(Organizer.id == user_row.organizer_id)
            .options(selectinload(Organizer.admin_comments))
        )
        org_out = org_result.scalar_one_or_none()
    await session.flush()
    return _issue_auth(response, user_row, org_out, org_row.slug)
