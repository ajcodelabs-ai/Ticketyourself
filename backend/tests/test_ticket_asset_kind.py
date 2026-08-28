from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from routers.events import _ticket_asset_kind


def test_ticket_asset_kinds_fit_legacy_varchar20():
    for slot in ("main", "courtesy"):
        for role in ("background", "logo"):
            kind = _ticket_asset_kind(slot, role)
            assert kind.startswith("td_")
            assert len(kind) <= 20, kind


def test_ticket_asset_kinds_are_distinct():
    kinds = {
        _ticket_asset_kind(slot, role)
        for slot in ("main", "courtesy")
        for role in ("background", "logo")
    }
    assert len(kinds) == 4
