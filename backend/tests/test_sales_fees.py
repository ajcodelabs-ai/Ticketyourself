"""Unit tests for sales commission matching (plan × type × price range)."""

from services.sales_fees import (
    apply_platform_fee,
    fee_cents_for_price,
    find_overlapping_rule,
    match_rule,
    quote_one,
    ranges_overlap,
    resolve_platform_fee,
)

RULES = [
    {
        "id": "r1",
        "plan_code": "profesional",
        "pricing_type": "paid",
        "min_price_cents": 0,
        "max_price_cents": 1999,
        "fee_mode": "percent",
        "fee_fixed_cents": 0,
        "fee_percent_bps": 400,  # 4%
        "active": True,
    },
    {
        "id": "r2",
        "plan_code": "profesional",
        "pricing_type": "paid",
        "min_price_cents": 2000,
        "max_price_cents": None,
        "fee_mode": "percent",
        "fee_fixed_cents": 0,
        "fee_percent_bps": 250,  # 2.5%
        "active": True,
    },
    {
        "id": "r3",
        "plan_code": "basico",
        "pricing_type": "paid",
        "min_price_cents": 0,
        "max_price_cents": None,
        "fee_mode": "fixed",
        "fee_fixed_cents": 50,
        "fee_percent_bps": 0,
        "active": True,
    },
]


def test_match_picks_range_for_plan_and_type():
    low = match_rule(
        RULES, plan_code="profesional", pricing_type="paid", price_cents=1500
    )
    high = match_rule(
        RULES, plan_code="profesional", pricing_type="paid", price_cents=5000
    )
    assert low["id"] == "r1"
    assert high["id"] == "r2"


def test_no_match_other_plan():
    assert (
        match_rule(RULES, plan_code="enterprise", pricing_type="paid", price_cents=1500)
        is None
    )


def test_fee_percent_only():
    # 4% of $15.00 = 60; the unused fixed field must not add
    assert fee_cents_for_price(1500, RULES[0]) == 60


def test_fee_fixed_only_ignores_price():
    assert fee_cents_for_price(9999, RULES[2]) == 50


def test_legacy_both_fields_uses_percent_not_sum():
    assert (
        fee_cents_for_price(
            1000,
            {"fee_fixed_cents": 20, "fee_percent_bps": 400},
        )
        == 40
    )


def test_quote_fallback_paid_without_rule():
    q = quote_one(
        rules=RULES,
        plan_code="enterprise",
        pricing_type="paid",
        price_cents=2000,
    )
    assert q["matched"] is False
    assert q["fallback"] is True
    assert q["fee_cents"] == 100  # 5% of 2000


def test_quote_free_unmatched_is_zero():
    q = quote_one(
        rules=[],
        plan_code="profesional",
        pricing_type="free",
        price_cents=0,
    )
    assert q["fee_cents"] == 0
    assert q["fallback"] is False


def test_buyer_pays_adds_to_total():
    totals = apply_platform_fee(
        {"subtotal_cents": 1500},
        event={"pricing_type": "paid", "platform_fee_bearer": "buyer"},
        unit_prices=[1500],
        sales_fee_rules=RULES,
        plan_code="profesional",
    )
    assert totals["fees_cents"] == 60
    assert totals["total_cents"] == 1560
    assert totals["platform_fee_bearer"] == "buyer"


def test_organizer_absorbs_keeps_buyer_total():
    info = resolve_platform_fee(
        event={"pricing_type": "paid", "platform_fee_bearer": "organizer"},
        unit_prices=[1500, 1500],
        sales_fee_rules=RULES,
        plan_code="profesional",
    )
    assert info["fees_cents"] == 120
    assert info["buyer_fee_cents"] == 0
    totals = apply_platform_fee(
        {"subtotal_cents": 3000},
        event={"pricing_type": "paid", "platform_fee_bearer": "organizer"},
        unit_prices=[1500, 1500],
        sales_fee_rules=RULES,
        plan_code="profesional",
    )
    assert totals["total_cents"] == 3000
    assert totals["fees_cents"] == 120


def test_overlap_detection():
    assert ranges_overlap(0, 1999, 1500, 3000)
    assert not ranges_overlap(0, 1999, 2000, None)
    hit = find_overlapping_rule(
        RULES,
        plan_code="profesional",
        pricing_type="paid",
        min_price_cents=1800,
        max_price_cents=2500,
    )
    assert hit["id"] == "r1"
