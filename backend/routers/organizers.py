"""Organizer self-service: profile + document uploads."""
import logging
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from audit import log_audit
from db import db
from models import OrganizerDocumentOut, OrganizerOut, OrganizerProfileUpdate
from security import get_current_user, require_role

logger = logging.getLogger("tys.organizers")

router = APIRouter(prefix="/api/organizers", tags=["organizers"])

UPLOAD_ROOT = Path(__file__).resolve().parent.parent / "uploads"
UPLOAD_ROOT.mkdir(parents=True, exist_ok=True)

MAX_BYTES = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME = {"application/pdf", "image/jpeg", "image/png"}
ALLOWED_DOC_TYPES = {"ruc", "id_card", "operating_permit", "other"}


def _doc_to_out(d: dict) -> OrganizerDocumentOut:
    uploaded = d["uploaded_at"]
    if isinstance(uploaded, str):
        uploaded = datetime.fromisoformat(uploaded)
    return OrganizerDocumentOut(
        id=d["id"],
        organizer_id=d["organizer_id"],
        doc_type=d["doc_type"],
        original_filename=d["original_filename"],
        mime_type=d["mime_type"],
        size_bytes=d["size_bytes"],
        uploaded_at=uploaded,
    )


async def _organizer_to_out(doc: dict) -> OrganizerOut:
    plan_code = None
    if doc.get("plan_id"):
        plan = await db.subscription_plans.find_one(
            {"id": doc["plan_id"]}, {"_id": 0, "code": 1}
        )
        if plan:
            plan_code = plan["code"]
    return OrganizerOut(plan_code=plan_code, **doc)


async def _get_my_organizer(user: dict) -> dict:
    org_id = user.get("organizer_id")
    if not org_id:
        raise HTTPException(404, "Organizer profile not found")
    doc = await db.organizers.find_one({"id": org_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Organizer not found")
    return doc


# ────────────────────────────────────────────────────────────────────
# Self-service (organizer)
# ────────────────────────────────────────────────────────────────────
@router.get("/me", response_model=OrganizerOut)
async def get_me(user=Depends(require_role("organizer"))):
    org = await _get_my_organizer(user)
    return await _organizer_to_out(org)


@router.patch("/me", response_model=OrganizerOut)
async def update_me(payload: OrganizerProfileUpdate, user=Depends(require_role("organizer"))):
    updates = {k: v for k, v in payload.model_dump(exclude_unset=True).items() if v is not None}
    if not updates:
        raise HTTPException(400, "No fields to update")
    org_id = user["organizer_id"]
    result = await db.organizers.find_one_and_update(
        {"id": org_id},
        {"$set": updates},
        return_document=True,
        projection={"_id": 0},
    )
    if not result:
        raise HTTPException(404, "Organizer not found")
    # If company_name changes, propagate to tenant name (slug is immutable).
    if "company_name" in updates:
        await db.tenants.update_one(
            {"slug": result["slug"]},
            {"$set": {"name": updates["company_name"]}},
        )
    return await _organizer_to_out(result)


@router.get("/me/documents", response_model=List[OrganizerDocumentOut])
async def list_my_docs(user=Depends(require_role("organizer"))):
    org = await _get_my_organizer(user)
    cursor = db.organizer_documents.find({"organizer_id": org["id"]}, {"_id": 0}).sort("uploaded_at", -1)
    docs = await cursor.to_list(length=100)
    return [_doc_to_out(d) for d in docs]


@router.post("/me/documents", response_model=OrganizerDocumentOut, status_code=201)
async def upload_my_doc(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    user=Depends(require_role("organizer")),
):
    if doc_type not in ALLOWED_DOC_TYPES:
        raise HTTPException(400, f"Invalid doc_type. Allowed: {sorted(ALLOWED_DOC_TYPES)}")
    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(415, f"Unsupported file type {file.content_type}")

    contents = await file.read()
    if len(contents) > MAX_BYTES:
        raise HTTPException(413, "File too large (max 10MB)")

    org = await _get_my_organizer(user)
    doc_id = str(uuid.uuid4())
    safe_name = (file.filename or "file").replace("/", "_").replace("\\", "_")[:120]
    dest_dir = UPLOAD_ROOT / org["id"]
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / f"{doc_id}_{safe_name}"
    dest_path.write_bytes(contents)

    record = {
        "id": doc_id,
        "organizer_id": org["id"],
        "doc_type": doc_type,
        "file_path": str(dest_path),
        "original_filename": file.filename,
        "mime_type": file.content_type,
        "size_bytes": len(contents),
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
        "is_demo": False,
    }
    await db.organizer_documents.insert_one(record)
    await log_audit(
        user["id"],
        "document.uploaded",
        "document",
        doc_id,
        {"doc_type": doc_type, "organizer_id": org["id"]},
    )
    return _doc_to_out(record)


@router.delete("/me/documents/{doc_id}", status_code=204)
async def delete_my_doc(doc_id: str, user=Depends(require_role("organizer"))):
    org = await _get_my_organizer(user)
    rec = await db.organizer_documents.find_one(
        {"id": doc_id, "organizer_id": org["id"]}, {"_id": 0}
    )
    if not rec:
        raise HTTPException(404, "Document not found")
    if rec.get("file_path") and os.path.exists(rec["file_path"]):
        try:
            os.remove(rec["file_path"])
        except OSError:
            logger.warning("Could not delete file %s", rec["file_path"])
    await db.organizer_documents.delete_one({"id": doc_id})
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
async def admin_list_docs(organizer_id: str):
    cursor = db.organizer_documents.find({"organizer_id": organizer_id}, {"_id": 0}).sort("uploaded_at", -1)
    docs = await cursor.to_list(length=200)
    return [_doc_to_out(d) for d in docs]


@admin_router.get("/{organizer_id}/documents/{doc_id}/download")
async def admin_download_doc(organizer_id: str, doc_id: str):
    rec = await db.organizer_documents.find_one(
        {"id": doc_id, "organizer_id": organizer_id}, {"_id": 0}
    )
    if not rec:
        raise HTTPException(404, "Document not found")
    if rec.get("is_demo") or not rec.get("file_path"):
        raise HTTPException(404, "Demo document — file not on disk")
    if not os.path.exists(rec["file_path"]):
        raise HTTPException(410, "File missing from disk")
    return FileResponse(
        rec["file_path"],
        media_type=rec.get("mime_type", "application/octet-stream"),
        filename=rec.get("original_filename") or "document",
    )
