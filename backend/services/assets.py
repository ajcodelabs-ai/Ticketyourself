"""Resolve `/api/events/assets/{id}` URLs back to file bytes on disk.

Used by the ticket-design PDF renderer to draw organizer-uploaded
backgrounds/logos, which are referenced by API URL (so the same value also
works as an <img src> in the browser-side designer canvas).
"""
from __future__ import annotations

import io
from pathlib import Path

ASSETS_DIR = Path(__file__).resolve().parent.parent / "event_assets"


async def open_event_asset(url: str) -> io.BytesIO | None:
    asset_id = (url or "").rstrip("/").rsplit("/", 1)[-1]
    if not asset_id:
        return None
    from database import AsyncSessionLocal
    from orm_models import EventAsset
    from sqlalchemy import select

    async with AsyncSessionLocal() as session:
        row = await session.scalar(select(EventAsset).where(EventAsset.id == asset_id))
    if not row:
        return None
    abs_path = ASSETS_DIR / row.file_path
    if not abs_path.exists():
        return None
    return io.BytesIO(abs_path.read_bytes())
