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
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.orm.attributes import flag_modified

from database import AsyncSessionLocal
from db_helpers import get_organizer_by_id, get_organizer_by_slug, row_to_dict
from orm_models import Microsite, MicrositeAsset, MicrositeRevision, Organizer, Tenant
from security import get_current_user
from services.microsite_factory import default_microsite, FONTS, TEMPLATES
from services.microsite_blocks import (
    blocks_for_template,
    resolve_blocks,
    sections_from_blocks,
    validate_blocks,
)
from services.microsite_revisions import apply_snapshot, build_snapshot, create_revision
from services.microsite_seo import validate_custom_css, validate_seo
from services.path_safety import resolve_path_under

logger = logging.getLogger("tys.microsite")

ASSETS_DIR = Path(__file__).resolve().parent.parent / "microsite_assets"
ASSETS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 5 * 1024 * 1024  # 5 MB
HEX_COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")

router = APIRouter(prefix="/api/microsite", tags=["microsite"])
public_router = APIRouter(prefix="/api/public/microsite", tags=["microsite-public"])
asset_router = APIRouter(prefix="/api/microsite", tags=["microsite-assets"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ── Models ───────────────────────────────────────────────────────────────────
class BrandingIn(BaseModel):
    primary_color: Optional[str] = None
    secondary_color: Optional[str] = None
    logo_url: Optional[str] = None
    banner_url: Optional[str] = None
    font_family: Optional[str] = None
    custom_css: Optional[str] = Field(default=None, max_length=8000)


class SeoIn(BaseModel):
    meta_title: Optional[str] = Field(default=None, max_length=70)
    meta_description: Optional[str] = Field(default=None, max_length=160)
    og_image_url: Optional[str] = Field(default=None, max_length=500)


class ContentIn(BaseModel):
    hero_title: Optional[str] = Field(default=None, max_length=80)
    hero_subtitle: Optional[str] = Field(default=None, max_length=200)
    hero_cta_text: Optional[str] = Field(default=None, max_length=30)
    hero_cta_href: Optional[str] = Field(default=None, max_length=500)
    about_title: Optional[str] = Field(default=None, max_length=80)
    about_body: Optional[str] = Field(default=None, max_length=1000)
    about_body_html: Optional[str] = Field(default=None, max_length=8000)
    contact_email: Optional[EmailStr] = Field(default=None, max_length=120)
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


class BlockIn(BaseModel):
    id: Optional[str] = None
    type: str
    enabled: bool = True
    props: Optional[dict] = None


class MicrositeUpdate(BaseModel):
    template: Optional[str] = None
    branding: Optional[BrandingIn] = None
    content: Optional[ContentIn] = None
    social_links: Optional[SocialIn] = None
    sections_enabled: Optional[SectionsIn] = None
    blocks: Optional[list[BlockIn]] = None
    seo: Optional[SeoIn] = None


class RevisionCreateIn(BaseModel):
    label: Optional[str] = Field(default=None, max_length=120)


# ── Helpers ──────────────────────────────────────────────────────────────────
async def _require_active_organizer(user) -> dict:
    if not user.get("organizer_id"):
        raise HTTPException(status_code=403, detail="No organizer profile")
    organizer = await get_organizer_by_id(user["organizer_id"])
    if not organizer:
        raise HTTPException(status_code=404, detail="Organizer not found")
    if organizer["status"] not in {"pending", "approved"}:
        raise HTTPException(
            status_code=403,
            detail="Tu cuenta no tiene acceso al editor de microsite",
        )
    return organizer


async def _require_can_publish_microsite(user) -> dict:
    organizer = await _require_active_organizer(user)
    if organizer["status"] != "approved":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "organizer_pending_review",
                "message": (
                    "Tu cuenta está en revisión. Una vez aprobada vas a poder "
                    "publicar tu microsite. Podés seguir editándolo libremente "
                    "mientras tanto."
                ),
            },
        )
    return organizer


_require_approved_organizer = _require_active_organizer


