"""
GET /api/dashboard/me — single aggregated payload for the organizer home.

Joins:
  - organizer profile + plan + admin comments (already in user.organizer)
  - this-month revenue + tickets sold + paid orders
  - top 5 upcoming events (status=published, starts_at >= now)
  - published events count + funnel placeholder
  - microsite published flag

Single call avoids N+1 from the dashboard page.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from db import db
from security import get_current_user
from services.plan_features import get_plan_features

logger = logging.getLogger("tys.dashboard")
router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _month_start() -> datetime:
    n = _now()
    return n.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


@router.get("/me")
async def my_dashboard(user=Depends(get_current_user)) -> Dict[str, Any]:
    org_id = user.get("organizer_id")
    if not org_id:
        return {"organizer": None}

    organizer = await db.organizers.find_one({"id": org_id}, {"_id": 0})
    if not organizer:
        return {"organizer": None}

    # ── Plan info ─────────────────────────────────────────────────────────
    plan = None
    if organizer.get("plan_id"):
        plan = await db.subscription_plans.find_one(
            {"id": organizer["plan_id"]}, {"_id": 0}
        )

    # ── This-month financials ─────────────────────────────────────────────
    month_iso = _month_start().isoformat()
    revenue_pipeline = [
        {
            "$match": {
                "organizer_id": org_id,
                "status": "paid",
                "paid_at": {"$gte": month_iso},
            }
        },
        {
            "$group": {
                "_id": None,
                "revenue": {"$sum": "$subtotal_cents"},
                "fees": {"$sum": "$fees_cents"},
                "tickets": {"$sum": "$quantity_total"},
                "orders": {"$sum": 1},
            }
        },
    ]
    cursor = db.ticket_orders.aggregate(revenue_pipeline)
    agg = await cursor.to_list(length=1)
    month = agg[0] if agg else {"revenue": 0, "fees": 0, "tickets": 0, "orders": 0}

    # ── Published events count + upcoming ─────────────────────────────────
    published_count = await db.events.count_documents(
        {"organizer_id": org_id, "status": "published"}
    )
    draft_count = await db.events.count_documents(
        {"organizer_id": org_id, "status": "draft"}
    )

    now_iso = _now().isoformat()
    upcoming_cursor = (
        db.events.find(
            {
                "organizer_id": org_id,
                "status": "published",
                "starts_at": {"$gte": now_iso},
            },
            {
                "_id": 0,
                "id": 1,
                "slug": 1,
                "title": 1,
                "starts_at": 1,
                "venue_name": 1,
                "venue_city": 1,
                "tickets_sold": 1,
                "capacity": 1,
                "status": 1,
            },
        )
        .sort("starts_at", 1)
        .limit(5)
    )
    upcoming: List[Dict[str, Any]] = [e async for e in upcoming_cursor]
    next_event = upcoming[0] if upcoming else None
    days_to_next = None
    if next_event:
        try:
            t = datetime.fromisoformat(next_event["starts_at"].replace("Z", "+00:00"))
            days_to_next = max(0, (t - _now()).days)
        except (ValueError, AttributeError):
            days_to_next = None

    # ── Microsite ─────────────────────────────────────────────────────────
    microsite = await db.microsites.find_one(
        {"organizer_id": org_id}, {"_id": 0, "published": 1, "template": 1, "updated_at": 1}
    )

    # ── Funnel — basic ────────────────────────────────────────────────────
    total_orders = await db.ticket_orders.count_documents({"organizer_id": org_id})
    paid_orders_total = await db.ticket_orders.count_documents(
        {"organizer_id": org_id, "status": "paid"}
    )
    conversion = round(paid_orders_total / total_orders, 4) if total_orders else 0

    # ── Plan features ─────────────────────────────────────────────────────
    plan_code = plan["code"] if plan else None
    features = get_plan_features(plan_code)

    return {
        "organizer": {
            "id": organizer["id"],
            "slug": organizer["slug"],
            "company_name": organizer["company_name"],
            "status": organizer["status"],
            "subscription_status": organizer.get("subscription_status"),
            "current_period_end": organizer.get("current_period_end"),
            "admin_comments": organizer.get("admin_comments", []),
        },
        "plan": (
            {
                "code": plan["code"],
                "name": plan["name"],
                "price_cents": plan["price_cents"],
                "billing_period": plan["billing_period"],
                "features": plan.get("features", []),
            }
            if plan
            else None
        ),
        "stats": {
            "revenue_cents": month["revenue"] or 0,
            "fees_cents": month["fees"] or 0,
            "tickets_sold_month": month["tickets"] or 0,
            "orders_month": month["orders"] or 0,
            "published_events": published_count,
            "draft_events": draft_count,
            "days_to_next_event": days_to_next,
        },
        "next_event": next_event,
        "upcoming_events": upcoming,
        "microsite": microsite or {"published": False, "template": None},
        "funnel": {
            "total_orders": total_orders,
            "paid_orders": paid_orders_total,
            "conversion_rate": conversion,
            "visits": None,  # placeholder until analytics integration
        },
        "features": features,
    }
