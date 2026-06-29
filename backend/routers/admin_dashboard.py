"""
Super-admin dashboard endpoints (Phase 5.5).

Single aggregated payload for `/admin` home + attention items, plus a richer
organizers list with sort/filter and a global audit-log query.

All endpoints require `super_admin` role.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from db_helpers import get_event_by_id, row_to_dict
from orm_models import AuditLog, Event, Organizer, SubscriptionPlan, TicketOrder, User
from sqlalchemy import desc
from security import require_role

logger = logging.getLogger("tys.admin_dashboard")
router = APIRouter(
    prefix="/api/admin",
    tags=["admin"],
    dependencies=[Depends(require_role("super_admin"))],
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _month_start(offset: int = 0) -> datetime:
    """offset=0 -> current month, -1 -> previous month start."""
    n = _now().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for _ in range(abs(offset)):
        n = (n - timedelta(days=1)).replace(day=1)
    return n


def _delta_pct(curr: float, prev: float) -> Optional[float]:
    if prev == 0:
        return None if curr == 0 else 100.0
    return round((curr - prev) / prev * 100.0, 1)


# ── /admin/dashboard/stats ──────────────────────────────────────────────────
@router.get("/dashboard/stats")
async def dashboard_stats(session: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Returns the global KPIs + distribution + activity + top tables for the
    super-admin home.
    """
    month_now = _month_start(0)
    month_prev = _month_start(-1)

    # ── KPIs from organizers + plans (MRR + active organizers) ────────────
    plans_result = await session.execute(select(SubscriptionPlan))
    plans = [row_to_dict(r) for r in plans_result.scalars().all()]
    plan_by_id = {p["id"]: p for p in plans}
    plan_codes = {p["code"]: p for p in plans}

    orgs_result = await session.execute(
        select(Organizer.id, Organizer.company_name, Organizer.plan_id,
               Organizer.status, Organizer.subscription_status)
    )
    organizers_by_status: Dict[str, int] = {"pending": 0, "approved": 0, "rejected": 0, "suspended": 0}
    organizers_by_plan: Dict[str, int] = {c: 0 for c in plan_codes}
    organizers_by_plan["sin_plan"] = 0
    mrr_cents = 0
    active_organizers = 0
    for o in orgs_result.all():
        sb = o.status
        if sb in organizers_by_status:
            organizers_by_status[sb] += 1
        plan = plan_by_id.get(o.plan_id)
        if plan:
            organizers_by_plan[plan["code"]] = organizers_by_plan.get(plan["code"], 0) + 1
        else:
            organizers_by_plan["sin_plan"] += 1
        is_active = (o.status == "approved" and o.subscription_status == "active")
        if is_active:
            active_organizers += 1
            if plan and plan["billing_period"] == "monthly":
                mrr_cents += plan["price_cents"]

    # ── GMV + fees (paid orders) — current vs prev month ──────────────────
    cur_row = (await session.execute(
        select(
            func.coalesce(func.sum(TicketOrder.total_cents), 0).label("gmv"),
            func.coalesce(func.sum(TicketOrder.fees_cents), 0).label("fees"),
            func.coalesce(func.sum(TicketOrder.quantity_total), 0).label("tickets"),
            func.count(TicketOrder.id).label("n"),
        ).where(TicketOrder.status == "paid", TicketOrder.paid_at >= month_now)
    )).first()
    cur = {"gmv": cur_row.gmv or 0, "fees": cur_row.fees or 0, "tickets": cur_row.tickets or 0, "n": cur_row.n or 0}

    prev_row = (await session.execute(
        select(
            func.coalesce(func.sum(TicketOrder.total_cents), 0).label("gmv"),
            func.count(TicketOrder.id).label("n"),
        ).where(
            TicketOrder.status == "paid",
            TicketOrder.paid_at >= month_prev,
            TicketOrder.paid_at < month_now,
        )
    )).first()
    prev = {"gmv": prev_row.gmv or 0, "n": prev_row.n or 0}

    breakdown_rows = await session.execute(
        select(TicketOrder.status, func.count(TicketOrder.id).label("n"))
        .where(TicketOrder.created_at >= month_now)
        .group_by(TicketOrder.status)
    )
    breakdown = {r.status: r.n for r in breakdown_rows.all()}

    tickets_total = await session.scalar(
        select(func.coalesce(func.sum(TicketOrder.quantity_total), 0)).where(TicketOrder.status == "paid")
    ) or 0

    # ── Events activity ───────────────────────────────────────────────────
    events_published_total = await session.scalar(
        select(func.count(Event.id)).where(Event.status == "published")
    ) or 0
    events_published_month = await session.scalar(
        select(func.count(Event.id)).where(
            Event.status == "published",
            Event.published_at >= month_now,
        )
    ) or 0

    # ── Top 5 organizers by GMV (current month) ───────────────────────────
    top_orgs_result = await session.execute(
        select(
            TicketOrder.organizer_id,
            func.sum(TicketOrder.total_cents).label("gmv"),
            func.sum(TicketOrder.quantity_total).label("tickets"),
            func.count(TicketOrder.id).label("orders"),
        )
        .where(TicketOrder.status == "paid", TicketOrder.paid_at >= month_now)
        .group_by(TicketOrder.organizer_id)
        .order_by(desc("gmv"))
        .limit(5)
    )
    top_organizers_by_gmv = []
    for row in top_orgs_result.all():
        org_res = await session.execute(
            select(Organizer.id, Organizer.slug, Organizer.company_name, Organizer.plan_id)
            .where(Organizer.id == row.organizer_id)
        )
        org_row = org_res.first()
        if not org_row:
            continue
        plan = plan_by_id.get(org_row.plan_id)
        top_organizers_by_gmv.append({
            "organizer_id": org_row.id,
            "slug": org_row.slug,
            "company_name": org_row.company_name,
            "plan_name": plan["name"] if plan else None,
            "gmv_cents": row.gmv,
            "tickets": row.tickets,
            "orders": row.orders,
        })

    # ── Top 5 events by sales (current month) ─────────────────────────────
    top_evt_result = await session.execute(
        select(
            TicketOrder.event_id,
            func.sum(TicketOrder.total_cents).label("gmv"),
            func.sum(TicketOrder.quantity_total).label("tickets"),
        )
        .where(TicketOrder.status == "paid", TicketOrder.paid_at >= month_now)
        .group_by(TicketOrder.event_id)
        .order_by(desc("gmv"))
        .limit(5)
    )
    top_events_by_sales = []
    for row in top_evt_result.all():
        evt = await get_event_by_id(row.event_id)
        if not evt:
            continue
        org_res2 = await session.execute(
            select(Organizer.company_name).where(Organizer.id == evt["organizer_id"])
        )
        company_name = org_res2.scalar_one_or_none() or ""
        top_events_by_sales.append({
            "event_id": evt["id"],
            "slug": evt["slug"],
            "title": evt["title"],
            "starts_at": evt.get("starts_at"),
            "tenant_slug": evt.get("tenant_slug"),
            "company_name": company_name,
            "tickets_sold": evt.get("tickets_sold", 0),
            "capacity": evt.get("capacity"),
            "gmv_cents": row.gmv,
            "tickets": row.tickets,
        })

    return {
        "kpis": {
            "mrr_cents": mrr_cents,
            "mrr_delta_pct": None,  # No historical snapshot store; placeholder.
            "gmv_month_cents": cur["gmv"],
            "gmv_delta_pct": _delta_pct(cur["gmv"], prev["gmv"]),
            "fees_month_cents": cur["fees"],
            "active_organizers": active_organizers,
        },
        "distribution": {
            "organizers_by_status": organizers_by_status,
            "organizers_by_plan": organizers_by_plan,
        },
        "activity": {
            "tickets_total": tickets_total,
            "tickets_month": cur["tickets"],
            "orders_month": {
                "paid": breakdown.get("paid", 0),
                "pending_manual": breakdown.get("pending_manual_payment", 0),
                "pending": breakdown.get("pending", 0),
                "cancelled": breakdown.get("cancelled", 0),
                "refunded": breakdown.get("refunded", 0),
            },
            "events_published_total": events_published_total,
            "events_published_month": events_published_month,
        },
        "top_organizers_by_gmv": top_organizers_by_gmv,
        "top_events_by_sales": top_events_by_sales,
        "generated_at": _now().isoformat(),
    }


