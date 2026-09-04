"""Unit tests for path traversal guards used by asset/log file serving."""

from pathlib import Path

from services.path_safety import resolve_path_under


def test_resolve_stays_under_base(tmp_path: Path):
    target = tmp_path / "ok.json"
    target.write_text("{}", encoding="utf-8")
    got = resolve_path_under(tmp_path, "ok.json")
    assert got == target.resolve()


def test_resolve_rejects_parent_traversal(tmp_path: Path):
    assert resolve_path_under(tmp_path, "../etc/passwd") is None
    assert resolve_path_under(tmp_path, "..") is None
    assert resolve_path_under(tmp_path, "foo/../../etc/passwd") is None


def test_resolve_rejects_absolute_path(tmp_path: Path):
    assert resolve_path_under(tmp_path, "/etc/passwd") is None
    assert resolve_path_under(tmp_path, "") is None
