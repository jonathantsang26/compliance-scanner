"""Pull and build behavior with the city APIs stubbed out (no network)."""

import pytest

from scanner import build, pull, snapshot
from scanner.config import LA


@pytest.fixture
def raw_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(snapshot, "RAW", tmp_path)
    return tmp_path


def seed_snapshot(rows, epoch=1791705713):
    manifest = {
        "dataset": "LA", "name": "x", "attribution": "LADBS", "resource_url": LA.resource_url,
        "rows_updated_at": "2026-10-11T08:01:53+00:00", "rows_updated_at_epoch": epoch,
        "served_version": "v", "fetched_at": "2026-10-15T18:00:00+00:00", "checked_at": "2026-10-15T18:00:00+00:00",
        "row_count": len(rows), "pages": 1, "fields": list(LA.fields), "app_token_used": False,
    }
    return snapshot.write_snapshot("LA", rows, manifest)


ROWS = [{"building_id": "1", "program_year": "2025", "compliance": "COMPLIED"}]


def test_unchanged_city_data_is_reused_and_the_check_is_recorded(raw_dir, monkeypatch):
    seed_snapshot(ROWS)
    monkeypatch.setattr(pull.socrata, "metadata", lambda s, d: {"name": "x", "attribution": "LADBS", "rows_updated_at_epoch": 1791705713})
    monkeypatch.setattr(pull.socrata, "fetch_all", lambda *a: pytest.fail("must not download unchanged data"))
    result = pull.pull(LA, session=None, token_used=False, force=False, max_drop_pct=2.0)
    assert result["checked_at"] > "2026-10-15T18:00:00+00:00"
    assert snapshot.load_manifest("LA")["checked_at"] == result["checked_at"]
    assert snapshot.snapshot_ok("LA")  # rows.json untouched, sha256 still matches


def test_a_damaged_snapshot_is_downloaded_again(raw_dir, monkeypatch):
    folder = seed_snapshot(ROWS)
    (folder / "rows.json").write_text("[]")
    monkeypatch.setattr(pull.socrata, "metadata", lambda s, d: {"name": "x", "attribution": "LADBS", "rows_updated_at_epoch": 1791705713})
    monkeypatch.setattr(pull.socrata, "fetch_all", lambda *a: (ROWS, 1, 1, "v"))
    result = pull.pull(LA, session=None, token_used=False, force=False, max_drop_pct=2.0)
    assert result["stamp"] != folder.name
    assert snapshot.snapshot_ok("LA")


def test_a_big_row_drop_is_refused_without_force(raw_dir, monkeypatch):
    seed_snapshot(ROWS * 1 + [{"building_id": str(i), "program_year": "2025", "compliance": "COMPLIED"} for i in range(2, 101)])
    monkeypatch.setattr(pull.socrata, "metadata", lambda s, d: {"name": "x", "attribution": "LADBS", "rows_updated_at_epoch": 1791800000})
    monkeypatch.setattr(pull.socrata, "fetch_all", lambda *a: (ROWS, 1, 1, "v"))
    with pytest.raises(RuntimeError, match="fewer than the last pull"):
        pull.pull(LA, session=None, token_used=False, force=False, max_drop_pct=2.0)


def test_one_city_failing_does_not_block_the_other(monkeypatch):
    calls = []
    monkeypatch.setattr(build.pull, "main", lambda args: 1)
    monkeypatch.setattr(build, "snapshot_ok", lambda city: True)
    for name in ("counts", "build_db", "export"):
        monkeypatch.setattr(getattr(build, name), "main", lambda argv, n=name: calls.append(n) or 0)
    assert build.main([]) == 0
    assert calls == ["counts", "build_db", "export"]


def test_no_usable_snapshot_stops_the_build(monkeypatch):
    monkeypatch.setattr(build.pull, "main", lambda args: 1)
    monkeypatch.setattr(build, "snapshot_ok", lambda city: city != "SF")
    monkeypatch.setattr(build.export, "main", lambda argv: pytest.fail("must not export"))
    assert build.main([]) == 1


def test_missing_token_with_require_token_fails(monkeypatch):
    monkeypatch.delenv("SOCRATA_APP_TOKEN", raising=False)
    assert pull.main(["--require-token"]) == 2
