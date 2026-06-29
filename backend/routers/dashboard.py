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
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import APIRouter, Depends

from database import AsyncSessionLocal
from db_helpers import get_microsite_by_organizer, get_organizer_by_id, row_to_dict
from orm_models import Event, SubscriptionPlan, TicketOrder
from security import get_current_user
from services.plan_features import get_plan_features
from sqlalchemy import func, select

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

    organizer = await get_organizer_by_id(org_id)
    if not organizer:
        return {"organizer": None}

    # ── Plan info ─────────────────────────────────────────────────────────
    plan = None
    if organizer.get("plan_id"):
        async with AsyncSessionLocal() as pg:
            plan_result = await pg.execute(
                select(SubscriptionPlan).where(SubscriptionPlan.id == organizer["plan_id"])
            )
            plan_row = plan_result.scalar_one_or_none()
        plan = row_to_dict(plan_row) if plan_row else None

    # ── This-month financials ─────────────────────────────────────────────
    month_start = _month_start()

    # ── Published events count + upcoming + monthly revenue ───────────────
    async with AsyncSessionLocal() as pg:
        rev_row = (await pg.execute(
            select(
                func.coalesce(func.sum(TicketOrder.subtotal_cents), 0).label("revenue"),
                func.coalesce(func.sum(TicketOrder.fees_cents), 0).label("fees"),
                func.coalesce(func.sum(TicketOrder.quantity_total), 0).label("tickets"),
                func.count(TicketOrder.id).label("orders"),
            ).where(
                TicketOrder.organizer_id == org_id,
                TicketOrder.status == "paid",
                TicketOrder.paid_at >= month_start,
            )
        )).first()
        month = {
            "revenue": rev_row.revenue or 0,
            "fees": rev_row.fees or 0,
            "tickets": rev_row.tickets or 0,
            "orders": rev_row.orders or 0,
        }
        total_orders = await pg.scalar(
            select(func.count(TicketOrder.id)).where(TicketOrder.organizer_id == org_id)
        ) or 0
        paid_orders_total = await pg.scalar(
            select(func.count(TicketOrder.id)).where(
                TicketOrder.organizer_id == org_id, TicketOrder.status == "paid"
            )
        ) or 0
        published_count = await pg.scalar(
            select(func.count(Event.id)).where(
                Event.organizer_id == org_id, Event.status == "published"
            )
        ) or 0
        draft_count = await pg.scalar(
            select(func.count(Event.id)).where(
                Event.organizer_id == org_id, Event.status == "draft"
            )
        ) or 0
        now_dt = _now()
        upcoming_result = await pg.execute(
            select(
                Event.id, Event.slug, Event.title, Event.starts_at,
                Event.venue_name, Event.venue_city, Event.tickets_sold,
                Event.capacity, Event.status,
            )
            .where(
                Event.organizer_id == org_id,
                Event.status == "published",
                Event.starts_at >= now_dt,
            )
            .order_by(Event.starts_at.asc())
            .limit(5)
        )
        upcoming: List[Dict[str, Any]] = [
            {
                "id": r.id, "slug": r.slug, "title": r.title,
                "starts_at": r.starts_at, "venue_name": r.venue_name,
                "venue_city": r.venue_city, "tickets_sold": r.tickets_sold,
                "capacity": r.capacity, "status": r.status,
            }
            for r in upcoming_result.all()
        ]
    next_event = upcoming[0] if upcoming else None
    days_to_next = None
    if next_event:
        try:
            t = next_event["starts_at"]
            if isinstance(t, str):
                t = datetime.fromisoformat(t.replace("Z", "+00:00"))
            days_to_next = max(0, (t - _now()).days)
        except (ValueError, AttributeError):
            days_to_next = None

    # ── Microsite ─────────────────────────────────────────────────────────
    microsite = await get_microsite_by_organizer(org_id)

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
