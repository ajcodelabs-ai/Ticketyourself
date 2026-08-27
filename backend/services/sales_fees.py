"""
Per-ticket sales commission (TYS fee) from admin-configured combinations.

Match key: plan_code × pricing_type × ticket price range.
fee_mode is exclusive: either a fixed cents amount OR a percent of the ticket
price — never both.

Distinct from the pre-event publish fee in event_fees.py.
If no rule matches a paid ticket, falls back to TYS_FEE_PERCENT (env).
Free / donation unmatched → $0.
"""

from __future__ import annotations

import os
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

FALLBACK_PERCENT = float(os.environ.get("TYS_FEE_PERCENT", "5"))
PRICING_TYPES = ("paid", "free", "donation")
FEE_MODES = ("fixed", "percent")
BEARERS = ("buyer", "organizer")
UNBOUNDED = 10**18


def _hi(max_price_cents: Optional[int]) -> int:
    return UNBOUNDED if max_price_cents is None else int(max_price_cents)


def ranges_overlap(
    a_min: int,
    a_max: Optional[int],
    b_min: int,
    b_max: Optional[int],
) -> bool:
    return int(a_min) <= _hi(b_max) and int(b_min) <= _hi(a_max)


def match_rule(
    rules: Iterable[dict],
    *,
    plan_code: Optional[str],
    pricing_type: str,
    price_cents: int,
) -> Optional[dict]:
    """Most specific matching range (smallest span) wins if overlaps slipped in."""
    if not plan_code:
        return None
    price = max(0, int(price_cents or 0))
    ptype = (pricing_type or "paid").lower()
    candidates: List[tuple[int, dict]] = []
    for raw in rules or []:
        if not raw.get("active", True):
            continue
        if raw.get("plan_code") != plan_code:
            continue
        if (raw.get("pricing_type") or "").lower() != ptype:
            continue
        lo = int(raw.get("min_price_cents") or 0)
        hi = raw.get("max_price_cents")
        hi_i = int(hi) if hi is not None else None
        if price < lo:
            continue
        if hi_i is not None and price > hi_i:
            continue
        span = _hi(hi_i) - lo
        candidates.append((span, raw))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0])
    return candidates[0][1]


def resolve_fee_mode(rule: dict) -> str:
    mode = (rule.get("fee_mode") or "").lower()
    if mode in FEE_MODES:
        return mode
    # Legacy rows that stored both: percent wins, never sum.
    if int(rule.get("fee_percent_bps") or 0) > 0:
        return "percent"
    return "fixed"


def normalize_fee_amounts(
    fee_mode: str, fee_fixed_cents: int, fee_percent_bps: int
) -> tuple[str, int, int]:
    mode = (fee_mode or "").lower()
    if mode not in FEE_MODES:
        raise ValueError("La comisión es monto fijo o porcentaje, no ambos.")
    fixed = max(0, int(fee_fixed_cents or 0))
    bps = max(0, int(fee_percent_bps or 0))
    if mode == "fixed":
        if fixed <= 0:
            raise ValueError("Indicá un monto fijo mayor a 0.")
        return mode, fixed, 0
    if bps <= 0:
        raise ValueError("Indicá un porcentaje mayor a 0.")
    return mode, 0, bps


def fee_cents_for_price(price_cents: int, rule: dict) -> int:
    price = max(0, int(price_cents or 0))
    mode = resolve_fee_mode(rule)
    if mode == "percent":
        bps = max(0, int(rule.get("fee_percent_bps") or 0))
        return int(round(price * bps / 10_000)) if bps else 0
    return max(0, int(rule.get("fee_fixed_cents") or 0))


def fallback_fee_cents(price_cents: int, pricing_type: str) -> int:
    if (pricing_type or "").lower() != "paid":
        return 0
    price = max(0, int(price_cents or 0))
    if price <= 0 or FALLBACK_PERCENT <= 0:
        return 0
    return int(round(price * FALLBACK_PERCENT / 100))


def quote_one(
    *,
    rules: Iterable[dict],
    plan_code: Optional[str],
    pricing_type: str,
    price_cents: int,
) -> Dict[str, Any]:
    ptype = (pricing_type or "paid").lower()
    price = max(0, int(price_cents or 0))
    rule = match_rule(rules, plan_code=plan_code, pricing_type=ptype, price_cents=price)
    if rule:
        fee = fee_cents_for_price(price, rule)
        mode = resolve_fee_mode(rule)
        return {
            "matched": True,
            "fee_cents": fee,
            "fee_mode": mode,
            "fee_fixed_cents": (
                int(rule.get("fee_fixed_cents") or 0) if mode == "fixed" else 0
            ),
            "fee_percent_bps": (
                int(rule.get("fee_percent_bps") or 0) if mode == "percent" else 0
            ),
            "rule_id": rule.get("id"),
            "plan_code": plan_code,
            "pricing_type": ptype,
            "price_cents": price,
            "fallback": False,
        }
    fee = fallback_fee_cents(price, ptype)
    return {
        "matched": False,
        "fee_cents": fee,
        "fee_mode": "percent" if ptype == "paid" else "fixed",
        "fee_fixed_cents": 0,
        "fee_percent_bps": int(round(FALLBACK_PERCENT * 100)) if ptype == "paid" else 0,
        "rule_id": None,
        "plan_code": plan_code,
        "pricing_type": ptype,
        "price_cents": price,
        "fallback": ptype == "paid" and fee > 0,
    }


