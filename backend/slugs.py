"""Slug normalisation utility."""
import re
import unicodedata
from typing import Optional


def normalize_slug(value: str) -> str:
    """Lower, strip accents, replace non-alnum with `-`, collapse dashes."""
    if not value:
        return ""
    # NFKD: separate base char + combining marks; drop the marks
    nfkd = unicodedata.normalize("NFKD", value)
    ascii_str = nfkd.encode("ascii", "ignore").decode("ascii")
    ascii_str = ascii_str.lower()
    ascii_str = re.sub(r"[^a-z0-9]+", "-", ascii_str)
    ascii_str = ascii_str.strip("-")
    ascii_str = re.sub(r"-{2,}", "-", ascii_str)
    return ascii_str[:60]


def is_valid_slug(slug: str) -> bool:
    if not slug or len(slug) < 2 or len(slug) > 60:
        return False
    return re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", slug) is not None


async def find_unique_slug(base: str, collection, *, exclude_id: Optional[str] = None) -> str:
    """
    Devuelve un slug único en `collection` (MongoDB). Si base ya está
    tomado, sufija -2, -3, etc.
    """
    candidate = normalize_slug(base) or "organizador"
    suffix = 1
    while True:
        query = {"slug": candidate}
        if exclude_id:
            query["id"] = {"$ne": exclude_id}
        existing = await collection.find_one(query, {"_id": 0, "id": 1})
        if not existing:
            return candidate
        suffix += 1
        candidate = f"{normalize_slug(base)}-{suffix}"
        if suffix > 999:
            raise RuntimeError("Could not allocate unique slug")


async def find_unique_slug_pg(
    base: str, session, model, *, exclude_id: Optional[str] = None
) -> str:
    """
    Devuelve un slug único en `model` (SQLAlchemy). Si base ya está
    tomado, sufija -2, -3, etc.
    """
    from sqlalchemy import select

    candidate = normalize_slug(base) or "organizador"
    suffix = 1
    while True:
        stmt = select(model.id).where(model.slug == candidate)
        if exclude_id:
            stmt = stmt.where(model.id != exclude_id)
        existing = await session.scalar(stmt)
        if not existing:
            return candidate
        suffix += 1
        candidate = f"{normalize_slug(base)}-{suffix}"
        if suffix > 999:
            raise RuntimeError("Could not allocate unique slug")
