"""Electronic invoicing (Dátil / SRI) — organizer + admin."""

from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import row_to_dict
from orm_models import ElectronicInvoice, Organizer
from security import get_current_user, require_role
from services import datil_service, einvoice_service

router = APIRouter(prefix="/api/einvoice", tags=["einvoice"])
organizer_router = APIRouter(prefix="/api/organizers/me", tags=["einvoice"])
admin_router = APIRouter(prefix="/api/admin/einvoice", tags=["einvoice-admin"])

SECRET_KEYS = ("api_key", "cert_password")


class EinvoiceConfigUpdate(BaseModel):
    enabled: Optional[bool] = None
    ruc: Optional[str] = Field(default=None, max_length=13)
    razon_social: Optional[str] = Field(default=None, max_length=300)
    nombre_comercial: Optional[str] = Field(default=None, max_length=300)
    direccion: Optional[str] = Field(default=None, max_length=300)
    establecimiento: Optional[str] = Field(default=None, max_length=3)
    punto_emision: Optional[str] = Field(default=None, max_length=3)
    obligado_contabilidad: Optional[bool] = None
    contribuyente_especial: Optional[str] = Field(default=None, max_length=13)
    iva_percent: Optional[int] = Field(default=None, ge=0, le=30)
    api_key: Optional[str] = Field(default=None, max_length=200)
    cert_password: Optional[str] = Field(default=None, max_length=200)


def _public_config(raw: dict | None, organizer: dict | None = None) -> dict[str, Any]:
    cfg = dict(raw or {})
    has_org_key = bool((cfg.get("api_key") or "").strip())
    has_org_pass = bool((cfg.get("cert_password") or "").strip())
    for key in SECRET_KEYS:
        cfg.pop(key, None)
    emisor = datil_service.build_emisor(organizer=organizer, organizer_config=raw or {})
    return {
        **{k: v for k, v in cfg.items() if k not in SECRET_KEYS},
        "has_api_key": has_org_key or datil_service.is_configured(),
        "has_cert_password": has_org_pass or datil_service.is_configured(),
        "platform_configured": datil_service.is_configured(),
        "ambiente": datil_service.ambiente(),
        "iva_percent": datil_service.iva_percent(organizer_config=raw or {}),
        "ready": einvoice_service.invoicing_ready(organizer),
        "mock": datil_service.mock_enabled(),
        "emisor": emisor,
    }


@organizer_router.get("/einvoice-config")
async def get_einvoice_config(
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org_id = user.get("organizer_id")
    row = await session.get(Organizer, org_id)
    if not row:
        raise HTTPException(404, "Organizer not found")
    org = row_to_dict(row)
    return _public_config(org.get("einvoice_config"), org)


@organizer_router.put("/einvoice-config")
async def update_einvoice_config(
    payload: EinvoiceConfigUpdate,
    user=Depends(require_role("organizer")),
    session: AsyncSession = Depends(get_db),
):
    org_id = user.get("organizer_id")
    row = await session.get(Organizer, org_id)
    if not row:
        raise HTTPException(404, "Organizer not found")
    current = dict(row.einvoice_config or {})
    updates = payload.model_dump(exclude_unset=True)
    if "iva_percent" in updates and updates["iva_percent"] is not None:
        updates["iva_percent"] = datil_service.normalize_iva_percent(
            updates["iva_percent"]
        )
    if "establecimiento" in updates and updates["establecimiento"] is not None:
        updates["establecimiento"] = datil_service._pad3(updates["establecimiento"])
    if "punto_emision" in updates and updates["punto_emision"] is not None:
        updates["punto_emision"] = datil_service._pad3(updates["punto_emision"])
    for key, val in updates.items():
        if key in SECRET_KEYS and (val is None or str(val).strip() == ""):
            continue
        if val is None:
            current.pop(key, None)
        else:
            current[key] = val
    row.einvoice_config = current
    from sqlalchemy.orm.attributes import flag_modified

    flag_modified(row, "einvoice_config")
    await session.flush()
    org = row_to_dict(row)
    return _public_config(org.get("einvoice_config"), org)


@router.get("/orders/{order_id}")
async def get_order_invoice(
    order_id: str,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    row = await session.scalar(
        select(ElectronicInvoice).where(ElectronicInvoice.order_id == order_id)
    )
    if not row:
        raise HTTPException(404, "Factura no encontrada")
    role = user.get("role")
    if role != "super_admin" and user.get("organizer_id") != row.organizer_id:
        raise HTTPException(403, "No autorizado")
    return datil_service.public_invoice_view(row_to_dict(row))


@router.post("/orders/{order_id}/retry")
async def retry_order_invoice(
    order_id: str,
    user=Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    from orm_models import TicketOrder

    order_row = await session.scalar(
        select(TicketOrder).where(TicketOrder.id == order_id)
    )
    if not order_row:
        raise HTTPException(404, "Orden no encontrada")
    if (
        user.get("role") != "super_admin"
        and user.get("organizer_id") != order_row.organizer_id
    ):
        raise HTTPException(403, "No autorizado")
    try:
        result = await einvoice_service.retry_issue(order_id)
    except LookupError:
        raise HTTPException(404, "Orden no encontrada")
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except RuntimeError as exc:
        raise HTTPException(409, str(exc))
    return datil_service.public_invoice_view(result)


@router.post("/{invoice_id}/refresh")
async def refresh_invoice(invoice_id: str, user=Depends(get_current_user)):
    from database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        row = await session.get(ElectronicInvoice, invoice_id)
        if not row:
            raise HTTPException(404, "Factura no encontrada")
        if (
            user.get("role") != "super_admin"
            and user.get("organizer_id") != row.organizer_id
        ):
            raise HTTPException(403, "No autorizado")
    try:
        data = await einvoice_service.refresh_invoice(invoice_id)
    except LookupError:
        raise HTTPException(404, "Factura no encontrada")
    except datil_service.DatilError as exc:
        raise HTTPException(502, str(exc))
    return datil_service.public_invoice_view(data)


@admin_router.get("/status")
async def admin_datil_status(_admin=Depends(require_role("super_admin"))):
    return {
        "configured": datil_service.is_configured(),
        "ambiente": datil_service.ambiente(),
        "iva_percent": datil_service.iva_percent(),
        "api_base": datil_service._cfg()["api_base"],
    }