def resolve_platform_fee(
    *,
    event: dict,
    unit_prices: List[int],
    sales_fee_rules: Optional[List[dict]] = None,
    plan_code: Optional[str] = None,
) -> Dict[str, Any]:
    """Sum per-ticket commission. `fees_cents` is always the platform cut.

    `buyer_fee_cents` is added to checkout total only when the organizer
    chose to pass the fee to the buyer (`platform_fee_bearer=buyer`).
    """
    bearer = (event.get("platform_fee_bearer") or "buyer").lower()
    if bearer not in BEARERS:
        bearer = "buyer"
    ptype = (event.get("pricing_type") or "paid").lower()
    plan = plan_code or event.get("plan_code")
    rules = list(sales_fee_rules or [])
    total_fee = 0
    matched_any = False
    for raw_price in unit_prices:
        q = quote_one(
            rules=rules,
            plan_code=plan,
            pricing_type=ptype,
            price_cents=int(raw_price or 0),
        )
        total_fee += int(q["fee_cents"])
        if q["matched"]:
            matched_any = True
    buyer_fee = total_fee if bearer == "buyer" else 0
    return {
        "fees_cents": total_fee,
        "buyer_fee_cents": buyer_fee,
        "platform_fee_bearer": bearer,
        "matched": matched_any,
    }


def apply_platform_fee(
    totals: dict,
    *,
    event: dict,
    unit_prices: List[int],
    sales_fee_rules: Optional[List[dict]] = None,
    plan_code: Optional[str] = None,
) -> dict:
    info = resolve_platform_fee(
        event=event,
        unit_prices=unit_prices,
        sales_fee_rules=sales_fee_rules,
        plan_code=plan_code,
    )
    subtotal = int(totals.get("subtotal_cents") or 0)
    totals["fees_cents"] = info["fees_cents"]
    totals["platform_fee_bearer"] = info["platform_fee_bearer"]
    totals["total_cents"] = subtotal + info["buyer_fee_cents"]
    return totals


def rule_to_dict(row) -> dict:
    mode = resolve_fee_mode(
        {
            "fee_mode": getattr(row, "fee_mode", None),
            "fee_percent_bps": row.fee_percent_bps,
            "fee_fixed_cents": row.fee_fixed_cents,
        }
    )
    return {
        "id": row.id,
        "plan_code": row.plan_code,
        "pricing_type": row.pricing_type,
        "min_price_cents": int(row.min_price_cents or 0),
        "max_price_cents": row.max_price_cents,
        "fee_mode": mode,
        "fee_fixed_cents": int(row.fee_fixed_cents or 0) if mode == "fixed" else 0,
        "fee_percent_bps": int(row.fee_percent_bps or 0) if mode == "percent" else 0,
        "active": bool(row.active),
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    }


async def list_sales_fee_rules(
    session: AsyncSession, *, active_only: bool = False
) -> List[dict]:
    from orm_models import SalesFeeRule

    stmt = select(SalesFeeRule).order_by(
        SalesFeeRule.plan_code,
        SalesFeeRule.pricing_type,
        SalesFeeRule.min_price_cents,
    )
    if active_only:
        stmt = stmt.where(SalesFeeRule.active.is_(True))
    rows = (await session.execute(stmt)).scalars().all()
    return [rule_to_dict(r) for r in rows]


def find_overlapping_rule(
    existing: Iterable[dict],
    *,
    plan_code: str,
    pricing_type: str,
    min_price_cents: int,
    max_price_cents: Optional[int],
    exclude_id: Optional[str] = None,
) -> Optional[dict]:
    for row in existing:
        if exclude_id and row.get("id") == exclude_id:
            continue
        if not row.get("active", True):
            continue
        if row.get("plan_code") != plan_code:
            continue
        if (row.get("pricing_type") or "").lower() != pricing_type.lower():
            continue
        if ranges_overlap(
            min_price_cents,
            max_price_cents,
            int(row.get("min_price_cents") or 0),
            row.get("max_price_cents"),
        ):
            return row
    return None
