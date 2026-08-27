"""Resolve user-supplied relative paths safely under a known base directory."""

from __future__ import annotations

from pathlib import Path


def resolve_path_under(base_dir: Path, relative: str) -> Path | None:
    """Return *relative* resolved under *base_dir*, or None if it escapes."""
    if not relative:
        return None
    base = base_dir.resolve()
    resolved = (base / relative).resolve()
    if not resolved.is_relative_to(base):
        return None
    return resolved
