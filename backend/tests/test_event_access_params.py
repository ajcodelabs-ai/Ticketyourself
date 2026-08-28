from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from routers.events import EventAccessParams, _normalize_ticket_delivery_mode


def test_normalize_delivery_mode_drops_manual():
    assert _normalize_ticket_delivery_mode("manual") == "al_momento"
    assert _normalize_ticket_delivery_mode("al_momento") == "al_momento"
    assert _normalize_ticket_delivery_mode("horas_antes") == "horas_antes"
    assert _normalize_ticket_delivery_mode(None) is None


def test_access_params_ignores_refund_window():
    ap = EventAccessParams.model_validate(
        {"max_per_purchase": 5, "refund_window_hours": 48}
    )
    dumped = ap.model_dump()
    assert "refund_window_hours" not in dumped
    assert dumped["max_per_purchase"] == 5
    assert dumped["show_buyer_name_on_ticket"] is True
