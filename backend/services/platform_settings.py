"""Platform-wide flags editable by superadmin."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import PlatformSetting

KEY_PRE_EVENT_FEE_REQUIRED = "pre_event_fee_required"


def _truthy(value: Any) -> bool:
    if isinstance(value, dict):
        return bool(value.get("enabled"))
    return bool(value)


async def is_pre_event_fee_required(session: AsyncSession) -> bool:
    """Master switch: if false, organizers publish without a platform fee."""
    row = await session.get(PlatformSetting, KEY_PRE_EVENT_FEE_REQUIRED)
    if row is None:
        return False
    return _truthy(row.value)


async def set_pre_event_fee_required(
    session: AsyncSession, *, enabled: bool, admin_id: str
) -> bool:
    now = datetime.now(timezone.utc)
    row = await session.get(PlatformSetting, KEY_PRE_EVENT_FEE_REQUIRED)
    payload = {"enabled": bool(enabled)}
    if row is None:
        session.add(
            PlatformSetting(
                key=KEY_PRE_EVENT_FEE_REQUIRED,
                value=payload,
                updated_at=now,
                updated_by=admin_id,
            )
        )
    else:
        row.value = payload
        row.updated_at = now
        row.updated_by = admin_id
        from sqlalchemy.orm.attributes import flag_modified

        flag_modified(row, "value")
    await session.flush()
    return bool(enabled)


async def get_platform_settings(session: AsyncSession) -> dict[str, bool]:
    return {
        "pre_event_fee_required": await is_pre_event_fee_required(session),
    }