async def _get_or_create_microsite_row(organizer: dict) -> Microsite:
    """Returns the ORM row, creating a default one if missing."""
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if row:
            return row
        doc = default_microsite(
            organizer_id=organizer["id"],
            tenant_slug=organizer["slug"],
            company_name=organizer.get("company_name") or organizer["slug"],
        )
        now = _now()
        row = Microsite(
            id=doc["id"],
            organizer_id=organizer["id"],
            slug=organizer["slug"],
            template=doc.get("template"),
            branding=doc.get("branding", {}),
            content=doc.get("content", {}),
            social_links=doc.get("social_links", {}),
            sections_enabled=doc.get("sections_enabled", {}),
            blocks=doc.get("blocks", []),
            seo=doc.get("seo", {}),
            published=doc.get("published", False),
            created_at=now,
            updated_at=now,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
        logger.info("Created default microsite for %s", organizer["slug"])
        return row


async def _get_or_create_microsite(organizer: dict) -> dict:
    row = await _get_or_create_microsite_row(organizer)
    data = row_to_dict(row)
    data["blocks"] = resolve_blocks(
        blocks=data.get("blocks"),
        template=data.get("template"),
        sections_enabled=data.get("sections_enabled"),
    )
    return data


def _validate_partial(update: MicrositeUpdate) -> None:
    if update.template and update.template not in TEMPLATES:
        raise HTTPException(
            status_code=422, detail=f"Invalid template. Options: {TEMPLATES}"
        )
    if update.blocks is not None:
        try:
            validate_blocks([b.model_dump() for b in update.blocks])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    if update.branding:
        b = update.branding
        if b.primary_color and not HEX_COLOR.match(b.primary_color):
            raise HTTPException(
                status_code=422, detail="primary_color must be hex #RRGGBB"
            )
        if b.secondary_color and not HEX_COLOR.match(b.secondary_color):
            raise HTTPException(
                status_code=422, detail="secondary_color must be hex #RRGGBB"
            )
        if b.font_family and b.font_family not in FONTS:
            raise HTTPException(
                status_code=422, detail=f"font_family must be one of {FONTS}"
            )
        if b.custom_css is not None:
            try:
                validate_custom_css(b.custom_css)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail=str(exc)) from exc


