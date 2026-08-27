"""Guards so startup seeds never wipe production data."""

from __future__ import annotations

import pytest

from seeds import demo_seed_enabled, env_name, is_production_env


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
