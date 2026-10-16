"""Shared test helpers.

Some checks pin exact values from SPEC.md (the 2026-10-11 LA and 2026-10-09 SF
refreshes). Once a city publishes new rows those values can move for honest
reasons, such as late filings. So those checks run only while the local snapshot
is still the pinned one. After that, scanner.counts reports drift as a warning
instead.
"""

import json

import pytest

from scanner.config import EXPECTED_PATH
from scanner.snapshot import load_manifest


def on_pinned_snapshot() -> bool:
    pinned = json.loads(EXPECTED_PATH.read_text())["pinned_rows_updated_at"]
    for city, stamp in pinned.items():
        manifest = load_manifest(city)
        if not manifest or manifest["rows_updated_at"] != stamp:
            return False
    return True


requires_pinned = pytest.mark.skipif(
    not on_pinned_snapshot(),
    reason="city data changed since the spec's pinned refresh; drift is reported by scanner.counts",
)

# The refreshes SPEC.md was written against. Re-pinning expected.json after a
# roll-forward moves the pin above, but facts about single buildings in the
# spec hold only on these.
SPEC_ROWS_UPDATED_AT = {"LA": "2026-10-11T08:01:53+00:00", "SF": "2026-10-10T00:10:46+00:00"}


def on_spec_snapshot() -> bool:
    return all((load_manifest(city) or {}).get("rows_updated_at") == stamp for city, stamp in SPEC_ROWS_UPDATED_AT.items())


requires_spec_snapshot = pytest.mark.skipif(
    not on_spec_snapshot(),
    reason="the spec's single-building examples hold only on the refreshes it was written against",
)
