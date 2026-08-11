"""Unit tests for payment method catalog helpers."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from services.payment_methods import (
    accepts_payment_method,
    default_payment_methods,
    normalize_payment_methods,
    resolve_enabled_codes,
)


def test_resolve_enabled_codes_prefers_list():
    assert resolve_enabled_codes({"enabled_codes": ["nuvei", "cash"]}) == [
        "nuvei",
        "cash",
    ]


def test_resolve_enabled_codes_legacy_flags():
    assert resolve_enabled_codes(
        {
            "stripe": {"enabled": True},
            "transfer": {"enabled": True},
            "cash": {"enabled": False},
        }
    ) == ["stripe", "transfer"]


def test_normalize_defaults_to_nuvei():
    out = default_payment_methods()
    assert out["enabled_codes"] == ["nuvei"]
    assert out["transfer"]["enabled"] is False


def test_normalize_syncs_manual_flags():
    out = normalize_payment_methods(
        {
            "enabled_codes": ["transfer", "cash"],
            "transfer": {"bank_name": "Pichincha"},
            "cash": {"location": "Oficina"},
        },
        allowed_codes={"nuvei", "deuna", "stripe", "paypal", "transfer", "cash"},
    )
    assert out["transfer"]["enabled"] is True
    assert out["cash"]["enabled"] is True
    assert out["transfer"]["bank_name"] == "Pichincha"
    assert out["stripe"]["enabled"] is False


def test_normalize_rejects_unknown_code():
    try:
        normalize_payment_methods(
            {"enabled_codes": ["bitcoin"]},
            allowed_codes={"nuvei", "deuna", "transfer", "cash"},
        )
        assert False, "expected ValueError"
    except ValueError as exc:
        assert "bitcoin" in str(exc)


def test_accepts_payment_method():
    event = {"payment_methods": {"enabled_codes": ["deuna", "transfer"]}}
    assert accepts_payment_method(event, "deuna") is True
    assert accepts_payment_method(event, "nuvei") is False
    assert accepts_payment_method(event, "season_pass") is True
