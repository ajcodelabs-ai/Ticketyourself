"""
Required documents per (country_code, org_type) — admin-configurable via
GET/PUT /api/admin/settings/required-documents (super_admin only).

country_code='*' is the global fallback when a specific country has no row.
"""

from datetime import datetime, timezone
from typing import Dict, List, Optional, Set

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import RequiredDocumentSet
from services.document_types import is_valid_doc_type

ORG_TYPES = ("individual", "company")
GLOBAL_COUNTRY = "*"
DEFAULTS: Dict[str, List[str]] = {"individual": ["id_card"], "company": ["ruc"]}


async def get_required_documents(
    session: AsyncSession, country_code: Optional[str] = None
) -> Dict[str, List[str]]:
    """Return {individual, company} doc lists for a country (with * fallback)."""
    result = await session.execute(select(RequiredDocumentSet))
    rows = list(result.scalars().all())

    by_key = {(r.country_code, r.org_type): r.doc_types for r in rows}

    def resolve(org_type: str) -> List[str]:
        if country_code:
            specific = by_key.get((country_code.upper(), org_type))
            if specific is not None:
                return list(specific)
        global_set = by_key.get((GLOBAL_COUNTRY, org_type))
        if global_set is not None:
            return list(global_set)
        return list(DEFAULTS[org_type])

    return {org_type: resolve(org_type) for org_type in ORG_TYPES}


async def get_all_required_document_sets(
    session: AsyncSession,
) -> List[Dict]:
    result = await session.execute(
        select(RequiredDocumentSet).order_by(
            RequiredDocumentSet.country_code, RequiredDocumentSet.org_type
        )
    )
    return [
        {
            "country_code": r.country_code,
            "org_type": r.org_type,
            "doc_types": list(r.doc_types or []),
            "updated_at": r.updated_at,
            "updated_by": r.updated_by,
        }
        for r in result.scalars().all()
    ]


async def set_required_documents(
    session: AsyncSession,
    org_type: str,
    doc_types: List[str],
    admin_id: str,
    country_code: str = GLOBAL_COUNTRY,
) -> None:
    if org_type not in ORG_TYPES:
        raise HTTPException(400, f"Invalid org_type: {org_type}")
    code = (country_code or GLOBAL_COUNTRY).upper()
    for doc_type in doc_types:
        if not await is_valid_doc_type(session, doc_type):
            raise HTTPException(400, f"Unknown document type: {doc_type}")

    row = await session.get(RequiredDocumentSet, (code, org_type))
    now = datetime.now(timezone.utc)
    if row:
        row.doc_types = doc_types
        row.updated_by = admin_id
        row.updated_at = now
    else:
        session.add(
            RequiredDocumentSet(
                country_code=code,
                org_type=org_type,
                doc_types=doc_types,
                updated_by=admin_id,
                updated_at=now,
            )
        )
    await session.flush()


async def is_satisfied(
    session: AsyncSession,
    org_type: str,
    present_doc_types: Set[str],
    country_code: Optional[str] = None,
) -> bool:
    required = (await get_required_documents(session, country_code)).get(org_type, [])
    return all(doc_type in present_doc_types for doc_type in required)
