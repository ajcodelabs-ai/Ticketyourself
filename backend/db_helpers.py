"""Utilities shared across the MongoDB→PostgreSQL migration."""
from sqlalchemy import inspect as sa_inspect


def row_to_dict(obj) -> dict:
    """Convert a SQLAlchemy ORM row to a plain dict (for Pydantic parsing).

    Uses the database column name as the dict key so reserved Python names
    (e.g. metadata_) still serialize as \"metadata\" in API payloads.
    """
    out: dict = {}
    for attr in sa_inspect(obj).mapper.column_attrs:
        col = attr.columns[0]
        out[col.name] = getattr(obj, attr.key)
    return out


def organizer_row_to_dict(row) -> dict:
    """Convert Organizer ORM row to a plain dict including admin_comments.

    admin_comments must be eagerly loaded (selectinload) before calling this.
    """
    d = row_to_dict(row)
    d["admin_comments"] = [row_to_dict(c) for c in (row.admin_comments or [])]
    return d


async def get_organizer_by_id(organizer_id: str) -> dict | None:
    """Quick organizer lookup by id without admin_comments (for secondary reads)."""
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import Organizer

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Organizer).where(Organizer.id == organizer_id))
        row = result.scalar_one_or_none()
    return row_to_dict(row) if row else None


async def get_organizer_by_slug(slug: str) -> dict | None:
    """Quick organizer lookup by slug without admin_comments (for secondary reads)."""
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import Organizer

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Organizer).where(Organizer.slug == slug))
        row = result.scalar_one_or_none()
    return row_to_dict(row) if row else None


async def get_event_by_id(event_id: str) -> dict | None:
    """Quick event lookup by id (for secondary reads in orders/tickets/services)."""
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import Event

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Event).where(Event.id == event_id))
        row = result.scalar_one_or_none()
    return row_to_dict(row) if row else None


async def get_microsite_by_organizer(organizer_id: str) -> dict | None:
    """Quick microsite lookup by organizer_id (branding, content, etc.)."""
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import Microsite

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Microsite).where(Microsite.organizer_id == organizer_id)
        )
        row = result.scalar_one_or_none()
    return row_to_dict(row) if row else None


async def get_venue_by_id(venue_id: str) -> dict | None:
    """Quick venue lookup by id (for secondary reads in orders/tickets)."""
    from sqlalchemy import select
    from database import AsyncSessionLocal
    from orm_models import Venue

    async with AsyncSessionLocal() as session:
        result = await session.execute(select(Venue).where(Venue.id == venue_id))
        row = result.scalar_one_or_none()
    return row_to_dict(row) if row else None
