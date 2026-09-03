"""Unit tests for Verificante KYC helpers."""

import os
from unittest.mock import AsyncMock, patch

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import asyncio  # noqa: E402

import httpx  # noqa: E402

from services.verificante_service import (  # noqa: E402
    applies_to,
    apply_webhook_data,
    extract_cedula,
    failed_record,
    is_admitted,
    mock_enabled,
    normalize_risk_level,
    record_from_api_item,
    start_check,
    verify_webhook_signature,
)

CEDULA = "1710034065"
NATURAL_RUC = "1710034065001"


def test_applies_only_ec_individual():
    assert applies_to("EC", "individual") is True
    assert applies_to("ec", "INDIVIDUAL") is True
    assert applies_to("EC", "company") is False
    assert applies_to("CO", "individual") is False


def test_extract_cedula_from_ruc_natural():
    assert extract_cedula(CEDULA) == CEDULA
    assert extract_cedula(NATURAL_RUC) == CEDULA
    assert extract_cedula("17.100.340-65") == CEDULA
    assert extract_cedula("123") is None


def test_normalize_risk_level_case_insensitive():
    assert normalize_risk_level("low") == "LOW"
    assert normalize_risk_level("LOW") == "LOW"
    assert normalize_risk_level("medium") == "MEDIUM"
    assert normalize_risk_level("HIGH") == "HIGH"
    assert is_admitted("low") is True
    assert is_admitted("HIGH") is False
    assert is_admitted(None) is False


def test_mock_disabled_in_production(monkeypatch):
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("VERIFICANTE_MOCK", "true")
    assert mock_enabled() is False


def test_hmac_matches_official_formula(monkeypatch):
    monkeypatch.setenv("VERIFICANTE_WEBHOOK_SECRET", "super-secret")
    body = b'{"id":"evt_1"}'
    ts = "1700000000"
    import hashlib
    import hmac

    expected = (
        "v1="
        + hmac.new(
            b"super-secret",
            ts.encode() + b"." + body,
            hashlib.sha256,
        ).hexdigest()
    )
    assert verify_webhook_signature(
        body, timestamp=ts, signature=expected, now=1700000000
    )
    assert not verify_webhook_signature(
        body, timestamp=ts, signature="v1=deadbeef", now=1700000000
    )
    assert not verify_webhook_signature(
        body, timestamp=ts, signature=expected, now=1700000000 + 400
    )


def test_hmac_skipped_when_no_secret(monkeypatch):
    monkeypatch.delenv("VERIFICANTE_WEBHOOK_SECRET", raising=False)
    assert verify_webhook_signature(b"{}", timestamp=None, signature=None) is True


def test_apply_webhook_sets_low_without_touching_org_status():
    merged = apply_webhook_data(
        {"status": "pending", "candidate_id": "org-1"},
        {
            "id": "evt_xxx",
            "type": "verificationCompleted",
            "data": {
                "verificationId": "uuid-1",
                "status": "completed",
                "riskLevel": "LOW",
                "pdfUrl": "https://example.com/r.pdf",
                "verification": {
                    "id": "uuid-1",
                    "person": {"names": "Jane Doe", "identification": CEDULA},
                },
            },
        },
    )
    assert merged["status"] == "completed"
    assert merged["risk_level"] == "LOW"
    assert merged["admitted"] is True
    assert merged["pdf_url"] == "https://example.com/r.pdf"
    assert merged["identification"] == CEDULA
    assert merged["webhook_event_id"] == "evt_xxx"
    assert "organizers.status" not in merged


def test_record_from_api_pending():
    rec = record_from_api_item(
        {"id": "vf-1", "state": "pending"},
        identification=CEDULA,
        organizer_id="org-1",
    )
    assert rec["status"] == "pending"
    assert rec["admitted"] is False
    assert rec["verification_id"] == "vf-1"


def test_failed_record_shape():
    rec = failed_record(identification=CEDULA, organizer_id="o", error="timeout")
    assert rec["status"] == "failed"
    assert rec["applicable"] is True
    assert rec["admitted"] is False


def test_start_check_mock(monkeypatch):
    monkeypatch.setenv("ENV", "development_local")
    monkeypatch.setenv("VERIFICANTE_MOCK", "true")
    rec = asyncio.run(
        start_check(
            organizer_id="org-1",
            legal_id=NATURAL_RUC,
            names="Ana Pérez",
        )
    )
    assert rec["status"] == "completed"
    assert rec["risk_level"] == "LOW"
    assert rec["admitted"] is True
    assert rec["mock"] is True
    assert rec["identification"] == CEDULA


def test_start_check_skipped_without_key(monkeypatch):
    monkeypatch.setenv("ENV", "development_local")
    monkeypatch.setenv("VERIFICANTE_MOCK", "false")
    monkeypatch.delenv("VERIFICANTE_API_KEY", raising=False)
    rec = asyncio.run(
        start_check(
            organizer_id="org-1",
            legal_id=CEDULA,
            names="Ana Pérez",
        )
    )
    assert rec["status"] == "skipped"
    assert rec["error"] == "not_configured"


def test_start_check_http_pending(monkeypatch):
    monkeypatch.setenv("ENV", "development_local")
    monkeypatch.setenv("VERIFICANTE_MOCK", "false")
    monkeypatch.setenv("VERIFICANTE_API_KEY", "test-key")

    async def fake_create(**kwargs):
        return {"id": "vf-99", "state": "pending"}

    with patch(
        "services.verificante_service._create_request",
        new=AsyncMock(side_effect=fake_create),
    ):
        rec = asyncio.run(
            start_check(
                organizer_id="org-1",
                legal_id=CEDULA,
                names="Ana Pérez",
            )
        )
    assert rec["status"] == "pending"
    assert rec["verification_id"] == "vf-99"
    assert rec["admitted"] is False


def test_start_check_http_error_does_not_raise(monkeypatch):
    monkeypatch.setenv("ENV", "development_local")
    monkeypatch.setenv("VERIFICANTE_MOCK", "false")
    monkeypatch.setenv("VERIFICANTE_API_KEY", "test-key")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(502, text="bad gateway")

    async def _run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await start_check(
                organizer_id="org-1",
                legal_id=CEDULA,
                names="Ana Pérez",
                client=client,
            )

    rec = asyncio.run(_run())
    assert rec["status"] == "failed"
    assert rec["admitted"] is False
