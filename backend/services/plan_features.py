"""
Plan feature gating — merges hardcoded defaults with DB plan columns / feature_flags.

Endpoints can call `assert_feature(plan_code, "xxx")` or use async helpers that
load the SubscriptionPlan row for admin-editable overrides.
"""

from typing import Any, Dict, Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Feature shape — kept flat for easy serialisation to the frontend.
DEFAULT_FEATURES: Dict[str, Any] = {
    "numbered_seating": False,
    "multi_function_events": False,
    "advanced_discounts": False,
    "promo_codes": False,
    "verified_lists": False,
    "access_codes": False,
    "custom_domain": False,
    "ai_ticket_design": False,
    "manual_payments": True,
    "presale_discount": True,
    "disability_discount": True,
    "senior_discount": True,
    "gallery_uploads": True,
    "includes_marketing": False,
    "allows_paid_events": True,
    "allows_free_events": True,
    "max_events": 5,
    "max_events_year": -1,
    "max_tickets_per_event": 500,
    "max_venues": 1,
    "max_gallery_images": 10,
    "verification_fee_cents": 0,
    "event_fee_enabled": False,
    "event_fee_per_ticket_cents": 0,
    "event_fee_percent_bps": 0,
    "pre_event_fee_required": False,
}


PLAN_OVERRIDES: Dict[str, Dict[str, Any]] = {
    "evento_unico": {
        "max_events": 1,
        "max_tickets_per_event": 200,
        "max_venues": 1,
        "verification_fee_cents": 1000,
        "event_fee_enabled": True,
        "event_fee_per_ticket_cents": 10,
        "event_fee_percent_bps": 50,
    },
    "basico": {
        "max_events": 5,
        "max_tickets_per_event": 500,
        "max_venues": 1,
        "verification_fee_cents": 0,
    },
    "profesional": {
        "numbered_seating": True,
        "advanced_discounts": True,
        "promo_codes": True,
        "includes_marketing": True,
        "max_events": -1,
        "max_tickets_per_event": -1,
        "max_venues": 5,
        "max_gallery_images": 20,
        "microsite_custom_css": True,
        "verification_fee_cents": 1000,
        "event_fee_enabled": True,
        "event_fee_per_ticket_cents": 10,
        "event_fee_percent_bps": 50,
    },
    "enterprise": {
        "numbered_seating": True,
        "multi_function_events": True,
        "advanced_discounts": True,
        "promo_codes": True,
        "verified_lists": True,
        "access_codes": True,
        "custom_domain": True,
        "ai_ticket_design": True,
        "includes_marketing": True,
        "microsite_custom_css": True,
        "max_events": -1,
        "max_tickets_per_event": -1,
        "max_venues": -1,
        "max_gallery_images": 50,
        "verification_fee_cents": 1000,
        "event_fee_enabled": True,
        "event_fee_per_ticket_cents": 5,
        "event_fee_percent_bps": 25,
    },
}


def get_plan_features(plan_code: Optional[str]) -> Dict[str, Any]:
    """Returns the feature dict for a plan. Unknown / null plan → defaults."""
    base = DEFAULT_FEATURES.copy()
    if plan_code and plan_code in PLAN_OVERRIDES:
        base.update(PLAN_OVERRIDES[plan_code])
    base["_plan_code"] = plan_code
    return base


def features_from_plan_row(row) -> Dict[str, Any]:
    """Build feature dict from a SubscriptionPlan ORM/dict row (admin source of truth)."""
    if row is None:
        return get_plan_features(None)
    if hasattr(row, "code"):
        data = {
            "code": row.code,
            "max_events": row.max_events,
            "max_events_year": getattr(row, "max_events_year", -1),
            "max_tickets_per_event": row.max_tickets_per_event,
            "includes_numbered": row.includes_numbered,
            "includes_ai_design": row.includes_ai_design,
            "includes_custom_domain": row.includes_custom_domain,
            "includes_marketing": getattr(row, "includes_marketing", False),
            "allows_paid_events": getattr(row, "allows_paid_events", True),
            "allows_free_events": getattr(row, "allows_free_events", True),
            "access_types": getattr(row, "access_types", None),
            "verification_fee_cents": getattr(row, "verification_fee_cents", 0) or 0,
            "event_fee_enabled": getattr(row, "event_fee_enabled", False),
            "event_fee_per_ticket_cents": getattr(row, "event_fee_per_ticket_cents", 0)
            or 0,
            "event_fee_percent_bps": getattr(row, "event_fee_percent_bps", 0) or 0,
            "feature_flags": getattr(row, "feature_flags", None),
        }
    else:
        data = dict(row)

    base = get_plan_features(data.get("code"))
    base.update(
        {
            "numbered_seating": bool(data.get("includes_numbered")),
            "custom_domain": bool(data.get("includes_custom_domain")),
            "ai_ticket_design": bool(data.get("includes_ai_design")),
            "includes_marketing": bool(data.get("includes_marketing")),
            "allows_paid_events": bool(data.get("allows_paid_events", True)),
            "allows_free_events": bool(data.get("allows_free_events", True)),
            "max_events": data.get("max_events", base["max_events"]),
            "max_events_year": data.get(
                "max_events_year", base.get("max_events_year", -1)
            ),
            "max_tickets_per_event": data.get(
                "max_tickets_per_event", base["max_tickets_per_event"]
            ),
            "verification_fee_cents": int(data.get("verification_fee_cents") or 0),
            "event_fee_enabled": bool(data.get("event_fee_enabled")),
            "event_fee_per_ticket_cents": int(
                data.get("event_fee_per_ticket_cents") or 0
            ),
            "event_fee_percent_bps": int(data.get("event_fee_percent_bps") or 0),
            "access_types": data.get("access_types") or [],
        }
    )
    flags = data.get("feature_flags") or {}
    if isinstance(flags, dict):
        base.update(flags)
    base["_plan_code"] = data.get("code")
    return base


async def get_plan_features_async(
    session: AsyncSession, plan_code: Optional[str]
) -> Dict[str, Any]:
    from services.platform_settings import is_pre_event_fee_required

    if not plan_code:
        feats = get_plan_features(None)
    else:
        from orm_models import SubscriptionPlan

        result = await session.execute(
            select(SubscriptionPlan).where(SubscriptionPlan.code == plan_code)
        )
        row = result.scalar_one_or_none()
        feats = (
            get_plan_features(plan_code)
            if not row
            else features_from_plan_row(row)
        )
    feats["pre_event_fee_required"] = await is_pre_event_fee_required(session)
    return feats


def assert_feature(plan_code: Optional[str], feature: str) -> None:
    """Raises 403 when `feature` is not enabled for the organizer's plan."""
    if not get_plan_features(plan_code).get(feature, False):
        raise HTTPException(
            403,
            f"Tu plan actual no incluye esta función ({feature}). Mejorá tu plan para usarla.",
        )


async def assert_feature_async(
    session: AsyncSession, plan_code: Optional[str], feature: str
) -> None:
    """Like assert_feature but merges DB plan columns / feature_flags."""
    feats = await get_plan_features_async(session, plan_code)
    if not feats.get(feature, False):
        raise HTTPException(
            403,
            f"Tu plan actual no incluye esta función ({feature}). Mejorá tu plan para usarla.",
        )