# ── /admin/attention-items ──────────────────────────────────────────────────
@router.get("/attention-items")
async def attention_items(session: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    pending_organizers = await session.scalar(
        select(func.count(Organizer.id)).where(Organizer.status == "pending")
    ) or 0
    cutoff_24h = _now() - timedelta(hours=24)
    stale_manual_orders = await session.scalar(
        select(func.count(TicketOrder.id)).where(
            TicketOrder.status == "pending_manual_payment",
            TicketOrder.created_at < cutoff_24h,
        )
    ) or 0
    past_due_subs = await session.scalar(
        select(func.count(Organizer.id)).where(Organizer.subscription_status == "past_due")
    ) or 0
    return {
        "pending_organizers": pending_organizers,
        "stale_manual_orders": stale_manual_orders,
        "past_due_subscriptions": past_due_subs,
    }


# ── Organizers list with sort/filter/aggregations ───────────────────────────
SortableField = Literal[
    "created_at", "company_name", "email", "revenue", "tickets_emitted",
    "events_published", "last_login",
]


@router.get("/organizers-rich")
async def organizers_rich(
    status: Optional[str] = Query(default=None),
    subscription_status: Optional[str] = Query(default=None),
    plan_code: Optional[str] = Query(default=None),
    activity: Optional[Literal["none", "1-5", "5+", "10+"]] = Query(default=None),
    created_from: Optional[str] = Query(default=None),
    created_to: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
    sort: SortableField = Query(default="created_at"),
    direction: Literal["asc", "desc"] = Query(default="desc"),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Rich list of organizers with aggregated metrics: revenue, tickets_emitted,
    events_published, last_login. Filter + sort done in-memory (small dataset).
    """
    plans_result = await session.execute(
        select(SubscriptionPlan.id, SubscriptionPlan.code, SubscriptionPlan.name)
    )
    plans = [{"id": r.id, "code": r.code, "name": r.name} for r in plans_result.all()]
    plan_by_id = {p["id"]: p for p in plans}
    plan_id_by_code = {p["code"]: p["id"] for p in plans}

    stmt = select(Organizer)
    if status:
        stmt = stmt.where(Organizer.status == status)
    if subscription_status:
        stmt = stmt.where(Organizer.subscription_status == subscription_status)
    if plan_code:
        target_plan_id = plan_id_by_code.get(plan_code, "____none____")
        stmt = stmt.where(Organizer.plan_id == target_plan_id)
    if created_from:
        stmt = stmt.where(Organizer.created_at >= datetime.fromisoformat(created_from))
    if created_to:
        stmt = stmt.where(Organizer.created_at <= datetime.fromisoformat(created_to))
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Organizer.company_name.ilike(like),
                Organizer.email.ilike(like),
                Organizer.slug.ilike(like),
            )
        )

    orgs_result = await session.execute(stmt)
    organizers = [row_to_dict(r) for r in orgs_result.scalars().all()]
    org_ids = [o["id"] for o in organizers]
    if not org_ids:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    # Aggregate revenue + tickets per organizer
    rev_result = await session.execute(
        select(
            TicketOrder.organizer_id,
            func.sum(TicketOrder.total_cents).label("revenue"),
            func.sum(TicketOrder.quantity_total).label("tickets"),
        )
        .where(TicketOrder.organizer_id.in_(org_ids), TicketOrder.status == "paid")
        .group_by(TicketOrder.organizer_id)
    )
    rev_map = {r.organizer_id: {"revenue": r.revenue, "tickets": r.tickets} for r in rev_result.all()}

    # Events published count per organizer (PG)
    evt_result = await session.execute(
        select(Event.organizer_id, func.count(Event.id).label("n"))
        .where(Event.organizer_id.in_(org_ids), Event.status == "published")
        .group_by(Event.organizer_id)
    )
    evt_map = {row.organizer_id: row.n for row in evt_result.all()}

    # Last login from PG users
    login_result = await session.execute(
        select(User.organizer_id, User.last_login).where(
            User.organizer_id.in_(org_ids), User.role == "organizer"
        )
    )
    login_map = {row.organizer_id: row.last_login for row in login_result.all()}

    enriched: List[Dict[str, Any]] = []
    for o in organizers:
        rev = rev_map.get(o["id"], {})
        plan = plan_by_id.get(o.get("plan_id"))
        n_events = evt_map.get(o["id"], 0)
        if activity:
            if activity == "none" and n_events != 0:
                continue
            if activity == "1-5" and not (1 <= n_events <= 5):
                continue
            if activity == "5+" and n_events < 5:
                continue
            if activity == "10+" and n_events < 10:
                continue
        enriched.append({
            "id": o["id"],
            "slug": o["slug"],
            "company_name": o["company_name"],
            "email": o["email"],
            "status": o.get("status"),
            "subscription_status": o.get("subscription_status"),
            "plan_code": plan["code"] if plan else None,
            "plan_name": plan["name"] if plan else None,
            "created_at": o.get("created_at"),
            "revenue": rev.get("revenue", 0),
            "tickets_emitted": rev.get("tickets", 0),
            "events_published": n_events,
            "last_login": login_map.get(o["id"]),
        })

    # Sort
    reverse = direction == "desc"

    def sort_key(it):
        v = it.get(sort)
        if v is None:
            return "" if isinstance(it.get(sort), str) else 0
        return v

    enriched.sort(key=sort_key, reverse=reverse)

    total = len(enriched)
    start = (page - 1) * limit
    items = enriched[start : start + limit]
    return {"items": items, "total": total, "page": page, "limit": limit}


# ── Global audit log ─────────────────────────────────────────────────────────
@router.get("/audit-log")
async def audit_log(
    action: Optional[str] = Query(default=None),
    actor_user_id: Optional[str] = Query(default=None),
    target_type: Optional[str] = Query(default=None),
    target_id: Optional[str] = Query(default=None),
    created_from: Optional[str] = Query(default=None),
    created_to: Optional[str] = Query(default=None),
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=50, ge=1, le=200),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    stmt = select(AuditLog)
    if action:
        stmt = stmt.where(AuditLog.action.ilike(f"%{action}%"))
    if actor_user_id:
        stmt = stmt.where(AuditLog.actor_user_id == actor_user_id)
    if target_type:
        stmt = stmt.where(AuditLog.target_type == target_type)
    if target_id:
        stmt = stmt.where(AuditLog.target_id == target_id)
    if created_from:
        stmt = stmt.where(AuditLog.created_at >= datetime.fromisoformat(created_from))
    if created_to:
        stmt = stmt.where(AuditLog.created_at <= datetime.fromisoformat(created_to))

    total = await session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    result = await session.execute(
        stmt.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * limit)
        .limit(limit)
    )
    items = [row_to_dict(r) for r in result.scalars().all()]

    # Enrich actor with email
    actor_ids = list({it.get("actor_user_id") for it in items if it.get("actor_user_id")})
    actors: Dict[str, dict] = {}
    if actor_ids:
        users_result = await session.execute(
            select(User.id, User.email, User.role).where(User.id.in_(actor_ids))
        )
        for u in users_result.all():
            actors[u.id] = {"id": u.id, "email": u.email, "role": u.role}
    for it in items:
        it["actor"] = actors.get(it.get("actor_user_id"))
    return {"items": items, "total": total, "page": page, "limit": limit}
