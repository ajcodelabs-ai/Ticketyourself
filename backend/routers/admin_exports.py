"""
Phase 5.5 — CSV exports for super-admin.

UTF-8 with BOM for Excel compatibility. All endpoints require super_admin role.
Filter support mirrors the listing endpoints. Streamed via StreamingResponse to
avoid memory pressure on large datasets.
"""
import csv
import io
import logging
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from db import db
from security import require_role

logger = logging.getLogger("tys.admin_exports")
router = APIRouter(
    prefix="/api/admin/export",
    tags=["admin", "exports"],
    dependencies=[Depends(require_role("super_admin"))],
)


# ── CSV helpers ─────────────────────────────────────────────────────────────
def _make_csv_response(filename: str, headers: List[str], rows: List[List[Any]]) -> StreamingResponse:
    buf = io.StringIO()
    buf.write("\ufeff")  # BOM for Excel UTF-8
    writer = csv.writer(buf, dialect="excel")
    writer.writerow(headers)
    for r in rows:
        writer.writerow(["" if v is None else v for v in r])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _ts() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")


# ── /admin/export/organizers.csv ────────────────────────────────────────────
@router.get("/organizers.csv")
async def export_organizers(
    status: Optional[str] = Query(default=None),
    plan_code: Optional[str] = Query(default=None),
):
    plans = await db.subscription_plans.find(
        {}, {"_id": 0, "id": 1, "code": 1, "name": 1}
    ).to_list(length=200)
    plan_by_id = {p["id"]: p for p in plans}
    plan_id_by_code = {p["code"]: p["id"] for p in plans}

    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if plan_code:
        q["plan_id"] = plan_id_by_code.get(plan_code, "__none__")

    organizers = await db.organizers.find(q, {"_id": 0}).to_list(length=10_000)
    org_ids = [o["id"] for o in organizers]

    rev_map: Dict[str, dict] = {}
    if org_ids:
        async for r in db.ticket_orders.aggregate([
            {"$match": {"organizer_id": {"$in": org_ids}, "status": "paid"}},
            {"$group": {"_id": "$organizer_id",
                        "revenue": {"$sum": "$total_cents"},
                        "tickets": {"$sum": "$quantity_total"}}},
        ]):
            rev_map[r["_id"]] = r

    evt_map: Dict[str, int] = {}
    if org_ids:
        async for e in db.events.aggregate([
            {"$match": {"organizer_id": {"$in": org_ids}, "status": "published"}},
            {"$group": {"_id": "$organizer_id", "n": {"$sum": 1}}},
        ]):
            evt_map[e["_id"]] = e["n"]

    headers = [
        "ID", "Slug", "Empresa", "Email", "RUC/Cédula", "Estado",
        "Suscripción", "Plan", "Eventos publicados", "Tickets emitidos",
        "Ingresos USD", "Registrado",
    ]
    rows: List[List[Any]] = []
    for o in organizers:
        plan = plan_by_id.get(o.get("plan_id"))
        rev = rev_map.get(o["id"], {})
        rows.append([
            o["id"], o["slug"], o.get("company_name"), o.get("email"),
            o.get("legal_id"), o.get("status"), o.get("subscription_status"),
            plan["name"] if plan else "",
            evt_map.get(o["id"], 0),
            rev.get("tickets", 0),
            f"{(rev.get('revenue', 0) or 0) / 100:.2f}",
            (o.get("created_at") or "")[:19],
        ])

    return _make_csv_response(f"organizers_{_ts()}.csv", headers, rows)


