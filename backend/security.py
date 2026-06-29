"""Auth helpers: password hashing, JWT, dependencies for FastAPI routes."""
import os
from datetime import datetime, timezone, timedelta
from typing import Optional

import bcrypt
import jwt
from fastapi import Depends, HTTPException, Request

from models import UserRole

# Staff tokens carry organizer_id and roles list in the payload.
# They are short-lived (same as access tokens) and identify a StaffMember row,
# not a User row — so get_current_staff looks up staff_members, not users.

JWT_ALGORITHM = "HS256"
ACCESS_EXPIRE_MIN = 30
REFRESH_EXPIRE_DAYS = 7

ACCESS_COOKIE = "tys_access"
REFRESH_COOKIE = "tys_refresh"


# ──────────────────────────────────────────────────────────────────────────────
# Password hashing
# ──────────────────────────────────────────────────────────────────────────────
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


# ──────────────────────────────────────────────────────────────────────────────
# JWT
# ──────────────────────────────────────────────────────────────────────────────
def _jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "type": "refresh",
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_EXPIRE_DAYS),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")
    if payload.get("type") != expected_type:
        raise HTTPException(status_code=401, detail="Invalid token type")
    return payload


# ──────────────────────────────────────────────────────────────────────────────
# Cookie helpers
# ──────────────────────────────────────────────────────────────────────────────
def set_auth_cookies(response, access: str, refresh: str) -> None:
    # In preview (HTTPS), secure=True+SameSite=None lets cookies work cross-origin.
    # In local http, browser will still accept SameSite=Lax with secure=False.
    secure_flag = os.environ.get("ENV", "development") != "development_local"
    same_site = "none" if secure_flag else "lax"
    response.set_cookie(
        key=ACCESS_COOKIE,
        value=access,
        httponly=True,
        secure=secure_flag,
        samesite=same_site,
        max_age=ACCESS_EXPIRE_MIN * 60,
        path="/",
    )
    response.set_cookie(
        key=REFRESH_COOKIE,
        value=refresh,
        httponly=True,
        secure=secure_flag,
        samesite=same_site,
        max_age=REFRESH_EXPIRE_DAYS * 24 * 3600,
        path="/",
    )


def clear_auth_cookies(response) -> None:
    response.delete_cookie(ACCESS_COOKIE, path="/")
    response.delete_cookie(REFRESH_COOKIE, path="/")


# ──────────────────────────────────────────────────────────────────────────────
# Dependencies
# ──────────────────────────────────────────────────────────────────────────────
def _extract_token(request: Request, cookie_name: str) -> Optional[str]:
    token = request.cookies.get(cookie_name)
    if token:
        return token
    auth = request.headers.get("Authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return None


async def get_current_user(request: Request) -> dict:
    token = _extract_token(request, ACCESS_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token, "access")

    # Staff tokens (role=org_staff) are self-contained — no User row exists.
    # Return the payload directly so ticket validation and scan-stats work for staff.
    if payload.get("role") == "org_staff":
        return {
            "id": payload["sub"],
            "email": payload.get("email", ""),
            "role": "org_staff",
            "organizer_id": payload.get("organizer_id"),
            "staff_roles": payload.get("staff_roles", []),
        }

    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import User
    from db_helpers import row_to_dict
    async with AsyncSessionLocal() as session:
        result = await session.execute(select(User).where(User.id == payload["sub"]))
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="User not found")
    d = row_to_dict(row)
    d.pop("password_hash", None)
    return d


def require_role(*roles: UserRole):
    async def dep(user: dict = Depends(get_current_user)) -> dict:
        if user.get("role") not in roles:
            raise HTTPException(status_code=403, detail="Forbidden")
        return user
    return dep


async def get_refresh_payload(request: Request) -> dict:
    token = _extract_token(request, REFRESH_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="No refresh token")
    return decode_token(token, "refresh")


# ──────────────────────────────────────────────────────────────────────────────
# Staff JWT (Phase 8)
# ──────────────────────────────────────────────────────────────────────────────
def create_staff_token(staff_id: str, email: str, organizer_id: str, roles: list) -> str:
    payload = {
        "sub": staff_id,
        "email": email,
        "role": "org_staff",
        "organizer_id": organizer_id,
        "staff_roles": roles,
        "type": "access",
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_EXPIRE_MIN),
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


async def get_current_staff(request: Request) -> dict:
    """Dependency for routes that only staff (org_staff role) can access."""
    token = _extract_token(request, ACCESS_COOKIE)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = decode_token(token, "access")
    if payload.get("role") != "org_staff":
        raise HTTPException(status_code=403, detail="Staff access required")
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import StaffMember
    from db_helpers import row_to_dict
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(StaffMember).where(
                StaffMember.id == payload["sub"],
                StaffMember.active == True,  # noqa: E712
            )
        )
        row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=401, detail="Staff not found or inactive")
    d = row_to_dict(row)
    d.pop("password_hash", None)
    return d


def require_staff_role(role: str):
    """Check that the authenticated staff has a specific role in their roles list."""
    async def dep(staff: dict = Depends(get_current_staff)) -> dict:
        if role not in (staff.get("roles") or []):
            raise HTTPException(status_code=403, detail=f"Requires staff role: {role}")
        return staff
    return dep
