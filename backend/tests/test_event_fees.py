"""Unit tests for pre-event fee calculator."""

from services.event_fees import calculate_pre_event_fee


def test_fee_disabled_waived():
    out = calculate_pre_event_fee(
        plan={"event_fee_enabled": False},
        event={},
        ticket_types=[{"quantity": 100, "price_cents": 2000}],
    )
    assert out["fee_cents"] == 0
    assert out["status"] == "waived"


def test_fee_per_ticket_and_percent():
    out = calculate_pre_event_fee(
        plan={
            "event_fee_enabled": True,
            "event_fee_per_ticket_cents": 10,
            "event_fee_percent_bps": 100,  # 1%
        },
        event={},
        ticket_types=[{"quantity": 100, "price_cents": 2000}],  # GMV 200_000
    )
    # 100*10 + 1% of 200000 = 1000 + 2000 = 3000
    assert out["fee_cents"] == 3000
    assert out["ticket_units"] == 100
    assert out["estimated_gmv_cents"] == 200_000
