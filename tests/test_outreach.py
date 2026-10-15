"""Outreach lines follow the spec's templates and guardrails."""

import json
import re
import sqlite3

import pytest

from scanner.config import DB_PATH, SF_DUE_DATE_SENTENCES, SITE
from scanner.export import building_records, city_meta
from scanner.outreach import CITY_OWNED_REASON, la_line, outreach_for, sf_line

FORBIDDEN = re.compile(r"not filed|didn'?t file|did not file|failed to file|never filed|penalt|\bfine[sd]?\b|\$", re.I)
LA_URL = "https://data.lacity.org/resource/9yda-i4ya.json?building_id=476102819647&program_year=2025"
SF_URL = "https://data.sf.gov/resource/96ck-qcfe.json?unique_identifier=0012/001_2025"


def test_la_line_any_segment():
    line = la_line("5500 S FIGUEROA ST", 2025, "October 11, 2026", "chronic", "CRCD Partners", 2022, LA_URL)
    assert line == ("LADBS's public EBEWE data (as of October 11, 2026) lists 5500 S FIGUEROA ST "
                    f"as NOT COMPLIED for program year 2025. Source: {LA_URL}")


def test_la_line_lapsed_appends_2024_filer():
    line = la_line("1 MAIN ST", 2025, "October 11, 2026", "lapsed", "Bay Efficiency", 2024, LA_URL)
    assert line.endswith(f" It was listed as COMPLIED for 2024, filed by Bay Efficiency. Source: {LA_URL}")


def test_la_line_lapsed_no_double_period_and_no_missing_filer():
    assert la_line("1 MAIN ST", 2025, "x", "lapsed", "Vert Energy Group, Inc.", 2024, LA_URL).endswith(
        f"filed by Vert Energy Group, Inc. Source: {LA_URL}")
    assert la_line("1 MAIN ST", 2025, "x", "lapsed", None, 2024, LA_URL).endswith(
        f"It was listed as COMPLIED for 2024. Source: {LA_URL}")


def test_line_trims_stray_punctuation_from_the_address():
    line = sf_line("2544 Mission St,", "2025 - Violation - Did Not Report", "October 9, 2026", "did_not_report", 2025, SF_URL)
    assert "lists 2544 Mission St as '2025" in line


def test_sf_lines_quote_the_label():
    dnr = sf_line("2739 TAYLOR ST", "2025 - Violation - Did Not Report", "October 9, 2026", "did_not_report", 2025, SF_URL,
                  due_date_confirmed=False)
    assert dnr == ("SF Environment's public data (as of October 9, 2026) lists 2739 TAYLOR ST as "
                   f"'2025 - Violation - Did Not Report'. Source: {SF_URL}")
    confirmed = sf_line("2739 TAYLOR ST", "2025 - Violation - Did Not Report", "October 9, 2026", "did_not_report", 2025, SF_URL,
                        due_date_confirmed=True)
    assert confirmed == dnr.replace(" Source:", f" {SF_DUE_DATE_SENTENCES[2025]} Source:")
    insufficient = sf_line("1 X ST", "2025 - Violation - Insufficient Data", "October 9, 2026", "insufficient_data", 2025, SF_URL,
                           due_date_confirmed=True)
    assert insufficient.endswith(f"as '2025 - Violation - Insufficient Data'. Source: {SF_URL}")


def test_sf_due_date_sentence_only_for_a_year_with_a_known_date():
    line = sf_line("1 X ST", "2026 - Violation - Did Not Report", "x", "did_not_report", 2026, SF_URL, due_date_confirmed=True)
    assert "May 1" not in line


needs_db = pytest.mark.skipif(not DB_PATH.exists(), reason="no database yet")


@pytest.fixture(scope="module")
def records_and_meta():
    con = sqlite3.connect(DB_PATH)
    meta = city_meta(con)
    records = building_records(con)
    con.close()
    return records, meta


@needs_db
def test_every_real_line_follows_the_guardrails(records_and_meta):
    records, meta = records_and_meta
    prospects = [b for b in records.values() if b["segment"] and not b["city_owned"]]
    assert prospects
    for b in prospects:
        label = meta[b["city"]]["as_of_label"]
        o = outreach_for(b, label, la_approved=True, sf_due_date_confirmed=True)
        line = o["line"]
        assert f"(as of {label})" in line
        assert line.endswith(f" Source: {o['source_url']}")
        assert not FORBIDDEN.search(line.split(" Source: ")[0]), line
        if b["city"] == "LA":
            assert "NOT COMPLIED" in line
        else:
            assert f"'{b['report_status_raw']}'" in line


@needs_db
def test_lines_never_name_a_withheld_filer(records_and_meta):
    records, meta = records_and_meta
    for b in records.values():
        if b["segment"] == "lapsed" and b["city"] == "LA" and b["last_filed_by_note"] == "withheld":
            line = outreach_for(b, "x", la_approved=True)["line"]
            assert ", filed by" not in line, line


@needs_db
def test_city_owned_buildings_get_no_line(records_and_meta):
    records, _ = records_and_meta
    owned = [b for b in records.values() if b["segment"] and b["city_owned"]]
    assert owned
    for b in owned:
        o = outreach_for(b, "x", la_approved=True, sf_due_date_confirmed=True)
        assert o["line"] is None and o["held_reason"] == CITY_OWNED_REASON


@needs_db
def test_la_lines_are_held_until_sign_off(records_and_meta):
    records, meta = records_and_meta
    for b in records.values():
        if b["segment"] and b["city"] == "LA" and not b["city_owned"]:
            o = outreach_for(b, meta["LA"]["as_of_label"], la_approved=False)
            assert o["line"] is None and "signs off" in o["held_reason"]


@pytest.mark.skipif(not (SITE / "data" / "prospects.json").exists(), reason="site not built")
def test_published_files_hold_no_la_lines_while_gated():
    from scanner.config import LA_OUTREACH_APPROVED
    if LA_OUTREACH_APPROVED:
        pytest.skip("LA outreach approved")
    rows = json.loads((SITE / "data" / "prospects.json").read_text())
    assert all(r["outreach_line"] is None for r in rows if r["city"] == "LA")
    assert all(r["outreach_line"] is None for r in rows if r["city_owned"])
    assert all(r["outreach_line"] for r in rows if r["city"] == "SF" and not r["city_owned"])
    for shard in (SITE / "data" / "b").glob("*.json"):
        text = shard.read_text()
        assert "LADBS's public EBEWE data" not in text, shard.name
