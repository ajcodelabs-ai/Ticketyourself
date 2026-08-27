"""Disk vs DB consistency for suspension-appeal evidence files."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import HTTPException

from routers import events as events_mod


@pytest.fixture
def assets_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(events_mod, "ASSETS_DIR", tmp_path)
    return tmp_path


def _touch(base: Path, rel: str, body: bytes = b"x") -> Path:
    path = base / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    return path


def test_rollback_keeps_old_files_and_drops_new_ones(assets_dir):
    old = _touch(assets_dir, "org/evt/old.pdf", b"old")
    new = _touch(assets_dir, "org/evt/new.pdf", b"new")
    events_mod._finalize_appeal_disk(
        committed=False,
        written=["org/evt/new.pdf"],
        obsolete=["org/evt/old.pdf"],
    )
    assert old.exists()
    assert not new.exists()


def test_commit_drops_old_files_and_keeps_new_ones(assets_dir):
    old = _touch(assets_dir, "org/evt/old.pdf", b"old")
    new = _touch(assets_dir, "org/evt/new.pdf", b"new")
    events_mod._finalize_appeal_disk(
        committed=True,
        written=["org/evt/new.pdf"],
        obsolete=["org/evt/old.pdf"],
    )
    assert not old.exists()
    assert new.exists()


def test_write_appeal_bytes_removes_partial_file(assets_dir, monkeypatch):
    target = assets_dir / "partial.pdf"

    def boom(self, data):
        with open(self, "wb") as fh:
            fh.write(b"partial")
        raise OSError("No space left on device")

    monkeypatch.setattr(Path, "write_bytes", boom)
    with pytest.raises(HTTPException) as exc:
        events_mod._write_appeal_bytes(target, b"full-content")
    assert exc.value.status_code == 500
    assert not target.exists()
