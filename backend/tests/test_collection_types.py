"""PRD §4.2.1 collection-type totals."""

from __future__ import annotations

import os
import sys
import types

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

# order_service imports stripe at module level; stub for unit runs without deps.
if "stripe" not in sys.modules:
    _stripe = types.ModuleType("stripe")
    _stripe.error = types.SimpleNamespace(StripeError=Exception)
    sys.modules["stripe"] = _stripe

import pytest
from fastapi import HTTPException

from services.order_service import compute_totals


def test_free_without_donation_is_zero():
    totals = compute_totals(event={"pricing_type": "free"}, quantity=2)
    assert totals["total_cents"] == 0
    assert totals["donation_amount_cents"] == 0


def test_free_optional_donation_requires_flag():
    with pytest.raises(HTTPException):
        compute_totals(
            event={"pricing_type": "free"},
            quantity=1,
            donation_amount_cents=500,
        )


def test_free_optional_donation_accepted():
    totals = compute_totals(
        event={"pricing_type": "free", "optional_donation_enabled": True},
        quantity=1,
        donation_amount_cents=500,
    )
    assert totals["total_cents"] == 500
    assert totals["donation_amount_cents"] == 500


def test_paid_includes_prd_ticket_fees():
    event = {
        "pricing_type": "paid",
        "base_price_cents": 1000,
        "ticket_fees": {
            "service_fee_cents": 100,
            "ticketseguro_cents": 50,
            "tax_cents": 20,
            "wallet_fee_cents": 30,
        },
    }
    totals = compute_totals(event=event, quantity=2)
    # (1000+100+50+20+30)*2 = 2400
    assert totals["subtotal_cents"] == 2400
    assert totals["service_fee_cents"] == 200
    assert totals["ticketseguro_cents"] == 100
    assert totals["tax_cents"] == 40
    assert totals["wallet_fee_cents"] == 60
    assert totals["fees_cents"] == int(round(2000 * 5 / 100))
    assert totals["total_cents"] == 2400 + totals["fees_cents"]


def test_donation_minimum():
    with pytest.raises(HTTPException):
        compute_totals(
            event={"pricing_type": "donation"},
            quantity=1,
            donation_amount_cents=50,
        )
