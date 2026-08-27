"""Resolve user-supplied relative paths safely under a known base directory."""

from __future__ import annotations

import os
from pathlib import Path


def resolve_path_under(base_dir: Path, relative: str) -> Path | None:
    """Return *relative* resolved under *base_dir*, or None if it escapes."""
    if not relative:
        return None
    base = os.path.realpath(base_dir) + os.sep
    resolved = os.path.realpath(os.path.join(base, relative))
    if not resolved.startswith(base):
        return None
    return Path(resolved)
