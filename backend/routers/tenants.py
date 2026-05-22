"""Tenant resolution endpoint (carryover from Fase 0)."""
from typing import Optional

from fastapi import APIRouter, Query, Request

from db import db
from models import ResolveResponse, TenantOut

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
async def resolve_tenant(request: Request, tenant: Optional[str] = Query(default=None)):
    host = request.headers.get("host", "")
    slug = _extract_subdomain(host)

    if slug:
        doc = await db.tenants.find_one({"slug": slug}, {"_id": 0})
        if doc and doc.get("status") == "active":
            return ResolveResponse(tenant=TenantOut(**doc))

    if tenant:
        doc = await db.tenants.find_one({"slug": tenant.strip().lower()}, {"_id": 0})
        if doc:
            return ResolveResponse(tenant=TenantOut(**doc))

    return ResolveResponse(tenant=None)
