"""Unit tests for Resend sender resolution and send_email routing."""

import asyncio
import os

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

from services import email_service as svc  # noqa: E402


def test_sender_uses_email_from_not_resend_dev(monkeypatch):
    monkeypatch.setenv("EMAIL_FROM", "noreply@mail.ajcodelabs.ai")
    monkeypatch.delenv("SENDER_EMAIL", raising=False)
    monkeypatch.delenv("EMAIL_FROM_NAME", raising=False)
    assert svc._sender() == "Ticket Yourself <noreply@mail.ajcodelabs.ai>"


def test_sender_keeps_friendly_name(monkeypatch):
    monkeypatch.setenv("EMAIL_FROM", "TYS <hola@mail.ajcodelabs.ai>")
    assert svc._sender() == "TYS <hola@mail.ajcodelabs.ai>"


def test_sender_falls_back_to_onboarding_without_env(monkeypatch):
    monkeypatch.delenv("EMAIL_FROM", raising=False)
    monkeypatch.delenv("SENDER_EMAIL", raising=False)
    assert svc._sender() == "onboarding@resend.dev"


def test_send_email_passes_verified_from_to_resend(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.setenv("EMAIL_FROM", "noreply@mail.ajcodelabs.ai")
    monkeypatch.delenv("EMAIL_FROM_NAME", raising=False)
    captured = {}

    def fake_send(params):
        captured.update(params)
        return {"id": "email_123"}

    monkeypatch.setattr(svc.resend.Emails, "send", fake_send)
    result = asyncio.run(
        svc.send_email(to="buyer@example.com", subject="Hola", html="<p>x</p>")
    )
    assert result == {"id": "email_123"}
    assert captured["from"] == "Ticket Yourself <noreply@mail.ajcodelabs.ai>"
    assert captured["to"] == ["buyer@example.com"]
    assert captured["subject"] == "Hola"


def test_send_email_logs_error_without_raising(monkeypatch):
    monkeypatch.setenv("RESEND_API_KEY", "re_test_key")
    monkeypatch.setenv("EMAIL_FROM", "noreply@mail.ajcodelabs.ai")

    def boom(_params):
        raise RuntimeError("domain not verified")

    monkeypatch.setattr(svc.resend.Emails, "send", boom)
    result = asyncio.run(
        svc.send_email(to="buyer@example.com", subject="Hola", html="<p>x</p>")
    )
    assert result["id"] == ""
    assert "domain not verified" in result["error"]
