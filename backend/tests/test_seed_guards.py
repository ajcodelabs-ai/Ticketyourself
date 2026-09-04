"""Guards so startup seeds never wipe production data."""

from __future__ import annotations

import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest

from seeds import (
    _preserve_custom_einvoice_config,
    demo_seed_enabled,
    env_name,
    is_production_env,
)


@pytest.mark.parametrize(
    "env,flag,expected",
    [
        ("production", None, False),
        ("production", "true", True),
        ("production", "false", False),
        ("staging", None, False),
        ("staging", "1", True),
        ("development_local", None, True),
        ("development", None, True),
        ("development_local", "false", False),
        ("preview", None, True),
        ("test", None, True),
    ],
)
def test_demo_seed_enabled(monkeypatch, env, flag, expected):
    monkeypatch.setenv("ENV", env)
    if flag is None:
        monkeypatch.delenv("SEED_DEMO_DATA", raising=False)
    else:
        monkeypatch.setenv("SEED_DEMO_DATA", flag)
    assert demo_seed_enabled() is expected


def test_production_env_name(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    assert env_name() == "production"
    assert is_production_env() is True


def test_preserve_custom_einvoice_ruc():
    demo = "1790012345001"
    assert _preserve_custom_einvoice_config({"ruc": "0992547545001"}, demo) is True
    assert _preserve_custom_einvoice_config({"ruc": demo}, demo) is False
    assert _preserve_custom_einvoice_config({}, demo) is False
    assert _preserve_custom_einvoice_config(None, demo) is False
