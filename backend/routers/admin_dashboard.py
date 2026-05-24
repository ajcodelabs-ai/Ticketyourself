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
from pydantic import BaseModel

from db import db
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
async def dashboard_stats() -> Dict[str, Any]:
    """
    Returns the global KPIs + distribution + activity + top tables for the
    super-admin home. Uses $facet so the entire payload is a single round-trip
    to Mongo for the heavy aggregations.
    """
    month_now = _month_start(0)
    month_prev = _month_start(-1)
    month_now_iso = month_now.isoformat()
    month_prev_iso = month_prev.isoformat()

    # ── KPIs from organizers + plans (MRR + active organizers) ────────────
    plans = await db.subscription_plans.find(
        {}, {"_id": 0, "id": 1, "code": 1, "name": 1, "price_cents": 1, "billing_period": 1}
    ).to_list(length=200)
    plan_by_id = {p["id"]: p for p in plans}
    plan_codes = {p["code"]: p for p in plans}

    mrr_cents = 0
    active_organizers = 0
    orgs_cursor = db.organizers.find(
        {},
        {"_id": 0, "id": 1, "company_name": 1, "plan_id": 1, "status": 1, "subscription_status": 1},
    )
    organizers_by_status: Dict[str, int] = {"pending": 0, "approved": 0, "rejected": 0, "suspended": 0}
    organizers_by_plan: Dict[str, int] = {c: 0 for c in plan_codes}
    organizers_by_plan["sin_plan"] = 0
    async for o in orgs_cursor:
        sb = o.get("status")
        if sb in organizers_by_status:
            organizers_by_status[sb] += 1
        plan = plan_by_id.get(o.get("plan_id"))
        if plan:
            organizers_by_plan[plan["code"]] = organizers_by_plan.get(plan["code"], 0) + 1
        else:
            organizers_by_plan["sin_plan"] += 1
        is_active = (
            o.get("status") == "approved" and o.get("subscription_status") == "active"
        )
        if is_active:
            active_organizers += 1
            if plan and plan["billing_period"] == "monthly":
                mrr_cents += plan["price_cents"]

    # ── GMV + fees (paid orders) — current vs prev month ──────────────────
    gmv_pipeline = [
        {
            "$facet": {
                "month": [
                    {"$match": {"status": "paid", "paid_at": {"$gte": month_now_iso}}},
                    {"$group": {"_id": None, "gmv": {"$sum": "$total_cents"}, "fees": {"$sum": "$fees_cents"}, "tickets": {"$sum": "$quantity_total"}, "n": {"$sum": 1}}},
                ],
                "prev": [
                    {"$match": {"status": "paid", "paid_at": {"$gte": month_prev_iso, "$lt": month_now_iso}}},
                    {"$group": {"_id": None, "gmv": {"$sum": "$total_cents"}, "n": {"$sum": 1}}},
                ],
                "month_breakdown": [
                    {"$match": {"created_at": {"$gte": month_now_iso}}},
                    {"$group": {"_id": "$status", "n": {"$sum": 1}}},
                ],
                "tickets_total": [
                    {"$match": {"status": "paid"}},
                    {"$group": {"_id": None, "n": {"$sum": "$quantity_total"}}},
                ],
            }
        }
    ]
    agg = (await db.ticket_orders.aggregate(gmv_pipeline).to_list(length=1))[0]
    cur = (agg["month"][0] if agg["month"] else {"gmv": 0, "fees": 0, "tickets": 0, "n": 0})
    prev = (agg["prev"][0] if agg["prev"] else {"gmv": 0, "n": 0})
    breakdown = {d["_id"]: d["n"] for d in agg["month_breakdown"]}
    tickets_total = (agg["tickets_total"][0]["n"] if agg["tickets_total"] else 0)

    # ── Events activity ───────────────────────────────────────────────────
    events_published_total = await db.events.count_documents({"status": "published"})
    events_published_month = await db.events.count_documents(
        {"status": "published", "published_at": {"$gte": month_now_iso}}
    )

    # ── Top 5 organizers by GMV (current month) ───────────────────────────
    top_orgs_pipeline = [
        {"$match": {"status": "paid", "paid_at": {"$gte": month_now_iso}}},
        {
            "$group": {
                "_id": "$organizer_id",
                "gmv": {"$sum": "$total_cents"},
                "tickets": {"$sum": "$quantity_total"},
                "orders": {"$sum": 1},
            }
        },
        {"$sort": {"gmv": -1}},
        {"$limit": 5},
    ]
    top_orgs_raw = await db.ticket_orders.aggregate(top_orgs_pipeline).to_list(length=5)
    top_organizers_by_gmv = []
    for row in top_orgs_raw:
        org = await db.organizers.find_one(
            {"id": row["_id"]}, {"_id": 0, "id": 1, "slug": 1, "company_name": 1, "plan_id": 1}
        )
        if not org:
            continue
        plan = plan_by_id.get(org.get("plan_id"))
        top_organizers_by_gmv.append({
            "organizer_id": org["id"],
            "slug": org["slug"],
            "company_name": org["company_name"],
            "plan_name": plan["name"] if plan else None,
            "gmv_cents": row["gmv"],
            "tickets": row["tickets"],
            "orders": row["orders"],
        })

    # ── Top 5 events by sales (current month) ─────────────────────────────
    top_events_pipeline = [
        {"$match": {"status": "paid", "paid_at": {"$gte": month_now_iso}}},
        {
            "$group": {
                "_id": "$event_id",
                "gmv": {"$sum": "$total_cents"},
                "tickets": {"$sum": "$quantity_total"},
            }
        },
        {"$sort": {"gmv": -1}},
        {"$limit": 5},
    ]
    top_evt_raw = await db.ticket_orders.aggregate(top_events_pipeline).to_list(length=5)
    top_events_by_sales = []
    for row in top_evt_raw:
        evt = await db.events.find_one(
            {"id": row["_id"]},
            {"_id": 0, "id": 1, "slug": 1, "title": 1, "starts_at": 1, "capacity": 1,
             "tickets_sold": 1, "organizer_id": 1, "tenant_slug": 1},
        )
        if not evt:
            continue
        org = await db.organizers.find_one(
            {"id": evt["organizer_id"]}, {"_id": 0, "company_name": 1}
        )
        top_events_by_sales.append({
            "event_id": evt["id"],
            "slug": evt["slug"],
            "title": evt["title"],
            "starts_at": evt.get("starts_at"),
            "tenant_slug": evt.get("tenant_slug"),
            "company_name": (org or {}).get("company_name"),
            "tickets_sold": evt.get("tickets_sold", 0),
            "capacity": evt.get("capacity"),
            "gmv_cents": row["gmv"],
            "tickets": row["tickets"],
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
async def attention_items() -> Dict[str, Any]:
    pending_organizers = await db.organizers.count_documents({"status": "pending"})
    cutoff_24h = (_now() - timedelta(hours=24)).isoformat()
    stale_manual_orders = await db.ticket_orders.count_documents(
        {"status": "pending_manual_payment", "created_at": {"$lt": cutoff_24h}}
    )
    past_due_subs = await db.organizers.count_documents(
        {"subscription_status": "past_due"}
    )
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
) -> Dict[str, Any]:
    """
    Rich list of organizers with aggregated metrics: revenue, tickets_emitted,
    events_published, last_login. Filter + sort done in-memory for now (small
    dataset). Total < 10k organizers expected at this stage.
    """
    plans = await db.subscription_plans.find(
        {}, {"_id": 0, "id": 1, "code": 1, "name": 1}
    ).to_list(length=200)
    plan_by_id = {p["id"]: p for p in plans}
    plan_id_by_code = {p["code"]: p["id"] for p in plans}

    base_query: dict = {}
    if status:
        base_query["status"] = status
    if subscription_status:
        base_query["subscription_status"] = subscription_status
    if plan_code:
        base_query["plan_id"] = plan_id_by_code.get(plan_code, "____none____")
    if created_from or created_to:
        cq: dict = {}
        if created_from:
            cq["$gte"] = created_from
        if created_to:
            cq["$lte"] = created_to
        base_query["created_at"] = cq
    if search:
        regex = {"$regex": search.strip(), "$options": "i"}
        base_query["$or"] = [
            {"company_name": regex},
            {"email": regex},
            {"slug": regex},
        ]

    organizers = await db.organizers.find(base_query, {"_id": 0}).to_list(length=10_000)
    org_ids = [o["id"] for o in organizers]
    if not org_ids:
        return {"items": [], "total": 0, "page": page, "limit": limit}

    # Aggregate revenue + tickets per organizer
    rev_pipeline = [
        {"$match": {"organizer_id": {"$in": org_ids}, "status": "paid"}},
        {"$group": {"_id": "$organizer_id", "revenue": {"$sum": "$total_cents"},
                    "tickets": {"$sum": "$quantity_total"}}},
    ]
    rev_map = {r["_id"]: r async for r in db.ticket_orders.aggregate(rev_pipeline)}

    # Events published count per organizer
    evt_pipeline = [
        {"$match": {"organizer_id": {"$in": org_ids}, "status": "published"}},
        {"$group": {"_id": "$organizer_id", "n": {"$sum": 1}}},
    ]
    evt_map = {e["_id"]: e["n"] async for e in db.events.aggregate(evt_pipeline)}

    # Last login from users collection
    user_pipeline = [
        {"$match": {"organizer_id": {"$in": org_ids}, "role": "organizer"}},
        {"$group": {"_id": "$organizer_id", "last_login": {"$max": "$last_login"}}},
    ]
    login_map = {u["_id"]: u["last_login"] async for u in db.users.aggregate(user_pipeline)}

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
) -> Dict[str, Any]:
    q: dict = {}
    if action:
        q["action"] = {"$regex": action, "$options": "i"}
    if actor_user_id:
        q["actor_user_id"] = actor_user_id
    if target_type:
        q["target_type"] = target_type
    if target_id:
        q["target_id"] = target_id
    if created_from or created_to:
        cq: dict = {}
        if created_from:
            cq["$gte"] = created_from
        if created_to:
            cq["$lte"] = created_to
        q["created_at"] = cq
    total = await db.audit_log.count_documents(q)
    cursor = (
        db.audit_log.find(q, {"_id": 0})
        .sort("created_at", -1)
        .skip((page - 1) * limit)
        .limit(limit)
    )
    items = [d async for d in cursor]
    # Enrich actor with email
    actor_ids = list({i.get("actor_user_id") for i in items if i.get("actor_user_id")})
    actors = {}
    if actor_ids:
        async for u in db.users.find(
            {"id": {"$in": actor_ids}}, {"_id": 0, "id": 1, "email": 1, "role": 1}
        ):
            actors[u["id"]] = u
    for it in items:
        it["actor"] = actors.get(it.get("actor_user_id"))
    return {"items": items, "total": total, "page": page, "limit": limit}