# ── Organizer endpoints ─────────────────────────────────────────────────────
@router.get("/me")
async def get_my_microsite(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    return await _get_or_create_microsite(organizer)


@router.put("/me")
async def update_my_microsite(payload: MicrositeUpdate, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    _validate_partial(payload)

    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not row:
            # Auto-create then reload in same session
            doc = default_microsite(
                organizer_id=organizer["id"],
                tenant_slug=organizer["slug"],
                company_name=organizer.get("company_name") or organizer["slug"],
            )
            now = _now()
            row = Microsite(
                id=doc["id"],
                organizer_id=organizer["id"],
                slug=organizer["slug"],
                template=doc.get("template"),
                branding=doc.get("branding", {}),
                content=doc.get("content", {}),
                social_links=doc.get("social_links", {}),
                sections_enabled=doc.get("sections_enabled", {}),
                blocks=doc.get("blocks", []),
                seo=doc.get("seo", {}),
                published=False,
                created_at=now,
                updated_at=now,
            )
            session.add(row)

        if payload.template:
            row.template = payload.template
            row.blocks = blocks_for_template(
                payload.template,
                dict(row.sections_enabled or {}),
            )
            flag_modified(row, "blocks")
        if payload.branding:
            new_branding = dict(row.branding or {})
            branding_data = payload.branding.model_dump(exclude_unset=True)
            if "custom_css" in branding_data:
                try:
                    branding_data["custom_css"] = validate_custom_css(
                        branding_data.get("custom_css")
                    )
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
            for k, v in branding_data.items():
                if v is not None or k == "custom_css":
                    new_branding[k] = v
            row.branding = new_branding
            flag_modified(row, "branding")
        if payload.content:
            new_content = dict(row.content or {})
            for k, v in payload.content.model_dump(exclude_unset=True).items():
                if v is not None:
                    new_content[k] = v
            row.content = new_content
            flag_modified(row, "content")
        if payload.social_links:
            new_social = dict(row.social_links or {})
            for k, v in payload.social_links.model_dump(exclude_unset=True).items():
                if v is not None:
                    new_social[k] = v
            row.social_links = new_social
            flag_modified(row, "social_links")
        if payload.sections_enabled:
            new_sections = dict(row.sections_enabled or {})
            for k, v in payload.sections_enabled.model_dump(exclude_unset=True).items():
                if v is not None:
                    new_sections[k] = v
            row.sections_enabled = new_sections
            flag_modified(row, "sections_enabled")
        if payload.blocks is not None:
            cleaned = validate_blocks(
                [b.model_dump() for b in payload.blocks]
            )
            row.blocks = cleaned
            row.sections_enabled = sections_from_blocks(cleaned)
            flag_modified(row, "blocks")
            flag_modified(row, "sections_enabled")

        if payload.seo:
            new_seo = validate_seo(dict(row.seo or {}))
            for k, v in payload.seo.model_dump(exclude_unset=True).items():
                if v is not None:
                    new_seo[k] = v
            row.seo = validate_seo(new_seo)
            flag_modified(row, "seo")

        row.updated_at = _now()
        await session.commit()
        await session.refresh(row)
        data = row_to_dict(row)
        data["blocks"] = resolve_blocks(
            blocks=data.get("blocks"),
            template=data.get("template"),
            sections_enabled=data.get("sections_enabled"),
        )
        return data


@router.post("/me/publish")
async def publish(user=Depends(get_current_user)):
    organizer = await _require_can_publish_microsite(user)
    now = _now()
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not row:
            raise HTTPException(404, "Microsite not found")
        await create_revision(
            session,
            microsite_id=row.id,
            snapshot=build_snapshot(row),
            label="Antes de publicar",
        )
        row.published = True
        row.published_at = now
        row.updated_at = now
        await session.commit()
    return {"ok": True, "published": True, "published_at": now.isoformat()}


@router.post("/me/unpublish")
async def unpublish(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not row:
            raise HTTPException(404, "Microsite not found")
        row.published = False
        row.updated_at = _now()
        await session.commit()
    return {"ok": True, "published": False}


@router.get("/me/revisions")
async def list_revisions(user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        ms = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not ms:
            raise HTTPException(404, "Microsite not found")
        result = await session.execute(
            select(MicrositeRevision)
            .where(MicrositeRevision.microsite_id == ms.id)
            .order_by(MicrositeRevision.created_at.desc())
            .limit(20)
        )
        rows = result.scalars().all()
    return [
        {
            "id": r.id,
            "label": r.label,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        }
        for r in rows
    ]


@router.post("/me/revisions", status_code=201)
async def save_revision(payload: RevisionCreateIn, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not row:
            raise HTTPException(404, "Microsite not found")
        rev = await create_revision(
            session,
            microsite_id=row.id,
            snapshot=build_snapshot(row),
            label=payload.label or "Guardado manual",
        )
        await session.commit()
    return {
        "id": rev.id,
        "label": rev.label,
        "created_at": rev.created_at.isoformat() if rev.created_at else None,
    }


@router.post("/me/revisions/{revision_id}/restore")
async def restore_revision(revision_id: str, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if not row:
            raise HTTPException(404, "Microsite not found")
        rev = await session.scalar(
            select(MicrositeRevision).where(
                MicrositeRevision.id == revision_id,
                MicrositeRevision.microsite_id == row.id,
            )
        )
        if not rev:
            raise HTTPException(404, "Revision not found")
        await create_revision(
            session,
            microsite_id=row.id,
            snapshot=build_snapshot(row),
            label="Antes de restaurar",
        )
        apply_snapshot(row, rev.snapshot)
        flag_modified(row, "branding")
        flag_modified(row, "content")
        flag_modified(row, "social_links")
        flag_modified(row, "sections_enabled")
        flag_modified(row, "blocks")
        flag_modified(row, "seo")
        row.updated_at = _now()
        await session.commit()
        await session.refresh(row)
        data = row_to_dict(row)
        data["blocks"] = resolve_blocks(
            blocks=data.get("blocks"),
            template=data.get("template"),
            sections_enabled=data.get("sections_enabled"),
        )
        return data


@router.post("/me/assets", status_code=201)
async def upload_asset(
    asset_type: str = Form(...),
    file: UploadFile = File(...),
    user=Depends(get_current_user),
):
    organizer = await _require_approved_organizer(user)
    if asset_type not in ("logo", "banner", "gallery"):
        raise HTTPException(
            status_code=422, detail="asset_type must be logo|banner|gallery"
        )
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

    asset_url = f"/api/microsite/assets/{asset_id}"
    now = _now()

    async with AsyncSessionLocal() as session:
        session.add(
            MicrositeAsset(
                id=asset_id,
                organizer_id=organizer["id"],
                asset_type=asset_type,
                file_path=str(rel_path),
                original_filename=safe_name,
                mime_type=file.content_type,
                size_bytes=len(content),
                uploaded_at=now,
            )
        )

        # Update branding shortcut for logo / banner
        ms_row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if ms_row and asset_type in ("logo", "banner"):
            new_branding = dict(ms_row.branding or {})
            new_branding[f"{asset_type}_url"] = asset_url
            ms_row.branding = new_branding
            flag_modified(ms_row, "branding")
            ms_row.updated_at = now

        await session.commit()

    record = {
        "id": asset_id,
        "organizer_id": organizer["id"],
        "asset_type": asset_type,
        "file_path": str(rel_path),
        "original_filename": safe_name,
        "mime_type": file.content_type,
        "size_bytes": len(content),
        "uploaded_at": now.isoformat(),
        "url": asset_url,
    }
    return record


@router.delete("/me/assets/{asset_id}", status_code=204)
async def delete_asset(asset_id: str, user=Depends(get_current_user)):
    organizer = await _require_approved_organizer(user)
    async with AsyncSessionLocal() as session:
        asset_row = await session.scalar(
            select(MicrositeAsset).where(
                MicrositeAsset.id == asset_id,
                MicrositeAsset.organizer_id == organizer["id"],
            )
        )
        if not asset_row:
            raise HTTPException(status_code=404, detail="Asset not found")
        abs_path = resolve_path_under(ASSETS_DIR, asset_row.file_path)
        if abs_path is None:
            raise HTTPException(status_code=403, detail="Forbidden")
        try:
            if abs_path.exists():
                abs_path.unlink()
        except OSError as e:
            logger.warning("Cannot delete asset file %s: %s", abs_path, e)

        asset_url = f"/api/microsite/assets/{asset_id}"
        ms_row = await session.scalar(
            select(Microsite).where(Microsite.organizer_id == organizer["id"])
        )
        if ms_row:
            branding = dict(ms_row.branding or {})
            changed = False
            if branding.get("logo_url") == asset_url:
                branding["logo_url"] = None
                changed = True
            if branding.get("banner_url") == asset_url:
                branding["banner_url"] = None
                changed = True
            if changed:
                ms_row.branding = branding
                flag_modified(ms_row, "branding")
                ms_row.updated_at = _now()

        await session.delete(asset_row)
        await session.commit()
    return None


# ── Public asset serving ─────────────────────────────────────────────────────
@asset_router.get("/assets/{asset_id}")
async def serve_asset(asset_id: str):
    async with AsyncSessionLocal() as session:
        asset_row = await session.scalar(
            select(MicrositeAsset).where(MicrositeAsset.id == asset_id)
        )
    if not asset_row:
        raise HTTPException(status_code=404, detail="Asset not found")
    abs_path = resolve_path_under(ASSETS_DIR, asset_row.file_path)
    if abs_path is None:
        raise HTTPException(status_code=403, detail="Forbidden")
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")
    return FileResponse(
        abs_path,
        media_type=asset_row.mime_type or "application/octet-stream",
        headers={
            "Cache-Control": "public, max-age=86400",
            "Content-Disposition": "attachment",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ── Public microsite ────────────────────────────────────────────────────────
@public_router.get("/{slug}")
async def public_microsite(slug: str):
    organizer = await get_organizer_by_slug(slug)
    if not organizer:
        raise HTTPException(status_code=404, detail="Not found")
    async with AsyncSessionLocal() as pg:
        tenant_result = await pg.execute(
            select(Tenant.status).where(Tenant.slug == slug)
        )
        tenant_row = tenant_result.first()
        if not tenant_row or tenant_row[0] != "active":
            raise HTTPException(status_code=404, detail="Not available")
        ms_row = await pg.scalar(
            select(Microsite).where(
                Microsite.organizer_id == organizer["id"],
                Microsite.published == True,  # noqa: E712
            )
        )
    if not ms_row:
        raise HTTPException(status_code=404, detail="Microsite not published")
    return {
        "slug": slug,
        "company_name": organizer["company_name"],
        "template": ms_row.template,
        "branding": ms_row.branding,
        "content": ms_row.content,
        "social_links": ms_row.social_links,
        "sections_enabled": ms_row.sections_enabled,
        "blocks": resolve_blocks(
            blocks=ms_row.blocks,
            template=ms_row.template,
            sections_enabled=ms_row.sections_enabled,
        ),
        "seo": validate_seo(ms_row.seo),
    }


@public_router.get("/{slug}/events")
async def public_microsite_events(slug: str):
    organizer = await get_organizer_by_slug(slug)
    if not organizer:
        raise HTTPException(status_code=404, detail="Not found")
    return []
