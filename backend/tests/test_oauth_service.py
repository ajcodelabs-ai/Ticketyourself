"""Unit tests for social login helpers."""

import pytest
from fastapi import HTTPException

from services.oauth import (
    display_name_from_social,
    enabled_social_providers,
    verify_social_token,
)


def test_enabled_providers_empty(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    monkeypatch.delenv("APPLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("APPLE_SERVICE_ID", raising=False)
    assert enabled_social_providers() == []


def test_enabled_providers_google(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "abc.apps.googleusercontent.com")
    monkeypatch.delenv("APPLE_CLIENT_ID", raising=False)
    monkeypatch.delenv("APPLE_SERVICE_ID", raising=False)
    monkeypatch.delenv("GOOGLE_OAUTH_CLIENT_ID", raising=False)
    providers = enabled_social_providers()
    assert providers == [
        {"id": "google", "client_id": "abc.apps.googleusercontent.com"}
    ]


def test_display_name_from_social():
    assert display_name_from_social("Ada Lovelace", "ada@x.com") == "Ada Lovelace"
    assert display_name_from_social("", "ada.lovelace@x.com") == "ada lovelace"
    assert display_name_from_social("", "ada@x.com", extra_name="Ada") == "Ada"


def test_unknown_provider():
    with pytest.raises(HTTPException) as exc:
        verify_social_token("facebook", "x" * 40)
    assert exc.value.status_code == 400


def test_verify_google_dispatches(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid")
    monkeypatch.setattr(
        "services.oauth._verify_google",
        lambda token: {"subject": "gid-1", "email": "ada@x.com", "name": "Ada"},
    )
    info = verify_social_token("google", "id-token")
    assert info["email"] == "ada@x.com"
    assert info["subject"] == "gid-1"
    assert info["name"] == "Ada"
