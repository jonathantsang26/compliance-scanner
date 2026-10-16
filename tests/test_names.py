"""Person checks on the real database and site/data. Skipped until a pull has run.

The unit tests in test_classify.py use made-up names; these run the same rules
over every LA filer value the build actually published.
"""

import html
import json
import re
import sqlite3
from collections import defaultdict

import pytest

from scanner.classify import KNOWN_FILERS, looks_personal
from scanner.config import DB_PATH, SITE
from scanner.snapshot import latest_dir

needs_build = pytest.mark.skipif(
    latest_dir("LA") is None or not DB_PATH.exists() or not (SITE / "data" / "prospects.json").exists(),
    reason="no snapshot/database/site data yet",
)


def published_names():
    """Every filer value in site/data, with where it was found."""
    for shard in (SITE / "data" / "b").glob("*.json"):
        for b in json.loads(shard.read_text()).values():
            for f in b["filings"]:
                if f.get("filed_by"):
                    yield b["id"], f["filed_by"]
            if b.get("last_filed_by"):
                yield b["id"], b["last_filed_by"]
    for r in json.loads((SITE / "data" / "prospects.json").read_text()):
        if r.get("last_filed_by"):
            yield r["id"], r["last_filed_by"]


@needs_build
def test_no_published_filer_value_looks_personal():
    # Failures name building IDs only: CI logs of a public repo are public too.
    # Hand-checked filers skip the rule; test_classify pins which of them look personal.
    bad = sorted({where for where, name in published_names()
                  if looks_personal(name) and name.lower() not in KNOWN_FILERS})
    assert not bad, f"{len(bad)} buildings publish a person-shaped filer value, e.g. {bad[:10]}"


@needs_build
def test_no_page_shows_a_person_name_it_withholds_in_another_year():
    con = sqlite3.connect(DB_PATH)
    rows = con.execute("SELECT building_id, filed_by, filed_by_note, filed_by_raw FROM filings "
                       "WHERE building_id LIKE 'la:%' AND filed_by_raw IS NOT NULL").fetchall()
    last = dict(con.execute("SELECT id, last_filed_by FROM buildings WHERE city = 'LA' AND last_filed_by IS NOT NULL"))
    con.close()
    shown, hidden = defaultdict(set), defaultdict(set)
    for building_id, filed_by, note, raw in rows:
        if filed_by:
            shown[building_id].add(filed_by)
        elif note == "withheld":
            name = " ".join(html.unescape(raw).split())
            if looks_personal(name):
                hidden[building_id].add(name)
    for building_id, name in last.items():
        shown[building_id].add(name)
    leaks = []
    for building_id, names in hidden.items():
        for name in names:
            inside = re.compile(rf"(?<![a-z0-9]){re.escape(name.lower())}(?![a-z0-9])")
            if any(inside.search(s.lower()) for s in shown[building_id]):
                leaks.append(building_id)
    assert not leaks, f"{len(leaks)} pages show a name they withhold elsewhere, e.g. {sorted(leaks)[:10]}"
