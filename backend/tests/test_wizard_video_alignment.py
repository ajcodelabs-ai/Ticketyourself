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
    locality_pricing_map,
    DEFAULT_FEE_PERCENT,
)


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
            event=event, venue=venue, seat_ids=["s1", "s2"],
        )
    finally:
        seats_mod.seats_by_id = original

    assert totals["entrada_cents"] == 3000
    assert totals["service_fee_cents"] == 200
    assert totals["admin_fee_cents"] == 100
    assert totals["subtotal_cents"] == 3300
    expected_fees = int(round(3000 * DEFAULT_FEE_PERCENT / 100))
    assert totals["fees_cents"] == expected_fees
    assert totals["total_cents"] == 3300 + expected_fees


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
            {"locality_id": "vip", "price_cents": 5000, "service_fee_cents": 300, "admin_fee_cents": 150},
        ]
    }
    pricing_map = locality_pricing_map(event)
    service, admin = locality_fee_cents(pricing_map, "vip")
    assert (service, admin) == (300, 150)


def test_locality_fee_cents_zero_for_ticket_type_without_locality():
    event = {"locality_pricing": [{"locality_id": "vip", "price_cents": 5000, "service_fee_cents": 300}]}
    pricing_map = locality_pricing_map(event)
    assert locality_fee_cents(pricing_map, None) == (0, 0)
    assert locality_fee_cents(pricing_map, "unknown-locality") == (0, 0)
