"""scanner.counts on made-up rows: rolling the report year forward and re-pinning expected.json."""

import json
import re

import pytest

from scanner import counts
from scanner.config import EXPECTED_PATH

LA_ROWS = [
    # 1 lapsed, 1 chronic, 1 city-owned "other", 1 complied in 2026.
    {"building_id": "1", "program_year": "2025", "compliance": "COMPLIED", "building_programclass": "100,000+ sqft"},
    {"building_id": "1", "program_year": "2026", "compliance": "NOT COMPLIED", "building_programclass": "100,000+ sqft",
     "organization": "Lantern Energy LLC"},
    *({"building_id": "2", "program_year": str(y), "compliance": "NOT COMPLIED",
       "building_programclass": "20,000 to 49,999 sqft"} for y in (2024, 2025, 2026)),
    {"building_id": "3", "program_year": "2026", "compliance": "NOT COMPLIED",
     "building_programclass": "7,500 to 14,999 sqft (CITY OWNED BUILDING)"},
    {"building_id": "4", "program_year": "2026", "compliance": "COMPLIED", "building_programclass": "100,000+ sqft"},
]
SF_ROWS = [
    {"parcel_number": "0001/001", "benchmark_year": "2026", "benchmark_status": "2026 - Violation - Did Not Report",
     "energy_audit_status": "Did Not Comply"},
    {"parcel_number": "0001/002", "benchmark_year": "2026", "benchmark_status": "2026 - Complied"},
    {"parcel_number": "0001/002", "benchmark_year": "2025", "benchmark_status": "2025 - Complied"},
]
MANIFESTS = {
    city: {"dataset": city, "row_count": len(rows), "rows_updated_at": f"2027-0{i}-01T08:00:00+00:00",
           "fetched_at": "2027-03-01T00:00:00+00:00"}
    for i, (city, rows) in enumerate((("LA", LA_ROWS), ("SF", SF_ROWS)), start=1)
}


@pytest.fixture
def rolled_forward(tmp_path, monkeypatch):
    """REPORT_YEAR moved to 2026 while scanner/expected.json is still pinned for 2025."""
    pinned = tmp_path / "expected.json"
    # Stale on its own, so the test still holds after the real pin moves to 2026.
    stale = {**json.loads(EXPECTED_PATH.read_text()), "report_year": {"LA": 2025, "SF": 2025}}
    pinned.write_text(json.dumps(stale, indent=2))
    monkeypatch.setattr(counts, "EXPECTED_PATH", pinned)
    monkeypatch.setattr(counts, "REPORT_YEAR", {"LA": 2026, "SF": 2026})
    rows = {"LA": LA_ROWS, "SF": SF_ROWS}
    monkeypatch.setattr(counts, "load_latest", lambda city: (rows[city], MANIFESTS[city]))
    return pinned


def test_a_stale_pin_still_prints_the_new_counts_then_stops(rolled_forward, capsys):
    assert counts.main([]) == 1
    out = capsys.readouterr().out
    assert re.search(r"LA 2026 NOT COMPLIED\s+3\n", out)
    assert re.search(r"LA 2026 lapsed\s+1\n", out) and re.search(r"SF 2026 Did Not Report\s+1\n", out)
    assert not re.search(r"\d\s+(MATCH|DRIFT|WARN)\b", out)  # nothing is compared with the 2025 numbers
    for step in ('"report_year"', '"pinned_rows_updated_at"', "got column", "python -m scanner.counts"):
        assert step in out, step


def test_following_the_printed_steps_re_pins_the_counts(rolled_forward, capsys):
    counts.main([])
    out = capsys.readouterr().out
    # The steps end with a JSON block of exactly what to put in expected.json.
    block = json.loads(out[out.index("{\n"):])
    assert block["report_year"] == {"LA": 2026, "SF": 2026}
    assert block["pinned_rows_updated_at"] == {city: m["rows_updated_at"] for city, m in MANIFESTS.items()}
    expected = json.loads(rolled_forward.read_text())
    rolled_forward.write_text(json.dumps({**expected, **block}, indent=2))

    assert counts.main([]) == 0
    out = capsys.readouterr().out
    assert out.count("  MATCH") == len(counts.LABELS)
    assert "newer than the spec's pinned refresh" not in out


def test_build_db_points_at_the_same_steps(rolled_forward):
    with pytest.raises(SystemExit, match=r"Run `python -m scanner.counts` and follow the steps it prints"):
        counts.load_expected()
