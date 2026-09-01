"""Orchestrates SRI electronic invoices via Dátil after an order is paid."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from db_helpers import get_event_by_id, get_organizer_by_id, row_to_dict
from orm_models import EinvoiceSequence, ElectronicInvoice
from services import datil_service

logger = logging.getLogger("tys.einvoice")

TERMINAL_OK = {"AUTORIZADO"}
TERMINAL_FAIL = {"NO AUTORIZADO", "DEVUELTO", "ERROR"}
SKIP_RETRY = TERMINAL_OK | {"ENVIADO", "RECIBIDO"}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _org_config(organizer: dict | None) -> dict:
    raw = (organizer or {}).get("einvoice_config") or {}
    return raw if isinstance(raw, dict) else {}


def invoicing_ready(organizer: dict | None = None) -> bool:
    cfg = _org_config(organizer)
    if cfg.get("enabled") is False:
        return False
    creds = datil_service.resolve_credentials(cfg)
    emisor = datil_service.build_emisor(organizer=organizer, organizer_config=cfg)
    return bool(creds["api_key"] and creds["cert_password"] and emisor.get("ruc"))


async def _allocate_sequential(session: AsyncSession, issuer_key: str) -> int:
    row = await session.scalar(
        select(EinvoiceSequence)
        .where(EinvoiceSequence.issuer_key == issuer_key)
        .with_for_update()
    )
    if row is None:
        session.add(
            EinvoiceSequence(id=str(uuid.uuid4()), issuer_key=issuer_key, next_value=2)
        )
        await session.flush()
        return 1
    n = int(row.next_value or 1)
    row.next_value = n + 1
    row.updated_at = _now()
    return n


def _apply_datil_response(row: ElectronicInvoice, data: dict[str, Any]) -> None:
    row.datil_id = str(data.get("id") or row.datil_id or "")
    row.clave_acceso = data.get("clave_acceso") or row.clave_acceso
    estado = (
        data.get("estado")
        or (data.get("autorizacion") or {}).get("estado")
        or "ENVIADO"
    )
    row.estado = str(estado).upper()
    row.datil_response = data
    row.ride_url = (
        data.get("url_formato_impresion") or data.get("ride_url") or row.ride_url
    )
    row.xml_url = (
        data.get("url_documento_electronico") or data.get("xml_url") or row.xml_url
    )
    est = (data.get("emisor") or {}).get("establecimiento") or {}
    codigo = est.get("codigo")
    punto = est.get("punto_emision")
    seq = data.get("secuencial")
    if codigo and punto and seq is not None:
        try:
            row.numero = f"{str(codigo).zfill(3)}-{str(punto).zfill(3)}-{int(seq):09d}"
        except (TypeError, ValueError):
            row.numero = data.get("numero") or row.numero
    elif data.get("numero"):
        row.numero = str(data.get("numero"))
    if row.estado == "AUTORIZADO" and row.authorized_at is None:
        row.authorized_at = _now()
    row.error_message = None
    row.updated_at = _now()


async def get_invoice_for_order(
    session: AsyncSession, order_id: str
) -> Optional[dict[str, Any]]:
    row = await session.scalar(
        select(ElectronicInvoice).where(ElectronicInvoice.order_id == order_id)
    )
    return row_to_dict(row) if row else None


async def list_invoices_for_orders(
    session: AsyncSession, order_ids: list[str]
) -> dict[str, dict[str, Any]]:
    if not order_ids:
        return {}
    result = await session.execute(
        select(ElectronicInvoice).where(ElectronicInvoice.order_id.in_(order_ids))
    )
    out: dict[str, dict[str, Any]] = {}
    for row in result.scalars().all():
        out[row.order_id] = datil_service.public_invoice_view(row_to_dict(row))
    return out


async def refresh_invoice(invoice_id: str) -> dict[str, Any]:
    from database import AsyncSessionLocal

    async with AsyncSessionLocal() as session:
        row = await session.scalar(
            select(ElectronicInvoice).where(ElectronicInvoice.id == invoice_id)
        )
        if row is None:
            raise LookupError("Factura no encontrada")
        if not row.datil_id:
            return row_to_dict(row)
        organizer = await get_organizer_by_id(row.organizer_id)
        data = await datil_service.get_invoice(
            row.datil_id, organizer_config=_org_config(organizer)
        )
        _apply_datil_response(row, data)
        await session.commit()
        await session.refresh(row)
        return row_to_dict(row)


async def issue_for_order(order: dict) -> Optional[dict[str, Any]]:
    """Best-effort: never raises to the payment path. Skip $0 / unconfigured."""
    from database import AsyncSessionLocal

    total = int(order.get("total_cents") or 0)
    if total <= 0:
        logger.info("Skip einvoice for %s — total is 0", order.get("order_number"))
        return None

    organizer = await get_organizer_by_id(order["organizer_id"])
    if not invoicing_ready(organizer):
        logger.info(
            "Skip einvoice for %s — Dátil no configurado", order.get("order_number")
        )
        return None

    event = await get_event_by_id(order["event_id"]) or {"title": "Evento"}
    cfg = _org_config(organizer)
    emisor = datil_service.build_emisor(organizer=organizer, organizer_config=cfg)
    if not emisor.get("ruc"):
        logger.warning(
            "Skip einvoice for %s — emisor RUC missing", order.get("order_number")
        )
        return None

    async with AsyncSessionLocal() as session:
        existing = await session.scalar(
            select(ElectronicInvoice).where(ElectronicInvoice.order_id == order["id"])
        )
        if existing and existing.estado in TERMINAL_OK:
            return row_to_dict(existing)
        if existing and existing.datil_id and existing.estado not in TERMINAL_FAIL:
            try:
                data = await datil_service.get_invoice(
                    existing.datil_id, organizer_config=cfg
                )
                _apply_datil_response(existing, data)
                await session.commit()
                await session.refresh(existing)
                return row_to_dict(existing)
            except datil_service.DatilError as exc:
                existing.error_message = str(exc)[:500]
                existing.updated_at = _now()
                await session.commit()
                return row_to_dict(existing)

        sequential = existing.secuencial if existing else None
        if sequential is None:
            sequential = await _allocate_sequential(
                session, datil_service.issuer_key(emisor)
            )

        now = _now()
        payload = datil_service.build_invoice_payload(
            order=order,
            event=event,
            organizer=organizer,
            sequential=sequential,
            issued_at=now,
            organizer_config=cfg,
        )

        if existing is None:
            existing = ElectronicInvoice(
                id=str(uuid.uuid4()),
                order_id=order["id"],
                organizer_id=order["organizer_id"],
                event_id=order.get("event_id"),
                ambiente=datil_service.ambiente(),
                secuencial=sequential,
                estado="PENDING",
                payload=payload,
                issued_at=now,
            )
            session.add(existing)
        else:
            existing.payload = payload
            existing.secuencial = sequential
            existing.ambiente = datil_service.ambiente()
            existing.estado = "PENDING"
            existing.issued_at = existing.issued_at or now
            existing.updated_at = now
        await session.flush()

        try:
            data = await datil_service.issue_invoice(
                payload,
                idempotency_key=order["id"],
                organizer_config=cfg,
            )
            _apply_datil_response(existing, data)
        except datil_service.DatilError as exc:
            existing.estado = "ERROR"
            existing.error_message = (exc.body or str(exc))[:800]
            logger.error(
                "Datil issue failed for %s: %s",
                order.get("order_number"),
                existing.error_message[:200],
            )
        except Exception as exc:  # noqa: BLE001
            existing.estado = "ERROR"
            existing.error_message = str(exc)[:800]
            logger.exception("Datil issue crashed for %s", order.get("order_number"))

        await session.commit()
        await session.refresh(existing)
        return row_to_dict(existing)


async def retry_issue(order_id: str) -> dict[str, Any]:
    from database import AsyncSessionLocal
    from orm_models import TicketOrder

    async with AsyncSessionLocal() as session:
        order_row = await session.scalar(
            select(TicketOrder).where(TicketOrder.id == order_id)
        )
        if order_row is None:
            raise LookupError("Orden no encontrada")
        order = row_to_dict(order_row)
        if order.get("status") != "paid":
            raise ValueError("Sólo se factura una orden pagada")
    result = await issue_for_order(order)
    if result is None:
        raise RuntimeError(
            "No se pudo emitir: Dátil no está configurado o el total es $0"
        )
    return result
