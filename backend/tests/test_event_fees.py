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


def test_fee_session_id_strips_hyphens():
    from services.event_fees import fee_session_id

    assert fee_session_id("abc-def-123") == "pefabcdef123"


def test_platform_switch_off_waives_even_if_plan_enabled():
    out = calculate_pre_event_fee(
        plan={
            "event_fee_enabled": True,
            "event_fee_per_ticket_cents": 10,
            "event_fee_percent_bps": 100,
        },
        event={},
        ticket_types=[{"quantity": 100, "price_cents": 2000}],
        platform_required=False,
    )
    assert out["enabled"] is False
    assert out["fee_cents"] == 0
    assert out["status"] == "waived"
    assert out["platform_required"] is False
