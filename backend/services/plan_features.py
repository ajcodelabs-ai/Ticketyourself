"""
Plan feature gating — single source of truth for "what can this plan do".

Phase 5 ships the ARCHITECTURE only. Enforcement is OFF by default; the UI
reads the feature flags to:
  - show "Próximamente" vs "Mejorá a [plan]" labels on disabled toggles
  - decide which event sections / limits are visible.

To enforce later: have endpoints call `assert_feature(plan_code, "xxx")`.
"""
from typing import Dict, Any, Optional

from fastapi import HTTPException

# Feature shape — kept flat for easy serialisation to the frontend.
DEFAULT_FEATURES: Dict[str, Any] = {
    # Toggles (boolean)
    "numbered_seating": False,         # Fase 6 — venue editor + seat map
    "multi_function_events": False,    # Fase 8 — multiple show dates per event
    "advanced_discounts": False,       # Fase 3b — NxM, group, time-based
    "promo_codes": False,              # Fase 3b
    "verified_lists": False,           # gated guest list with doc upload
    "access_codes": False,             # entry by code
    "custom_domain": False,
    "ai_ticket_design": False,
    "manual_payments": True,           # transfer + cash — Phase 5 ✓
    "presale_discount": True,
    "disability_discount": True,
    "gallery_uploads": True,
    # Quotas (-1 = unlimited)
    "max_events": 5,
    "max_tickets_per_event": 500,
    "max_venues": 1,
    "max_gallery_images": 10,
}


PLAN_OVERRIDES: Dict[str, Dict[str, Any]] = {
    # Pay-as-you-go single event.
    "evento_unico": {
        "max_events": 1,
        "max_tickets_per_event": 200,
        "max_venues": 1,
    },
    # Monthly starter.
    "basico": {
        "max_events": 5,
        "max_tickets_per_event": 500,
        "max_venues": 1,
    },
    # Monthly pro.
    "profesional": {
        "numbered_seating": True,     # available once Fase 6 ships
        "advanced_discounts": True,
        "promo_codes": True,
        "max_events": -1,
        "max_tickets_per_event": -1,
        "max_venues": 5,
        "max_gallery_images": 20,
    },
    # Enterprise.
    "enterprise": {
        "numbered_seating": True,
        "multi_function_events": True,
        "advanced_discounts": True,
        "promo_codes": True,
        "verified_lists": True,
        "access_codes": True,
        "custom_domain": True,
        "ai_ticket_design": True,
        "max_events": -1,
        "max_tickets_per_event": -1,
        "max_venues": -1,
        "max_gallery_images": 50,
    },
}


def get_plan_features(plan_code: Optional[str]) -> Dict[str, Any]:
    """Returns the feature dict for a plan. Unknown / null plan → defaults."""
    base = DEFAULT_FEATURES.copy()
    if plan_code and plan_code in PLAN_OVERRIDES:
        base.update(PLAN_OVERRIDES[plan_code])
    base["_plan_code"] = plan_code
    return base


def assert_feature(plan_code: Optional[str], feature: str) -> None:
    """Raises 403 when `feature` is not enabled for the organizer's plan."""
    if not get_plan_features(plan_code).get(feature, False):
        raise HTTPException(
            403,
            f"Tu plan actual no incluye esta función ({feature}). Mejorá tu plan para usarla.",
        )
