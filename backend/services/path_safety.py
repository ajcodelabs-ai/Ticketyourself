"""Resolve user-supplied relative paths safely under a known base directory."""

from __future__ import annotations

from pathlib import Path


def resolve_path_under(base_dir: Path, relative: str) -> Path | None:
    """Return *relative* resolved under *base_dir*, or None if it escapes."""
    if not relative:
        return None
    base = base_dir.resolve()
    try:
        resolved = (base / relative).resolve()
        resolved.relative_to(base)
    except (ValueError, OSError):
        return None
    return resolved
