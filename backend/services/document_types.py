"""
Catalog of document types organizers can upload — admin-extensible via
GET/POST /api/admin/settings/document-types (super_admin only).

Replaces a previously hardcoded set: any super_admin can add a new type
(e.g. "Pasaporte"), and it immediately becomes selectable in the organizer
upload form and assignable in the required-documents matrix.
"""
from datetime import datetime, timezone
from typing import Dict, List

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import DocumentType
from slugs import normalize_slug


async def list_document_types(session: AsyncSession) -> List[Dict[str, str]]:
    result = await session.execute(select(DocumentType).order_by(DocumentType.created_at))
    return [{"code": r.code, "label": r.label} for r in result.scalars().all()]


async def create_document_type(session: AsyncSession, label: str, admin_id: str) -> Dict[str, str]:
    code = normalize_slug(label)
    if not code:
        raise HTTPException(400, "Invalid label")
    existing = await session.get(DocumentType, code)
    if existing:
        raise HTTPException(409, f"Document type '{code}' already exists")
    row = DocumentType(
        code=code,
        label=label.strip(),
        created_at=datetime.now(timezone.utc),
        created_by=admin_id,
    )
    session.add(row)
    await session.flush()
    return {"code": row.code, "label": row.label}


async def is_valid_doc_type(session: AsyncSession, code: str) -> bool:
    return await session.get(DocumentType, code) is not None
