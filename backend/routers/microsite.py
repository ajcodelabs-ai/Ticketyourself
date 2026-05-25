"""Microsite endpoints (organizer-owned editor + public read-only views)."""
import logging
import mimetypes
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from db import db
from security import get_current_user
from services.microsite_factory import default_microsite, FONTS, TEMPLATES

logger = logging.getLogger("tys.microsite")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "microsite_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

router = APIRouter(prefix="/api/microsite", tags=["microsite"])
public_router = APIRouter(prefix="/api/public/microsite", tags=["microsite-public"])
asset_router = APIRouter(prefix="/api/microsite", tags=["microsite-assets"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _project(doc: dict) -> dict:
    if not doc:
        return doc
    doc.pop("_id", None)
    return doc


# ── Models ───────────────────────────────────────────────────────────────────
class BrandingIn(BaseModel):
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    font_family: Optional[str] = None


class ContentIn(BaseModel):
    hero_title: Optional[str] = Field(default=None, max_length=80)
    hero_subtitle: Optional[str] = Field(default=None, max_length=200)
    hero_cta_text: Optional[str] = Field(default=None, max_length=30)
    about_title: Optional[str] = Field(default=None, max_length=80)
    about_body: Optional[str] = Field(default=None, max_length=1000)
    contact_email: Optional[str] = Field(default=None, max_length=120)
    contact_phone: Optional[str] = Field(default=None, max_length=40)
    address: Optional[str] = Field(default=None, max_length=200)


class SocialIn(BaseModel):
    instagram: Optional[str] = None
    facebook: Optional[str] = None
    twitter: Optional[str] = None
    tiktok: Optional[str] = None
    youtube: Optional[str] = None
    whatsapp: Optional[str] = None


class SectionsIn(BaseModel):
    hero: Optional[bool] = None
    about: Optional[bool] = None
    events: Optional[bool] = None
    contact: Optional[bool] = None
    social: Optional[bool] = None


class MicrositeUpdate(BaseModel):
    template: Optional[str] = None
    branding: Optional[BrandingIn] = None
    content: Optional[ContentIn] = None
    social_links: Optional[SocialIn] = None
    sections_enabled: Optional[SectionsIn] = None


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _require_approved_organizer(user) -> dict:
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    organizer = await db.organizers.find_one(
        {"id": user["organizer_id"]}, {"_id": 0}
    )
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")
    if organizer["status"] != "approved":
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta debe estar aprobada para acceder al microsite",
        )
    return organizer


async def _get_or_create_microsite(organizer: dict) -> dict:
    found = await db.microsites.find_one(
        {"organizer_id": organizer["id"]}, {"_id": 0}
    )
    if found:
        return found
    doc = default_microsite(
        organizer_id=organizer["id"],
        tenant_slug=organizer["slug"],
        company_name=organizer.get("company_name") or organizer["slug"],
    )
    await db.microsites.insert_one({**doc})
    logger.info("Created default microsite for %s", organizer["slug"])
    return _project(doc)


def _validate_partial(update: MicrositeUpdate) -> None:
    if update.template and update.template not in TEMPLATES:
        raise HTTPException(status_code=422, detail=f"Invalid template. Options: {TEMPLATES}")
    if update.branding:
        b = update.branding
        if b.primary_color and not HEX_COLOR.match(b.primary_color):
            raise HTTPException(status_code=422, detail="primary_color must be hex #RRGGBB")
        if b.secondary_color and not HEX_COLOR.match(b.secondary_color):
            raise HTTPException(status_code=422, detail="secondary_color must be hex #RRGGBB")
        if b.font_family and b.font_family not in FONTS:
            raise HTTPException(status_code=422, detail=f"font_family must be one of {FONTS}")


# ── Organizer endpoints ─────────────────────────────────────────────────────
@router.get("/me")
async def get_my_microsite(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    microsite = await _get_or_create_microsite(organizer)
    return microsite


@router.put("/me")
async def update_my_microsite(payload: MicrositeUpdate, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    microsite = await _get_or_create_microsite(organizer)
    _validate_partial(payload)

    update: dict = {"updated_at": _now_iso()}
    if payload.template:
        update["template"] = payload.template
    if payload.branding:
        for k, v in payload.branding.model_dump(exclude_unset=True).items():
            if v is not None:
                update[f"branding.{k}"] = v
    if payload.content:
        for k, v in payload.content.model_dump(exclude_unset=True).items():
            if v is not None:
                update[f"content.{k}"] = v
    if payload.social_links:
        for k, v in payload.social_links.model_dump(exclude_unset=True).items():
            if v is not None:
                update[f"social_links.{k}"] = v
    if payload.sections_enabled:
        for k, v in payload.sections_enabled.model_dump(exclude_unset=True).items():
            if v is not None:
                update[f"sections_enabled.{k}"] = v

    await db.microsites.update_one({"id": microsite["id"]}, {"$set": update})
    refreshed = await db.microsites.find_one({"id": microsite["id"]}, {"_id": 0})
    return refreshed


@router.post("/me/publish")
async def publish(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    microsite = await _get_or_create_microsite(organizer)
    await db.microsites.update_one(
        {"id": microsite["id"]},
        {"$set": {"published": True, "updated_at": _now_iso()}},
    )
    return {"ok": True, "published": True}


@router.post("/me/unpublish")
async def unpublish(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    microsite = await _get_or_create_microsite(organizer)
    await db.microsites.update_one(
        {"id": microsite["id"]},
        {"$set": {"published": False, "updated_at": _now_iso()}},
    )
    return {"ok": True, "published": False}


@router.post("/me/assets", status_code=201)
async def upload_asset(
    asset_type: str = Form(...),
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    organizer = await _require_approved_organizer(user)
    if asset_type not in ("logo", "banner", "gallery"):
        raise HTTPException(status_code=422, detail="asset_type must be logo|banner|gallery")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(status_code=415, detail="Only JPEG/PNG/WEBP allowed")

    content = await file.read()
    if len(content) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="File too large (5MB max)")

    ext = mimetypes.guess_extension(file.content_type) or ".bin"
    asset_id = str(uuid.uuid4())
    safe_name = re.sub(r"[^a-zA-Z0-9._-]", "_", file.filename or "asset")[:60]
    rel_path = f"{organizer['id']}/{asset_id}{ext}"
    abs_path = ASSETS_DIR / rel_path
    abs_path.parent.mkdir(parents=True, exist_ok=True)
    abs_path.write_bytes(content)

    record = {
        "id": asset_id,
        "organizer_id": organizer["id"],
        "asset_type": asset_type,
        "file_path": str(rel_path),
        "original_filename": safe_name,
        "mime_type": file.content_type,
        "size_bytes": len(content),
        "uploaded_at": _now_iso(),
    }
    await db.microsite_assets.insert_one({**record})

    # Update microsite branding shortcut for logo / banner.
    microsite = await _get_or_create_microsite(organizer)
    asset_url = f"/api/microsite/assets/{asset_id}"
    if asset_type == "logo":
        await db.microsites.update_one(
            {"id": microsite["id"]},
            {"$set": {"branding.logo_url": asset_url, "updated_at": _now_iso()}},
        )
    elif asset_type == "banner":
        await db.microsites.update_one(
            {"id": microsite["id"]},
            {"$set": {"branding.banner_url": asset_url, "updated_at": _now_iso()}},
        )
    return {**record, "url": asset_url}


@router.delete("/me/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    asset = await db.microsite_assets.find_one(
        {"id": asset_id, "organizer_id": organizer["id"]}, {"_id": 0}
    )
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = ASSETS_DIR / asset["file_path"]
    try:
        if abs_path.exists():
            abs_path.unlink()
    except OSError as e:
        logger.warning("Cannot delete asset file %s: %s", abs_path, e)
    await db.microsite_assets.delete_one({"id": asset_id})

    # Clear any branding ref to this asset.
    asset_url = f"/api/microsite/assets/{asset_id}"
    await db.microsites.update_many(
        {"organizer_id": organizer["id"]},
        {
            "$set": {"updated_at": _now_iso()},
            "$unset": {},  # placeholder, handled below
        },
    )
    # MongoDB doesn't support conditional unset in single op; do explicit clears.
    await db.microsites.update_many(
        {"organizer_id": organizer["id"], "branding.logo_url": asset_url},
        {"$set": {"branding.logo_url": None}},
    )
    await db.microsites.update_many(
        {"organizer_id": organizer["id"], "branding.banner_url": asset_url},
        {"$set": {"branding.banner_url": None}},
    )
    return None


# ── Public asset serving ─────────────────────────────────────────────────────
@asset_router.get("/assets/{asset_id}")
async def serve_asset(asset_id: str):
    asset = await db.microsite_assets.find_one({"id": asset_id}, {"_id": 0})
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = ASSETS_DIR / asset["file_path"]
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        abs_path,
        media_type=asset.get("mime_type", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ── Public microsite ────────────────────────────────────────────────────────
@public_router.get("/{slug}")
async def public_microsite(slug: str):
    organizer = await db.organizers.find_one({"slug": slug}, {"_id": 0})
    if not organizer:
        raise HTTPException(status_code=404, detail="Not found")
    tenant = await db.tenants.find_one({"slug": slug}, {"_id": 0})
    if not tenant or tenant.get("status") != "active":
        raise HTTPException(status_code=404, detail="Not available")
    microsite = await db.microsites.find_one(
        {"organizer_id": organizer["id"], "published": True}, {"_id": 0}
    )
    if not microsite:
        raise HTTPException(status_code=404, detail="Microsite not published")
    # Trim sensitive fields.
    return {
        "slug": slug,
        "company_name": organizer["company_name"],
        "template": microsite["template"],
        "branding": microsite["branding"],
        "content": microsite["content"],
        "social_links": microsite["social_links"],
        "sections_enabled": microsite["sections_enabled"],
    }


@public_router.get("/{slug}/events")
async def public_microsite_events(slug: str):
    """Placeholder until Fase 3 wires real events."""
    organizer = await db.organizers.find_one({"slug": slug}, {"_id": 0, "id": 1})
    if not organizer:
        raise HTTPException(status_code=404, detail="Not found")
    return []
