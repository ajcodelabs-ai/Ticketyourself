"""Organizer self-service: profile + document uploads — Phase 2: PostgreSQL."""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from audit import log_audit
from database import get_db
from db_helpers import organizer_row_to_dict, row_to_dict
from models import OrganizerDocumentOut, OrganizerOut, OrganizerProfileUpdate
from orm_models import Organizer, OrganizerDocument, Tenant
from security import require_role

logger = logging.getLogger("tys.organizers")

router = APIRouter(prefix="/api/organizers", tags=["organizers"])

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}
ALLOWED_DOC_TYPES = {"ruc", "id_card", "operating_permit", "other"}


def _doc_row_to_out(row: OrganizerDocument) -> OrganizerDocumentOut:
    return OrganizerDocumentOut(**row_to_dict(row))


def _org_row_to_out(row: Organizer) -> OrganizerOut:
    return OrganizerOut(**organizer_row_to_dict(row))


async def _get_my_organizer(user: dict, session: AsyncSession) -> Organizer:
    org_id = user.get("organizer_id")
    if not org_id:
        raise HTTPException(404, "Organizer profile not found")
    result = await session.execute(
        select(Organizer)
        .where(Organizer.id == org_id)
        .options(selectinload(Organizer.admin_comments))
    )
    row = result.scalar_one_or_none()
    if not row:
        raise HTTPException(404, "Organizer not found")
    return row


# ────────────────────────────────────────────────────────────────────
# Self-service (organizer)
# ────────────────────────────────────────────────────────────────────
@router.get("/me", response_model=OrganizerOut)
async def get_me(
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    row = await _get_my_organizer(user, session)
    return _org_row_to_out(row)


@router.patch("/me", response_model=OrganizerOut)
async def update_me(
    payload: OrganizerProfileUpdate,
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")

    row = await _get_my_organizer(user, session)
    for key, val in updates.items():
        setattr(row, key, val)

    # If company_name changes, propagate to tenant name (slug is immutable).
    if "company_name" in updates:
        tenant_result = await session.execute(select(Tenant).where(Tenant.slug == row.slug))
        tenant_row = tenant_result.scalar_one_or_none()
        if tenant_row:
            tenant_row.name = updates["company_name"]

    await session.flush()
    return _org_row_to_out(row)


@router.get("/me/documents", response_model=List[OrganizerDocumentOut])
async def list_my_docs(
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    row = await _get_my_organizer(user, session)
    result = await session.execute(
        select(OrganizerDocument)
        .where(OrganizerDocument.organizer_id == row.id)
        .order_by(OrganizerDocument.uploaded_at.desc())
    )
    return [_doc_row_to_out(d) for d in result.scalars().all()]


@router.post("/me/documents", response_model=OrganizerDocumentOut, status_code=201)
async def upload_my_doc(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(400, f"Invalid doc_type. Allowed: {sorted(ALLOWED_DOC_TYPES)}")
    row = await _get_my_organizer(user, session)
    if file.content_type not in ALLOWED_MIME:
        logger.warning(
            "Document upload rejected: organizer=%s mime=%s filename=%s",
            row.id, file.content_type, file.filename,
        )
        raise HTTPException(
            415,
            (
                f"Tipo de archivo no permitido: {file.content_type or 'desconocido'}. "
                "Aceptados: PDF, JPEG, PNG, WEBP, HEIC."
            ),
        )

    contents = await file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 10MB)")

    doc_id = str(uuid.uuid4())
    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:120]
    dest_dir = UPLOAD_ROOT / row.id
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{doc_id}_{safe_name}"
    dest_path.write_bytes(contents)

    doc_row = OrganizerDocument(
        id=doc_id,
        organizer_id=row.id,
        doc_type=doc_type,
        file_path=str(dest_path),
        original_filename=file.filename,
        mime_type=file.content_type,
        size_bytes=len(contents),
        uploaded_at=datetime.now(timezone.utc),
        is_demo=False,
    )
    session.add(doc_row)
    await session.flush()
    await log_audit(
        user["id"],
        "document.uploaded",
        "document",
        doc_id,
        {"doc_type": doc_type, "organizer_id": row.id},
    )
    try:
        from services.activation import log_funnel_event
        await log_funnel_event(organizer_id=row.id, event_name="first_doc_uploaded")
    except Exception:  # noqa: BLE001
        pass
    return _doc_row_to_out(doc_row)


@router.delete("/me/documents/{doc_id}", status_code=204)
async def delete_my_doc(
    doc_id: str,
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    row = await _get_my_organizer(user, session)
    doc_result = await session.execute(
        select(OrganizerDocument).where(
            OrganizerDocument.id == doc_id,
            OrganizerDocument.organizer_id == row.id,
        )
    )
    doc = doc_result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.file_path and os.path.exists(doc.file_path):
        try:
            os.remove(doc.file_path)
        except OSError:
            logger.warning("Could not delete file %s", doc.file_path)
    await session.delete(doc)
    return None


# ────────────────────────────────────────────────────────────────────
# Admin access to any organizer's docs
# ────────────────────────────────────────────────────────────────────
admin_router = APIRouter(
    prefix="/api/organizers",
    tags=["admin", "organizers"],
    dependencies=[Depends(require_role("super_admin"))],
)


@admin_router.get("/{organizer_id}/documents", response_model=List[OrganizerDocumentOut])
async def admin_list_docs(
    organizer_id: str,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(OrganizerDocument)
        .where(OrganizerDocument.organizer_id == organizer_id)
        .order_by(OrganizerDocument.uploaded_at.desc())
    )
    return [_doc_row_to_out(d) for d in result.scalars().all()]


@admin_router.get("/{organizer_id}/documents/{doc_id}/download")
async def admin_download_doc(
    organizer_id: str,
    doc_id: str,
    session: AsyncSession = Depends(get_db),
):
    result = await session.execute(
        select(OrganizerDocument).where(
            OrganizerDocument.id == doc_id,
            OrganizerDocument.organizer_id == organizer_id,
        )
    )
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(404, "Document not found")
    if doc.is_demo or not doc.file_path:
        raise HTTPException(404, "Demo document — file not on disk")
    if not os.path.exists(doc.file_path):
        raise HTTPException(410, "File missing from disk")
    return FileResponse(
        doc.file_path,
        media_type=doc.mime_type or "application/octet-stream",
        filename=doc.original_filename or "document",
    )
