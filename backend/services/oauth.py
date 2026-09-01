"""Verify Google / Apple identity tokens for buyer social login."""

from __future__ import annotations

import os
from typing import Optional

from fastapi import HTTPException

SUPPORTED_PROVIDERS = ("google", "apple")


def _google_client_id() -> str:
    return (
        os.environ.get("GOOGLE_CLIENT_ID")
        or os.environ.get("GOOGLE_OAUTH_CLIENT_ID")
        or ""
    ).strip()


def _apple_client_id() -> str:
    return (
        os.environ.get("APPLE_CLIENT_ID") or os.environ.get("APPLE_SERVICE_ID") or ""
    ).strip()


def enabled_social_providers() -> list[dict]:
    """Public client IDs for the frontend buttons. Empty list = hide social UI."""
    out: list[dict] = []
    google = _google_client_id()
    if google:
        out.append({"id": "google", "client_id": google})
    apple = _apple_client_id()
    if apple:
        out.append({"id": "apple", "client_id": apple})
    return out


def verify_social_token(provider: str, id_token: str) -> dict:
    """Return {subject, email, name} from a provider identity token."""
    provider = (provider or "").strip().lower()
    token = (id_token or "").strip()
    if not token:
        raise HTTPException(
            status_code=400, detail="Falta el token de la cuenta social."
        )
    if provider == "google":
        return _verify_google(token)
    if provider == "apple":
        return _verify_apple(token)
    raise HTTPException(status_code=400, detail=f"Proveedor '{provider}' no soportado.")


def _verify_google(token: str) -> dict:
    client_id = _google_client_id()
    if not client_id:
        raise HTTPException(
            status_code=503, detail="Google Sign-In no está configurado."
        )
    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError as exc:  # pragma: no cover
        raise HTTPException(
            status_code=503, detail="Google Sign-In no está disponible."
        ) from exc
    try:
        info = id_token.verify_oauth2_token(token, google_requests.Request(), client_id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=401, detail="Token de Google inválido."
        ) from exc
    iss = info.get("iss")
    if iss not in ("accounts.google.com", "https://accounts.google.com"):
        raise HTTPException(status_code=401, detail="Token de Google inválido.")
    if not info.get("email_verified"):
        raise HTTPException(
            status_code=401, detail="El email de Google no está verificado."
        )
    email = (info.get("email") or "").strip().lower()
    if not email:
        raise HTTPException(status_code=401, detail="Google no envió un email.")
    return {
        "subject": str(info["sub"]),
        "email": email,
        "name": (info.get("name") or "").strip(),
    }


def _verify_apple(token: str) -> dict:
    client_id = _apple_client_id()
    if not client_id:
        raise HTTPException(
            status_code=503, detail="Apple Sign-In no está configurado."
        )
    import jwt
    from jwt import PyJWKClient

    try:
        jwk_client = PyJWKClient("https://appleid.apple.com/auth/keys")
        signing_key = jwk_client.get_signing_key_from_jwt(token)
        info = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            audience=client_id,
            issuer="https://appleid.apple.com",
        )
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=401, detail="Token de Apple inválido.") from exc
    email = (info.get("email") or "").strip().lower()
    return {
        "subject": str(info["sub"]),
        "email": email,
        "name": "",
    }


def display_name_from_social(
    token_name: str, fallback_email: str, extra_name: Optional[str] = None
) -> str:
    name = (extra_name or "").strip() or (token_name or "").strip()
    if name:
        return name[:140]
    local = (fallback_email or "").split("@")[0].replace(".", " ").replace("_", " ")
    return local[:140] or "Comprador"
