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
    """Restores a historical snapshot onto `row`.

    Re-runs the same sanitizers the normal PUT path applies — a revision
    saved before those sanitizers existed (or via any older code path) could
    carry raw HTML/hrefs, and restoring it must not reintroduce them.
    """
    from services.microsite_blocks import safe_href, sanitize_html, validate_blocks
    from services.microsite_seo import validate_custom_css

    row.template = snapshot.get("template")

    branding = dict(snapshot.get("branding") or {})
    try:
        branding["custom_css"] = validate_custom_css(branding.get("custom_css"))
    except ValueError:
        branding["custom_css"] = ""
    row.branding = branding

    content = dict(snapshot.get("content") or {})
    if "about_body_html" in content:
        content["about_body_html"] = sanitize_html(content.get("about_body_html"))
    if "hero_cta_href" in content:
        content["hero_cta_href"] = safe_href(content.get("hero_cta_href"))
    row.content = content

    row.social_links = dict(snapshot.get("social_links") or {})
    row.sections_enabled = dict(snapshot.get("sections_enabled") or {})
    try:
        row.blocks = validate_blocks(list(snapshot.get("blocks") or []))
    except ValueError:
        row.blocks = []
    row.seo = dict(snapshot.get("seo") or {})
