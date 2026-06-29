"""Tenant resolution endpoint — Phase 1: migrated to PostgreSQL."""
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from models import ResolveResponse, TenantOut
from orm_models import Tenant

RESERVED_SUBDOMAINS = {"www", "api", "admin", "app", "static", "assets"}

router = APIRouter(prefix="/api/tenants", tags=["tenants"])


def _extract_subdomain(host: str) -> Optional[str]:
    if not host:
        return None
    host_no_port = host.split(":", 1)[0].strip().lower()
    parts = host_no_port.split(".")
    if len(parts) < 3:
        return None
    sub = parts[0]
    if not sub or sub in RESERVED_SUBDOMAINS:
        return None
    return sub


@router.get("/resolve", response_model=ResolveResponse)
async def resolve_tenant(
    request: Request,
    tenant: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_db),
):
    host = request.headers.get("host", "")
    slug = _extract_subdomain(host)

    if slug:
        result = await session.execute(select(Tenant).where(Tenant.slug == slug))
        row = result.scalar_one_or_none()
        if row and row.status == "active":
            return ResolveResponse(tenant=TenantOut(**row_to_dict(row)))

    if tenant:
        slug_clean = tenant.strip().lower()
        result = await session.execute(select(Tenant).where(Tenant.slug == slug_clean))
        row = result.scalar_one_or_none()
        if row:
            return ResolveResponse(tenant=TenantOut(**row_to_dict(row)))

    return ResolveResponse(tenant=None)
