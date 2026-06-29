"""
Required documents per org_type — admin-configurable via
GET/PUT /api/admin/settings/required-documents (super_admin only).

Single source of truth for which OrganizerDocument.doc_type values are
mandatory before an organizer can move past "uploading docs" into review
(see routers/organizers.py::resubmit_me and the onboarding gate).
"""
from datetime import datetime, timezone
from typing import Dict, List, Set

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import RequiredDocumentSet
from services.document_types import is_valid_doc_type

ORG_TYPES = ("individual", "company")
DEFAULTS: Dict[str, List[str]] = {"individual": ["id_card"], "company": ["ruc"]}


async def get_required_documents(session: AsyncSession) -> Dict[str, List[str]]:
    result = await session.execute(select(RequiredDocumentSet))
    rows = {r.org_type: r.doc_types for r in result.scalars().all()}
    return {org_type: rows.get(org_type, DEFAULTS[org_type]) for org_type in ORG_TYPES}


async def set_required_documents(
    session: AsyncSession, org_type: str, doc_types: List[str], admin_id: str
) -> None:
    for doc_type in doc_types:
        if not await is_valid_doc_type(session, doc_type):
            raise HTTPException(400, f"Unknown document type: {doc_type}")
    row = await session.get(RequiredDocumentSet, org_type)
    if row:
        row.doc_types = doc_types
        row.updated_by = admin_id
        row.updated_at = datetime.now(timezone.utc)
    else:
        session.add(
            RequiredDocumentSet(
                org_type=org_type,
                doc_types=doc_types,
                updated_by=admin_id,
                updated_at=datetime.now(timezone.utc),
            )
        )
    await session.flush()


async def is_satisfied(session: AsyncSession, org_type: str, present_doc_types: Set[str]) -> bool:
    required = (await get_required_documents(session)).get(org_type, [])
    return all(doc_type in present_doc_types for doc_type in required)
