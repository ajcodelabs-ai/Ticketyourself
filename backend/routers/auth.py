"""Auth router: register, login, logout, refresh, me, slug-check."""
import logging
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response

from db import db
from models import (
    AuthMeResponse,
    LoginRequest,
    OrganizerOut,
    RegisterRequest,
    SlugCheckResponse,
    UserOut,
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
from services.activation import (
    create_activation_token,
    ensure_activation_record,
)
from services.email_service import send_welcome_email
from slugs import find_unique_slug, is_valid_slug, normalize_slug

logger = logging.getLogger("tys.auth")

router = APIRouter(prefix="/api/auth", tags=["auth"])


async def _organizer_to_out(organizer_doc: Optional[dict]) -> Optional[OrganizerOut]:
    if not organizer_doc:
        return None
    plan_code = None
    if organizer_doc.get("plan_id"):
        plan = await db.subscription_plans.find_one(
            {"id": organizer_doc["plan_id"]}, {"_id": 0, "code": 1}
        )
        if plan:
            plan_code = plan["code"]
    return OrganizerOut(plan_code=plan_code, **organizer_doc)


def _user_to_out(user_doc: dict) -> UserOut:
    return UserOut(**user_doc)


@router.post("/check-slug", response_model=SlugCheckResponse)
async def check_slug(payload: dict):
    raw = (payload.get("slug") or payload.get("company_name") or "").strip()
    base = normalize_slug(raw)
    if not base:
        # Input normalised to empty (user typed only spaces / symbols).
        return SlugCheckResponse(
            slug="", available=False, suggestion=None, reason="empty"
        )
    if not is_valid_slug(base):
        # 1 char or contains invalid characters after normalisation.
        # Surface a specific reason so the UI explains why instead of saying
        # "ya está en uso" (which would be misleading).
        reason = "too_short" if len(base) < 2 else "invalid"
        return SlugCheckResponse(
            slug=base, available=False, suggestion=None, reason=reason
        )
    suggestion = await find_unique_slug(base, db.organizers)
    available = suggestion == base
    return SlugCheckResponse(
        slug=base,
        available=available,
        suggestion=suggestion if not available else None,
        reason=None if available else "taken",
    )


@router.post("/register", response_model=AuthMeResponse)
async def register(payload: RegisterRequest):
    email = payload.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=409, detail="Email already registered")

    desired_slug = (payload.slug or "").strip()
    base_slug = normalize_slug(desired_slug) if desired_slug else normalize_slug(payload.company_name)
    if not base_slug:
        raise HTTPException(status_code=400, detail="Invalid slug")
    if not is_valid_slug(base_slug):
        raise HTTPException(status_code=400, detail="Slug contains invalid characters")
    slug = await find_unique_slug(base_slug, db.organizers)
    if desired_slug and slug != base_slug:
        raise HTTPException(
            status_code=409,
            detail=f"Slug '{base_slug}' is taken. Suggestion: {slug}",
        )

    now = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())
    organizer_id = str(uuid.uuid4())

    await db.users.insert_one(
        {
            "id": user_id,
            "email": email,
            "password_hash": hash_password(payload.password),
            "role": "organizer",
            "organizer_id": organizer_id,
            "created_at": now,
            "last_login": None,
        }
    )

    await db.organizers.insert_one(
        {
            "id": organizer_id,
            "user_id": user_id,
            "company_name": payload.company_name.strip(),
            "legal_id": payload.legal_id.strip(),
            "org_type": payload.org_type,
            "email": email,
            "phone": payload.phone.strip(),
            "country": payload.country.strip(),
            "slug": slug,
            "status": "pending",
            "rejection_reason": None,
            "admin_comments": [],
            "plan_id": None,
            "subscription_status": "none",
            "stripe_customer_id": None,
            "stripe_subscription_id": None,
            "current_period_end": None,
            "created_at": now,
            "approved_at": None,
            "approved_by": None,
        }
    )

    await db.tenants.update_one(
        {"slug": slug},
        {
            "$set": {"name": payload.company_name.strip(), "status": "inactive"},
            "$setOnInsert": {
                "id": str(uuid.uuid4()),
                "slug": slug,
                "created_at": now,
            },
        },
        upsert=True,
    )

    user_doc = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    organizer_doc = await db.organizers.find_one({"id": organizer_id}, {"_id": 0})
    logger.info("Registered organizer slug=%s email=%s", slug, email)

    # Fire-and-forget welcome email + activation record (best-effort).
    try:
        token = create_activation_token(user_id=user_id, organizer_id=organizer_id)
        # JTI for the row — extract from the JWT itself.
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

    return AuthMeResponse(
        user=_user_to_out(user_doc),
        organizer=await _organizer_to_out(organizer_doc),
    )


@router.post("/login", response_model=AuthMeResponse)
async def login(payload: LoginRequest, response: Response):
    email = payload.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Email o contraseña incorrectos")

    user_safe = {k: v for k, v in user.items() if k not in ("_id", "password_hash")}
    access = create_access_token(user_safe["id"], user_safe["email"], user_safe["role"])
    refresh = create_refresh_token(user_safe["id"])
    set_auth_cookies(response, access, refresh)

    await db.users.update_one(
        {"id": user_safe["id"]},
        {"$set": {"last_login": datetime.now(timezone.utc).isoformat()}},
    )

    organizer_doc = None
    if user_safe.get("organizer_id"):
        organizer_doc = await db.organizers.find_one(
            {"id": user_safe["organizer_id"]}, {"_id": 0}
        )

    return AuthMeResponse(
        user=_user_to_out(user_safe),
        organizer=await _organizer_to_out(organizer_doc),
        access_token=access,
        refresh_token=refresh,
    )


@router.post("/logout")
async def logout(response: Response):
    clear_auth_cookies(response)
    return {"ok": True}


@router.post("/refresh")
async def refresh_token(request: Request, response: Response):
    payload = await get_refresh_payload(request)
    user = await db.users.find_one({"id": payload["sub"]}, {"_id": 0, "password_hash": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    access = create_access_token(user["id"], user["email"], user["role"])
    new_refresh = create_refresh_token(user["id"])
    set_auth_cookies(response, access, new_refresh)
    return {"ok": True, "access_token": access, "refresh_token": new_refresh}


@router.get("/me", response_model=AuthMeResponse)
async def me(user: dict = Depends(get_current_user)):
    organizer_doc = None
    if user.get("organizer_id"):
        organizer_doc = await db.organizers.find_one(
            {"id": user["organizer_id"]}, {"_id": 0}
        )
    return AuthMeResponse(
        user=_user_to_out(user),
        organizer=await _organizer_to_out(organizer_doc),
    )
