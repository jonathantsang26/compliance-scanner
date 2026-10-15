"""Checks on the real snapshot and database. Skipped until a pull has run.

    python -m scanner.pull && python -m scanner.build_db && pytest
"""

import json
import sqlite3

import pytest

from scanner import counts as raw_counts
from scanner.build_db import checkpoint
from scanner.config import DB_PATH, EXPECTED_PATH
from scanner.snapshot import latest_dir, load_latest
from tests.conftest import requires_pinned

needs_snapshot = pytest.mark.skipif(
    latest_dir("LA") is None or latest_dir("SF") is None or not DB_PATH.exists(),
    reason="no snapshot/database yet",
)


@pytest.fixture(scope="module")
def db():
    con = sqlite3.connect(DB_PATH)
    yield con
    con.close()


@needs_snapshot
def test_database_matches_independent_raw_count():
    la_rows, _ = load_latest("LA")
    sf_rows, _ = load_latest("SF")
    independent = {**raw_counts.la_counts(la_rows), **raw_counts.sf_counts(sf_rows)}
    assert checkpoint(DB_PATH) == independent


@needs_snapshot
@requires_pinned
def test_counts_within_drift_of_spec():
    expected = json.loads(EXPECTED_PATH.read_text())
    got = checkpoint(DB_PATH)
    results = raw_counts.compare(got, expected["counts"], expected["drift_warn_pct"])
    assert [r for r in results if r["verdict"] == "WARN"] == []


@needs_snapshot
def test_la_segments_partition_non_compliers(db):
    (nc,) = db.execute("SELECT count(*) FROM buildings WHERE city='LA' AND report_status='not_complied'").fetchone()
    (seg,) = db.execute("SELECT count(*) FROM buildings WHERE city='LA' AND segment IN ('lapsed','chronic','other')").fetchone()
    assert nc == seg


@needs_snapshot
@requires_pinned
def test_5500_s_figueroa(db):
    row = db.execute("SELECT address, segment, data_on_file FROM buildings WHERE id='la:476102819647'").fetchone()
    assert row == ("5500 S FIGUEROA ST", "chronic", 0)
    years = [y for (y,) in db.execute("SELECT year FROM filings WHERE building_id='la:476102819647' ORDER BY year")]
    assert years == list(range(2018, 2026))


@needs_snapshot
def test_5500_s_figueroa_history_is_complete(db):
    years = [y for (y,) in db.execute("SELECT year FROM filings WHERE building_id='la:476102819647' ORDER BY year")]
    assert years[:8] == list(range(2018, 2026))


@needs_snapshot
def test_211_jefferson(db):
    row = db.execute("SELECT address, alt_name FROM buildings WHERE id='sf:0012/001'").fetchone()
    assert row == ("2739 TAYLOR ST", "211 Jefferson St")


@needs_snapshot
def test_every_filing_has_a_unique_source_url(db):
    (n, distinct, empty) = db.execute(
        "SELECT count(*), count(DISTINCT source_url), sum(source_url IS NULL OR source_url='') FROM filings"
    ).fetchone()
    assert n == distinct and empty == 0


@needs_snapshot
def test_lapsed_buildings_have_their_2024_filer(db):
    (bad,) = db.execute(
        "SELECT count(*) FROM buildings WHERE city='LA' AND segment='lapsed' AND last_filed_year != report_year - 1"
    ).fetchone()
    assert bad == 0


@needs_snapshot
def test_city_owned_never_ranked(db):
    (bad,) = db.execute("SELECT count(*) FROM buildings WHERE city_owned AND priority IN ('A','B')").fetchone()
    assert bad == 0


@needs_snapshot
def test_city_owned_follows_the_size_band_suffix(db):
    """Structural, so it holds on any snapshot: a bracketed suffix always means city-owned."""
    (bad,) = db.execute(
        "SELECT count(*) FROM buildings WHERE city='LA' AND (size_band_raw LIKE '%(%') != city_owned").fetchone()
    assert bad == 0


@needs_snapshot
def test_no_published_filer_name_looks_personal():
    """Every name that reaches site/data passed the person check, so none carries a trust or owner marker."""
    import re

    from scanner.config import SITE
    marker = re.compile(r"\b(TR|TRS|TRUSTEES?|ET AL|CO-?OWNERS?|C/O)\b|(LIVING|FAMILY|REVOCABLE) TRUST", re.I)
    for shard in (SITE / "data" / "b").glob("*.json"):
        for b in json.loads(shard.read_text()).values():
            names = [f["filed_by"] for f in b["filings"] if f["filed_by"]] + [b.get("last_filed_by")]
            for name in filter(None, names):
                assert not marker.search(name), (b["id"], name)
            assert all(f["filed_by"] is None for f in b["filings"] if f.get("filed_by_note") == "withheld")
    rows = json.loads((SITE / "data" / "prospects.json").read_text())
    for r in rows:
        if r["last_filed_by"]:
            assert not marker.search(r["last_filed_by"]), (r["id"], r["last_filed_by"])


@needs_snapshot
def test_raw_filer_names_stay_out_of_the_published_files():
    from scanner.config import SITE
    for path in [SITE / "data" / "prospects.json", *(SITE / "data" / "b").glob("*.json")]:
        assert "filed_by_raw" not in path.read_text(), path.name


@needs_snapshot
def test_published_floor_areas_fit_their_band():
    from scanner.classify import area_fits_band
    from scanner.config import SITE
    for shard in (SITE / "data" / "b").glob("*.json"):
        for b in json.loads(shard.read_text()).values():
            if b["floor_area_sqft"] is not None:
                assert area_fits_band(b["floor_area_sqft"], b["size_band"]), (b["id"], b["floor_area_sqft"], b["size_band"])
