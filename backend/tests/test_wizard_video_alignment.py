"""Unit tests for TicketShow-aligned wizard pricing / access helpers."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest
from fastapi import HTTPException

from routers.events import CustomQuestion, LocalityPriceIn
from services.order_service import (
    compute_totals_with_seats,
    locality_fee_cents,
    locality_pricing_has_charge,
    locality_pricing_map,
)
from services.sales_fees import FALLBACK_PERCENT


def test_locality_price_in_includes_fees():
    lp = LocalityPriceIn(
        locality_id="loc-1",
        price_cents=2500,
        service_fee_cents=100,
        admin_fee_cents=50,
    )
    dumped = lp.model_dump()
    assert dumped["service_fee_cents"] == 100
    assert dumped["admin_fee_cents"] == 50
    assert dumped["price_cents"] == 2500


def test_custom_question_number_and_locality_ids():
    q = CustomQuestion(
        label="Edad",
        type="number",
        required=True,
        locality_ids=["vip", "general"],
    )
    assert q.type == "number"
    assert q.locality_ids == ["vip", "general"]


def test_custom_question_select_still_requires_options():
    with pytest.raises(ValueError):
        CustomQuestion(label="Talla", type="select", required=True)


def test_compute_totals_with_seats_fees_on_entrada_only():
    event = {
        "locality_pricing": [
            {
                "locality_id": "A",
                "price_cents": 1000,
                "service_fee_cents": 200,
                "admin_fee_cents": 100,
            },
            {
                "locality_id": "B",
                "price_cents": 2000,
                "service_fee_cents": 0,
                "admin_fee_cents": 0,
            },
        ]
    }
    venue = {"elements": []}
    from services import seats as seats_mod

    original = seats_mod.seats_by_id

    def fake_seats_by_id(_venue):
        return {
            "s1": {"seat_id": "s1", "locality_id": "A"},
            "s2": {"seat_id": "s2", "locality_id": "B"},
        }

    seats_mod.seats_by_id = fake_seats_by_id
    try:
        totals = compute_totals_with_seats(
            event=event,
            venue=venue,
            seat_ids=["s1", "s2"],
        )
    finally:
        seats_mod.seats_by_id = original

    assert totals["entrada_cents"] == 3000
    assert totals["service_fee_cents"] == 200
    assert totals["admin_fee_cents"] == 100
    assert totals["subtotal_cents"] == 3300
    expected_fees = int(round(3000 * FALLBACK_PERCENT / 100))
    assert totals["fees_cents"] == expected_fees
    assert totals["total_cents"] == 3300 + expected_fees


def test_compute_totals_with_seats_zeroes_charges_on_free_event():
    """TI-121 defense in depth: even if a charge slipped into locality_pricing
    through some write path this fix doesn't cover, a Gratuito event must
    never actually bill the buyer at checkout."""
    event = {
        "pricing_type": "free",
        "locality_pricing": [
            {
                "locality_id": "A",
                "price_cents": 1000,
                "service_fee_cents": 200,
                "admin_fee_cents": 100,
                "vxs_cents": 50,
                "wallet_fee_cents": 25,
            },
        ],
    }
    venue = {"elements": []}
    from services import seats as seats_mod

    original = seats_mod.seats_by_id
    seats_mod.seats_by_id = lambda _v: {"s1": {"seat_id": "s1", "locality_id": "A"}}
    try:
        totals = compute_totals_with_seats(event=event, venue=venue, seat_ids=["s1"])
    finally:
        seats_mod.seats_by_id = original

    for key in (
        "unit_price_cents",
        "subtotal_cents",
        "entrada_cents",
        "service_fee_cents",
        "admin_fee_cents",
        "vxs_cents",
        "wallet_fee_cents",
        "fees_cents",
        "total_cents",
    ):
        assert totals[key] == 0, f"{key} should be 0 on a free event"


def test_compute_totals_with_seats_missing_seat_raises():
    event = {"locality_pricing": [{"locality_id": "A", "price_cents": 1000}]}
    venue = {"elements": []}
    from services import seats as seats_mod

    original = seats_mod.seats_by_id
    seats_mod.seats_by_id = lambda _v: {}
    try:
        with pytest.raises(HTTPException):
            compute_totals_with_seats(event=event, venue=venue, seat_ids=["missing"])
    finally:
        seats_mod.seats_by_id = original


def test_locality_fee_cents_applies_to_ticket_type_bound_to_locality():
    """A TicketType with venue_locality_id set must pick up the same
    service/admin fees configured on locality_pricing — used by the GA
    ticket_type_selections purchase path in routers/orders.py, not just by
    compute_totals_with_seats's per-seat path."""
    event = {
        "locality_pricing": [
            {
                "locality_id": "vip",
                "price_cents": 5000,
                "service_fee_cents": 300,
                "admin_fee_cents": 150,
            },
        ]
    }
    pricing_map = locality_pricing_map(event)
    service, admin = locality_fee_cents(pricing_map, "vip")
    assert (service, admin) == (300, 150)


def test_locality_fee_cents_zero_for_ticket_type_without_locality():
    event = {
        "locality_pricing": [
            {"locality_id": "vip", "price_cents": 5000, "service_fee_cents": 300}
        ]
    }
    pricing_map = locality_pricing_map(event)
    assert locality_fee_cents(pricing_map, None) == (0, 0)
    assert locality_fee_cents(pricing_map, "unknown-locality") == (0, 0)


class TestLocalityPricingHasCharge:
    """TI-121: a Gratuito event must never bill the buyer anything — price
    or any fee field — so this predicate must catch every charge-bearing
    field, not just price_cents."""

    def test_all_zero_has_no_charge(self):
        assert not locality_pricing_has_charge(
            [{"locality_id": "vip", "price_cents": 0}]
        )

    def test_empty_or_missing_has_no_charge(self):
        assert not locality_pricing_has_charge([])
        assert not locality_pricing_has_charge(None)

    def test_positive_price_is_a_charge(self):
        assert locality_pricing_has_charge(
            [{"locality_id": "vip", "price_cents": 2500}]
        )

    def test_zero_price_but_positive_fee_is_still_a_charge(self):
        for field in (
            "service_fee_cents",
            "admin_fee_cents",
            "vxs_cents",
            "wallet_fee_cents",
        ):
            assert locality_pricing_has_charge(
                [{"locality_id": "vip", "price_cents": 0, field: 100}]
            ), f"{field} should count as a charge"

    def test_accepts_pydantic_models_not_just_dicts(self):
        lp = LocalityPriceIn(locality_id="vip", price_cents=0, admin_fee_cents=50)
        assert locality_pricing_has_charge([lp])
