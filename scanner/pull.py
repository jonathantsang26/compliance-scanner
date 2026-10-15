"""Pull both city datasets into raw snapshots.

    python -m scanner.pull                  # skip a city whose data has not changed
    python -m scanner.pull --force          # download again, and accept a big row-count drop
    python -m scanner.pull --require-token  # fail if SOCRATA_APP_TOKEN is missing (CI uses this)

To be polite to the city APIs we first ask when the dataset last changed (one
tiny request). If that matches our newest snapshot we reuse it.
"""

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone

from . import socrata
from .config import DATASETS, EXPECTED_PATH
from .snapshot import load_manifest, mark_checked, prune, snapshot_ok, write_snapshot

STATUS_FIELD = {"LA": "compliance", "SF": "benchmark_status"}


def iso_utc(epoch: int | float) -> str:
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat(timespec="seconds")


def check_rows(dataset, rows: list[dict], server_count: int) -> None:
    """Stop if the pull is incomplete, a building-year shows up twice, or a status is missing."""
    if len(rows) != server_count:
        raise RuntimeError(f"{dataset.city}: got {len(rows)} rows but the API reports {server_count}")
    keys = Counter((r.get(dataset.key_field), r.get(dataset.year_field)) for r in rows)
    dupes = [k for k, n in keys.items() if n > 1]
    if dupes:
        raise RuntimeError(f"{dataset.city}: {len(dupes)} duplicate building-years, e.g. {dupes[:3]}")
    missing = sum(1 for k in keys if not k[0] or not k[1])
    if missing:
        raise RuntimeError(f"{dataset.city}: {missing} rows lack a building key or year")
    field = STATUS_FIELD[dataset.city]
    blank = [r for r in rows if not str(r.get(field) or "").strip()]
    if blank:
        raise RuntimeError(f"{dataset.city}: {len(blank)} rows have no {field}, e.g. {blank[0].get(dataset.key_field)}")


def check_not_shrunk(dataset, row_count: int, previous: dict | None, max_drop_pct: float) -> None:
    """Refuse a snapshot much smaller than the last one. A half-loaded dataset
    on the city's side would otherwise publish a nearly empty site."""
    if not previous:
        return
    drop = (previous["row_count"] - row_count) / previous["row_count"] * 100
    if drop > max_drop_pct:
        raise RuntimeError(
            f"{dataset.city}: {row_count:,} rows is {drop:.1f}% fewer than the last pull "
            f"({previous['row_count']:,}). Check the city portal, then rerun with --force to accept it."
        )


def reusable(cached: dict | None, dataset, meta: dict) -> bool:
    return bool(
        cached
        and cached["rows_updated_at_epoch"] == meta["rows_updated_at_epoch"]
        and cached.get("fields") == list(dataset.fields)
        and cached.get("resource_url") == dataset.resource_url
        and snapshot_ok(dataset.city)
    )


def pull(dataset, session, token_used: bool, force: bool, max_drop_pct: float) -> dict:
    meta = socrata.metadata(session, dataset)
    cached = load_manifest(dataset.city)
    if not force and reusable(cached, dataset, meta):
        checked = mark_checked(dataset.city, datetime.now(timezone.utc).isoformat(timespec="seconds"))
        print(f"{dataset.city}: unchanged since {cached['rows_updated_at']}, reusing {cached['stamp']} (checked {checked['checked_at']})")
        return checked

    # If the city publishes while we page through, the pages can mix two
    # versions. Check the update stamp before and after, and retry once.
    for attempt in (1, 2):
        fetched_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        rows, pages, count, served = socrata.fetch_all(session, dataset)
        meta_after = socrata.metadata(session, dataset)
        if meta_after["rows_updated_at_epoch"] == meta["rows_updated_at_epoch"]:
            break
        print(f"{dataset.city}: dataset changed during the pull, retrying", file=sys.stderr)
        meta = meta_after
    else:
        raise RuntimeError(f"{dataset.city}: dataset kept changing during the pull")

    check_rows(dataset, rows, count)
    if not force:
        check_not_shrunk(dataset, len(rows), cached, max_drop_pct)
    manifest = {
        "dataset": dataset.city,
        "name": meta["name"],
        "attribution": meta["attribution"],
        "resource_url": dataset.resource_url,
        "rows_updated_at": iso_utc(meta["rows_updated_at_epoch"]),
        "rows_updated_at_epoch": meta["rows_updated_at_epoch"],
        "served_version": served,
        "fetched_at": fetched_at,
        "checked_at": fetched_at,
        "row_count": len(rows),
        "pages": pages,
        "fields": list(dataset.fields),
        "app_token_used": token_used,
    }
    folder = write_snapshot(dataset.city, rows, manifest)
    print(f"{dataset.city}: {len(rows):,} rows in {pages} page(s), city updated {manifest['rows_updated_at']} -> {folder}")
    prune(dataset.city, keep=3)
    return load_manifest(dataset.city)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--force", action="store_true", help="download even if unchanged, and accept a big row-count drop")
    parser.add_argument("--city", choices=sorted(DATASETS), help="pull one city only")
    parser.add_argument("--require-token", action="store_true", help="fail when SOCRATA_APP_TOKEN is not set")
    args = parser.parse_args(argv)

    session, token_used = socrata.make_session()
    if not token_used:
        if args.require_token:
            print("error: SOCRATA_APP_TOKEN is not set", file=sys.stderr)
            return 2
        print("warning: SOCRATA_APP_TOKEN is not set; pulling without an app token (lower rate limit)", file=sys.stderr)
    max_drop_pct = json.loads(EXPECTED_PATH.read_text())["drift_warn_pct"]

    # Each city is pulled on its own, so an LA outage doesn't stop the SF refresh.
    failed = []
    for city, dataset in DATASETS.items():
        if args.city and city != args.city:
            continue
        try:
            pull(dataset, session, token_used, args.force, max_drop_pct)
        except Exception as exc:  # noqa: BLE001 - report every city, then fail
            print(f"error: {city} pull failed: {exc}", file=sys.stderr)
            failed.append(city)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