# ── /admin/export/events.csv ────────────────────────────────────────────────
@router.get("/events.csv")
async def export_events(
    status: Optional[str] = Query(default=None),
    category: Optional[str] = Query(default=None),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if category:
        q["category"] = category
    events = await db.events.find(q, {"_id": 0}).to_list(length=10_000)

    org_ids = list({e["organizer_id"] for e in events})
    org_map: Dict[str, dict] = {}
    if org_ids:
        async for o in db.organizers.find(
            {"id": {"$in": org_ids}}, {"_id": 0, "id": 1, "company_name": 1, "slug": 1}
        ):
            org_map[o["id"]] = o

    # Per-event GMV + fees
    evt_ids = [e["id"] for e in events]
    sales_map: Dict[str, dict] = {}
    if evt_ids:
        async for r in db.ticket_orders.aggregate([
            {"$match": {"event_id": {"$in": evt_ids}, "status": "paid"}},
            {"$group": {"_id": "$event_id",
                        "gmv": {"$sum": "$total_cents"},
                        "fees": {"$sum": "$fees_cents"},
                        "tickets": {"$sum": "$quantity_total"}}},
        ]):
            sales_map[r["_id"]] = r

    headers = [
        "ID", "Slug", "Título", "Organizer", "Categoría", "Estado",
        "Fecha inicio", "Capacidad", "Vendidos", "GMV USD",
        "Comisiones USD", "Tipo de precio", "Precio base USD",
    ]
    rows = []
    for e in events:
        org = org_map.get(e["organizer_id"], {})
        s = sales_map.get(e["id"], {})
        rows.append([
            e["id"], e["slug"], e.get("title"), org.get("company_name"),
            e.get("category"), e.get("status"),
            (e.get("starts_at") or "")[:19],
            e.get("capacity") if e.get("capacity") is not None else "ilimitada",
            e.get("tickets_sold", 0),
            f"{(s.get('gmv', 0) or 0) / 100:.2f}",
            f"{(s.get('fees', 0) or 0) / 100:.2f}",
            e.get("pricing_type"),
            f"{(e.get('base_price_cents', 0) or 0) / 100:.2f}",
        ])
    return _make_csv_response(f"events_{_ts()}.csv", headers, rows)


# ── /admin/export/orders.csv ────────────────────────────────────────────────
@router.get("/orders.csv")
async def export_orders(
    status: Optional[str] = Query(default=None),
    payment_method: Optional[str] = Query(default=None),
    organizer_id: Optional[str] = Query(default=None),
):
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if payment_method:
        q["payment_method"] = payment_method
    if organizer_id:
        q["organizer_id"] = organizer_id
    orders = await db.ticket_orders.find(q, {"_id": 0}).sort("created_at", -1).to_list(length=10_000)

    org_ids = list({o["organizer_id"] for o in orders})
    evt_ids = list({o["event_id"] for o in orders})
    org_map = {}
    evt_map = {}
    if org_ids:
        async for o in db.organizers.find(
            {"id": {"$in": org_ids}}, {"_id": 0, "id": 1, "company_name": 1}
        ):
            org_map[o["id"]] = o["company_name"]
    if evt_ids:
        async for e in db.events.find(
            {"id": {"$in": evt_ids}}, {"_id": 0, "id": 1, "title": 1}
        ):
            evt_map[e["id"]] = e["title"]

    headers = [
        "Orden", "Estado", "Método", "Evento", "Organizer",
        "Comprador", "Email", "Cantidad", "Subtotal USD", "Fees USD",
        "Total USD", "Moneda", "Creado", "Pagado",
    ]
    rows = []
    for o in orders:
        rows.append([
            o["order_number"], o["status"], o.get("payment_method"),
            evt_map.get(o["event_id"], ""), org_map.get(o["organizer_id"], ""),
            o["buyer"].get("name"), o["buyer"].get("email"),
            o["quantity_total"],
            f"{o['subtotal_cents'] / 100:.2f}",
            f"{o['fees_cents'] / 100:.2f}",
            f"{o['total_cents'] / 100:.2f}",
            o.get("currency", "USD"),
            (o.get("created_at") or "")[:19],
            (o.get("paid_at") or "")[:19],
        ])
    return _make_csv_response(f"orders_{_ts()}.csv", headers, rows)


# ── /admin/export/audit-log.csv ─────────────────────────────────────────────
@router.get("/audit-log.csv")
async def export_audit_log(
    action: Optional[str] = Query(default=None),
    target_type: Optional[str] = Query(default=None),
):
    import json as _json

    q: Dict[str, Any] = {}
    if action:
        q["action"] = {"$regex": action, "$options": "i"}
    if target_type:
        q["target_type"] = target_type
    entries = await db.audit_log.find(q, {"_id": 0}).sort("created_at", -1).to_list(length=10_000)

    actor_ids = list({e.get("actor_user_id") for e in entries if e.get("actor_user_id")})
    actor_email_map = {}
    if actor_ids:
        async for u in db.users.find(
            {"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "email": 1}
        ):
            actor_email_map[u["id"]] = u.get("email")

    headers = ["Fecha", "Actor", "Acción", "Target type", "Target ID", "Metadata"]
    rows = []
    for e in entries:
        meta = _json.dumps(e.get("metadata") or {}, ensure_ascii=False)[:500]
        rows.append([
            (e.get("created_at") or "")[:19],
            actor_email_map.get(e.get("actor_user_id"), e.get("actor_user_id") or "sistema"),
            e["action"], e["target_type"], e["target_id"], meta,
        ])
    return _make_csv_response(f"audit_log_{_ts()}.csv", headers, rows)


# ── /admin/export/monthly-report.csv ────────────────────────────────────────
@router.get("/monthly-report.csv")
async def export_monthly_report(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
):
    if year < 2020 or year > 2100:
        raise HTTPException(422, "Año inválido")
    start = datetime(year, month, 1, tzinfo=timezone.utc)
    if month == 12:
        end = datetime(year + 1, 1, 1, tzinfo=timezone.utc)
    else:
        end = datetime(year, month + 1, 1, tzinfo=timezone.utc)
    s_iso, e_iso = start.isoformat(), end.isoformat()

    # Aggregate per organizer for the month
    pipeline = [
        {"$match": {"status": "paid", "paid_at": {"$gte": s_iso, "$lt": e_iso}}},
        {"$group": {
            "_id": "$organizer_id",
            "gmv": {"$sum": "$total_cents"},
            "fees": {"$sum": "$fees_cents"},
            "tickets": {"$sum": "$quantity_total"},
            "orders": {"$sum": 1},
        }},
    ]
    agg = await db.ticket_orders.aggregate(pipeline).to_list(length=10_000)
    org_ids = [a["_id"] for a in agg]
    org_map = {}
    async for o in db.organizers.find(
        {"id": {"$in": org_ids}},
        {"_id": 0, "id": 1, "company_name": 1, "slug": 1, "legal_id": 1},
    ):
        org_map[o["id"]] = o

    total_gmv = sum(a["gmv"] for a in agg)
    total_fees = sum(a["fees"] for a in agg)
    total_tickets = sum(a["tickets"] for a in agg)

    headers = [
        "Organizer", "Slug", "RUC/Cédula", "Órdenes pagadas", "Tickets",
        "GMV USD", "Comisiones USD", "Neto organizer USD",
    ]
    rows = []
    for a in sorted(agg, key=lambda r: -r["gmv"]):
        org = org_map.get(a["_id"], {})
        rows.append([
            org.get("company_name", ""), org.get("slug", ""), org.get("legal_id", ""),
            a["orders"], a["tickets"],
            f"{a['gmv'] / 100:.2f}",
            f"{a['fees'] / 100:.2f}",
            f"{(a['gmv'] - a['fees']) / 100:.2f}",
        ])
    # Totals row
    rows.append([
        "TOTAL", "", "",
        sum(a["orders"] for a in agg), total_tickets,
        f"{total_gmv / 100:.2f}",
        f"{total_fees / 100:.2f}",
        f"{(total_gmv - total_fees) / 100:.2f}",
    ])
    return _make_csv_response(
        f"monthly_report_{year}_{month:02d}.csv", headers, rows
    )
