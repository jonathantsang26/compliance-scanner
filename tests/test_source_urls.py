"""Every source link returns exactly one row.

Offline: each link's filter is applied to the full local snapshot (a complete
copy of the dataset), for every filing, so no link can match zero or two rows.
Live (opt-in, a couple dozen requests): LIVE_SOURCES=1 pytest tests/test_source_urls.py
asks the city APIs themselves, to confirm they read the filters the same way.
"""

import os
import random
import sqlite3
from collections import Counter
from urllib.parse import parse_qsl, urlsplit

import pytest

from scanner.config import DB_PATH, LA, SF
from scanner.snapshot import latest_dir, load_latest

pytestmark = pytest.mark.skipif(
    not DB_PATH.exists() or latest_dir("LA") is None or latest_dir("SF") is None, reason="no snapshot/database yet"
)


def all_source_urls() -> list[str]:
    con = sqlite3.connect(DB_PATH)
    urls = [u for (u,) in con.execute("SELECT source_url FROM filings")]
    con.close()
    return urls


def test_every_source_url_matches_exactly_one_snapshot_row():
    la_rows, _ = load_latest("LA")
    sf_rows, _ = load_latest("SF")
    la_index = Counter((r["building_id"], r["program_year"]) for r in la_rows)
    sf_index = Counter(r["unique_identifier"] for r in sf_rows)
    urls = all_source_urls()
    assert len(urls) == len(la_rows) + len(sf_rows)
    for url in urls:
        parts = urlsplit(url)
        params = dict(parse_qsl(parts.query))
        base = f"{parts.scheme}://{parts.netloc}{parts.path}"
        if base == LA.resource_url:
            assert set(params) == {"building_id", "program_year"}, url
            assert la_index[(params["building_id"], params["program_year"])] == 1, url
        else:
            assert base == SF.resource_url, url
            assert set(params) == {"unique_identifier"}, url
            assert sf_index[params["unique_identifier"]] == 1, url


@pytest.mark.skipif(os.environ.get("LIVE_SOURCES") != "1", reason="set LIVE_SOURCES=1 to query the city APIs")
def test_sample_of_source_urls_live():
    from scanner.socrata import make_session

    session, _ = make_session()
    con = sqlite3.connect(DB_PATH)
    prospects = con.execute(
        "SELECT b.id, f.source_url FROM buildings b JOIN filings f ON f.building_id = b.id AND f.year = b.report_year "
        "WHERE b.segment IS NOT NULL ORDER BY b.id").fetchall()
    # Unusual SF parcel shapes (letters, hyphen suffixes) are where URL encoding goes wrong.
    odd = con.execute(
        "SELECT b.id, f.source_url FROM buildings b JOIN filings f ON f.building_id = b.id AND f.year = b.report_year "
        "WHERE b.city = 'SF' AND (b.source_key GLOB '*[A-Z]*') ORDER BY b.id LIMIT 6").fetchall()
    con.close()
    rng = random.Random(20261015)
    la = [p for p in prospects if p[0].startswith("la:")]
    sf = [p for p in prospects if p[0].startswith("sf:")]
    sample = rng.sample(la, 10) + rng.sample(sf, 8) + odd + [p for p in prospects if p[0] == "la:476102819647"]
    for building_id, url in sample:
        response = session.get(url, timeout=60)
        response.raise_for_status()
        rows = response.json()
        assert len(rows) == 1, f"{url} returned {len(rows)} rows"
        key = rows[0].get("building_id") or rows[0].get("parcel_number")
        assert building_id.split(":", 1)[1] == key, url
