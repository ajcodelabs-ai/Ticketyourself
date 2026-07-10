"""Microsite revision snapshots — save/restore/prune history."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from orm_models import Microsite, MicrositeRevision

MAX_REVISIONS = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def build_snapshot(row: Microsite) -> dict:
    return {
        "template": row.template,
        "branding": dict(row.branding or {}),
        "content": dict(row.content or {}),
        "social_links": dict(row.social_links or {}),
        "sections_enabled": dict(row.sections_enabled or {}),
        "blocks": list(row.blocks or []),
        "seo": dict(row.seo or {}),
    }


async def create_revision(
    session: AsyncSession,
    *,
    microsite_id: str,
    snapshot: dict,
    label: str | None = None,
) -> MicrositeRevision:
    rev = MicrositeRevision(
        id=str(uuid.uuid4()),
        microsite_id=microsite_id,
        label=label,
        snapshot=snapshot,
        created_at=_now(),
    )
    session.add(rev)
    await session.flush()
    await _prune_old_revisions(session, microsite_id)
    return rev


async def _prune_old_revisions(session: AsyncSession, microsite_id: str) -> None:
    result = await session.execute(
        select(MicrositeRevision.id)
        .where(MicrositeRevision.microsite_id == microsite_id)
        .order_by(MicrositeRevision.created_at.desc())
    )
    ids = [row[0] for row in result.all()]
    if len(ids) <= MAX_REVISIONS:
        return
    to_delete = ids[MAX_REVISIONS:]
    await session.execute(
        delete(MicrositeRevision).where(MicrositeRevision.id.in_(to_delete))
    )


def apply_snapshot(row: Microsite, snapshot: dict) -> None:
    row.template = snapshot.get("template")
    row.branding = dict(snapshot.get("branding") or {})
    row.content = dict(snapshot.get("content") or {})
    row.social_links = dict(snapshot.get("social_links") or {})
    row.sections_enabled = dict(snapshot.get("sections_enabled") or {})
    row.blocks = list(snapshot.get("blocks") or [])
    row.seo = dict(snapshot.get("seo") or {})
