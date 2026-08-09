"""Unit tests for PRD §4.2.2 access_control helpers."""

from __future__ import annotations

import asyncio
import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://localhost:5432/test")
os.environ.setdefault("JWT_SECRET", "test-secret")

import pytest

from services.access_control import check_purchase_access


def _run(coro):
    return asyncio.run(coro)


def test_access_code_required_by_default():
    session = MagicMock()
    session.scalar = AsyncMock(return_value=None)
    event = {"id": "e1", "access_params": {"access_type": "access_code"}}
    with pytest.raises(ValueError, match="código de acceso"):
        _run(
            check_purchase_access(
                event=event,
                session=session,
                buyer_email="a@b.com",
                buyer_document_id=None,
                access_code=None,
            )
        )


def test_access_code_can_continue_without_code():
    session = MagicMock()
    event = {
        "id": "e1",
        "access_params": {
            "access_type": "access_code",
            "allow_continue_without_code": True,
        },
    }
    result = _run(
        check_purchase_access(
            event=event,
            session=session,
            buyer_email="a@b.com",
            buyer_document_id=None,
            access_code=None,
        )
    )
    assert result is None


def test_access_code_validated_when_provided_even_if_optional():
    match = SimpleNamespace(
        id="code-1",
        max_uses=10,
        uses_count=0,
        max_tickets_per_redemption=None,
    )
    session = MagicMock()
    session.scalar = AsyncMock(return_value=match)
    event = {
        "id": "e1",
        "access_params": {
            "access_type": "access_code",
            "allow_continue_without_code": True,
        },
    }
    result = _run(
        check_purchase_access(
            event=event,
            session=session,
            buyer_email="a@b.com",
            buyer_document_id=None,
            access_code="VIP",
        )
    )
    assert result == "code-1"


def test_link_only_treated_as_open():
    session = MagicMock()
    event = {"id": "e1", "access_params": {"access_type": "link_only"}}
    result = _run(
        check_purchase_access(
            event=event,
            session=session,
            buyer_email="a@b.com",
            buyer_document_id=None,
            access_code=None,
        )
    )
    assert result is None
