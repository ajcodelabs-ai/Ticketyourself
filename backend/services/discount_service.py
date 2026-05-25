"""Discount evaluation & pricing for promo codes / auto / quantity rules.

Stacking policy (per the user's brief):
  • At most TWO rules from `discounts.rules[]` apply per order:
      ─ 1 of type `promo_code` (when buyer provided one)
      ─ 1 of type `auto` OR `quantity` (best automatic match)
  • Disability + presale are legacy toggles handled outside this module
    and stack independently on top.

Discount calculation happens AGAINST the per-item subtotal. A rule targets
either the full order (when `locality_ids` is empty/missing) or only the items
whose `locality_id` matches the list. For non-seated events `locality_id` is
None, so a locality-filtered rule never applies.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from db import db


# ── Item builder ─────────────────────────────────────────────────────────────
def items_from_payload(
    *,
    event: dict,
    venue: dict | None,
    seat_ids: list[str] | None,
    quantity: int,
) -> list[dict]:
    """Build the list of priced line items. Each item is a dict:
        {seat_id, locality_id, price_cents}
    For non-seated events we emit one synthetic item per ticket.
    """
    if seat_ids and venue:
        from services.seats import seats_by_id

        by_id = seats_by_id(venue)
        pricing_map = {
            lp["locality_id"]: int(lp.get("price_cents") or 0)
            for lp in (event.get("locality_pricing") or [])
        }
        items: list[dict] = []
        for sid in seat_ids:
            seat = by_id.get(sid)
            if not seat:
                continue
            loc = seat.get("locality_id")
            items.append({
                "seat_id": sid,
                "locality_id": loc,
                "price_cents": pricing_map.get(loc, 0),
            })
        return items
    unit = int(event.get("base_price_cents") or 0)
    return [
        {"seat_id": None, "locality_id": None, "price_cents": unit}
        for _ in range(quantity)
    ]


# ── Helpers ──────────────────────────────────────────────────────────────────
def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _rule_within_window(rule: dict) -> bool:
    cond = rule.get("conditions") or {}
    now = _now()
    vf = _parse_dt(cond.get("valid_from"))
    vu = _parse_dt(cond.get("valid_until"))
    if vf and now < vf:
        return False
    if vu and now > vu:
        return False
    return True


def _rule_has_quota(rule: dict) -> bool:
    if rule.get("type") != "promo_code":
        return True
    max_uses = rule.get("max_uses")
    if not max_uses:
        return True
    return int(rule.get("uses_count") or 0) < int(max_uses)


def _items_eligible_for_rule(items: list[dict], rule: dict) -> list[dict]:
    locs = (rule.get("conditions") or {}).get("locality_ids") or []
    if not locs:
        return list(items)
    return [it for it in items if it["locality_id"] in locs]


def _apply_rule_to_items(items: list[dict], rule: dict) -> int:
    """Returns the discount amount (cents) for `rule` over the eligible items."""
    eligible = _items_eligible_for_rule(items, rule)
    if not eligible:
        return 0
    eligible_subtotal = sum(it["price_cents"] for it in eligible)
    benefit = rule.get("discount") or {}
    btype = benefit.get("type")
    value = int(benefit.get("value") or 0)
    if btype == "percent":
        return min(eligible_subtotal, int(round(eligible_subtotal * value / 100)))
    if btype == "fixed":
        # `fixed` value is in USD per the model; convert to cents and cap to subtotal.
        return min(eligible_subtotal, value * 100)
    return 0


# ── Public evaluators ───────────────────────────────────────────────────────
def evaluate_promo_code(
    *, event: dict, items: list[dict], promo_code: str | None,
) -> tuple[dict | None, str | None]:
    """Resolve the rule matching `promo_code` (case-insensitive). Returns
    (rule, error). Either `rule` (a dict) when valid, or `error` (str) when
    the buyer should see a rejection toast."""
    if not promo_code:
        return None, None
    code = promo_code.strip().upper()
    rules = (event.get("discounts") or {}).get("rules") or []
    rule = next(
        (
            r for r in rules
            if r.get("type") == "promo_code"
            and (r.get("code") or "").upper() == code
        ),
        None,
    )
    if not rule:
        return None, "Código no válido."
    if not rule.get("enabled"):
        return None, "Este código ya no está activo."
    if not _rule_within_window(rule):
        return None, "El código no es válido en este momento."
    if not _rule_has_quota(rule):
        return None, "Este código ya alcanzó el máximo de usos."
    eligible = _items_eligible_for_rule(items, rule)
    if not eligible:
        return None, "Este código no aplica a las localidades seleccionadas."
    return rule, None


def evaluate_auto_quantity(
    *, event: dict, items: list[dict],
) -> dict | None:
    """Pick the best auto/quantity rule that applies. `best` = largest
    discount amount over the current items."""
    rules = (event.get("discounts") or {}).get("rules") or []
    qty = len(items)
    candidates: list[tuple[dict, int]] = []
    for r in rules:
        if not r.get("enabled"):
            continue
        if r.get("type") == "auto":
            pass
        elif r.get("type") == "quantity":
            if qty < int(r.get("min_quantity") or 1):
                continue
        else:
            continue
        if not _rule_within_window(r):
            continue
        amt = _apply_rule_to_items(items, r)
        if amt > 0:
            candidates.append((r, amt))
    if not candidates:
        return None
    candidates.sort(key=lambda t: t[1], reverse=True)
    return candidates[0][0]


def evaluate_discounts(
    *,
    event: dict,
    items: list[dict],
    promo_code: str | None,
) -> tuple[list[dict], list[str]]:
    """Returns (applied_rules, soft_warnings). Each applied_rules item has
    `{rule_id, name, type, amount_cents}`. soft_warnings are toast-friendly
    messages for promo-code rejections."""
    warnings: list[str] = []
    applied: list[dict] = []
    # 1) promo_code (buyer-driven)
    promo_rule, err = evaluate_promo_code(event=event, items=items, promo_code=promo_code)
    if err:
        warnings.append(err)
    if promo_rule:
        amt = _apply_rule_to_items(items, promo_rule)
        if amt > 0:
            applied.append({
                "rule_id": promo_rule.get("id"),
                "name": promo_rule.get("name"),
                "type": promo_rule.get("type"),
                "code": promo_rule.get("code"),
                "amount_cents": amt,
            })
    # 2) Best auto/quantity, excluding the already-applied promo_code rule.
    auto_rule = evaluate_auto_quantity(event=event, items=items)
    if auto_rule and (not promo_rule or auto_rule.get("id") != promo_rule.get("id")):
        amt = _apply_rule_to_items(items, auto_rule)
        if amt > 0:
            applied.append({
                "rule_id": auto_rule.get("id"),
                "name": auto_rule.get("name"),
                "type": auto_rule.get("type"),
                "code": None,
                "amount_cents": amt,
            })
    return applied, warnings


async def consume_promo_code(event_id: str, rule_id: str) -> bool:
    """Atomically increment `uses_count` for the matching rule. Returns True
    when the increment succeeded (i.e. we haven't exceeded `max_uses`)."""
    # We try a two-step approach to avoid race conditions:
    #   • If `max_uses` is set, increment only when `uses_count < max_uses`
    #   • Otherwise, plain `$inc`
    res = await db.events.update_one(
        {
            "id": event_id,
            "discounts.rules.id": rule_id,
            "$or": [
                {"discounts.rules.$.max_uses": None},
                {
                    "$expr": {
                        "$lt": [
                            "$discounts.rules.uses_count",
                            "$discounts.rules.max_uses",
                        ]
                    }
                },
            ],
        },
        {"$inc": {"discounts.rules.$.uses_count": 1}},
    )
    return res.modified_count > 0


def assert_buyer_allowed(rule: dict, buyer: dict, applied_count: int) -> None:
    """Optional per-buyer guardrail. For MVP we only enforce `max_per_buyer`
    based on the count passed in; full per-buyer history requires a separate
    `promo_code_uses` collection (deferred)."""
    cond = rule.get("conditions") or {}
    cap = cond.get("max_per_buyer")
    if cap and applied_count > int(cap):
        raise HTTPException(
            422, f"Este código permite hasta {cap} usos por comprador.",
        )
