"""Milestone 1 check: recount the Acceptance-test numbers from the raw snapshots.

    python -m scanner.counts            # counts from the local snapshots only
    python -m scanner.counts --live     # also compare with the city's own server-side totals
    python -m scanner.counts --strict   # exit 1 if any count drifts more than the warn limit

These counts are worked out straight from the raw rows, on purpose without the
classifier in scanner/classify.py. The two are written separately so that a bug
in one shows up as a mismatch against the other (see tests/).
"""

import argparse
import json
import os
import sys
from collections import Counter, defaultdict

from . import socrata
from .config import EXPECTED_PATH, LA, REPORT_YEAR, SF
from .snapshot import load_latest

# Printed names for each check; {y} is the report year, {p} the year before.
LABELS = {
    "la_not_complied": "LA {y} NOT COMPLIED",
    "la_complied": "LA {y} COMPLIED",
    "la_prev_not_complied": "LA {p} NOT COMPLIED",
    "la_lapsed": "LA {y} lapsed",
    "la_chronic": "LA {y} chronic",
    "la_other": "LA {y} other",
    "la_nc_data_on_file": "LA {y} non-compliers with data on file",
    "la_nc_no_data_on_file": "LA {y} non-compliers without data",
    "la_nc_city_owned": "LA {y} city-owned non-compliers",
    "sf_did_not_report": "SF {y} Did Not Report",
    "sf_insufficient_data": "SF {y} Insufficient Data",
    "sf_complied": "SF {y} Complied",
    "sf_exempt": "SF {y} Exempt",
    "sf_audit_did_not_comply": "SF {y} audit Did Not Comply",
    "sf_violation_and_audit_did_not_comply": "SF {y} violation and audit Did Not Comply",
}


def label(key: str) -> str:
    y = REPORT_YEAR["LA" if key.startswith("la_") else "SF"]
    return LABELS[key].format(y=y, p=y - 1)


def present(value) -> bool:
    """Socrata leaves null fields out of a row; treat blank strings the same way."""
    return value is not None and str(value).strip() != ""


def la_counts(rows: list[dict], year: int = REPORT_YEAR["LA"]) -> dict:
    y, p1, p2 = str(year), str(year - 1), str(year - 2)
    history = defaultdict(dict)  # building_id -> {year: compliance}
    report_row = {}
    for r in rows:
        history[r["building_id"]][r["program_year"]] = r["compliance"]
        if r["program_year"] == y:
            report_row[r["building_id"]] = r

    status = Counter((r["program_year"], r["compliance"]) for r in rows)
    non_compliers = [b for b, h in history.items() if h.get(y) == "NOT COMPLIED"]
    lapsed = [b for b in non_compliers if history[b].get(p1) == "COMPLIED"]
    chronic = [
        b for b in non_compliers
        if history[b].get(p1) == "NOT COMPLIED" and history[b].get(p2) == "NOT COMPLIED"
    ]
    # "Data on file" looks at the report-year row only, never at older years.
    with_data = [
        b for b in non_compliers
        if present(report_row[b].get("organization")) or present(report_row[b].get("site_eui"))
    ]
    city_owned = [b for b in non_compliers if "CITY OWNED" in report_row[b].get("building_programclass", "")]
    return {
        "la_not_complied": status[(y, "NOT COMPLIED")],
        "la_complied": status[(y, "COMPLIED")],
        "la_prev_not_complied": status[(p1, "NOT COMPLIED")],
        "la_lapsed": len(lapsed),
        "la_chronic": len(chronic),
        "la_other": len(non_compliers) - len(lapsed) - len(chronic),
        "la_nc_data_on_file": len(with_data),
        "la_nc_no_data_on_file": len(non_compliers) - len(with_data),
        "la_nc_city_owned": len(city_owned),
    }


def sf_counts(rows: list[dict], year: int = REPORT_YEAR["SF"]) -> dict:
    y = str(year)
    rows_y = [r for r in rows if r["benchmark_year"] == y]
    status = Counter(r["benchmark_status"] for r in rows_y)
    audit_dnc = [r for r in rows_y if r.get("energy_audit_status") == "Did Not Comply"]
    both = [r for r in audit_dnc if r["benchmark_status"].startswith(f"{y} - Violation - ")]
    return {
        "sf_did_not_report": status[f"{y} - Violation - Did Not Report"],
        "sf_insufficient_data": status[f"{y} - Violation - Insufficient Data"],
        "sf_complied": status[f"{y} - Complied"],
        "sf_exempt": status[f"{y} - Exempt"],
        "sf_audit_did_not_comply": len(audit_dnc),
        "sf_violation_and_audit_did_not_comply": len(both),
    }


def compare(got: dict, expected: dict, warn_pct: float) -> list[dict]:
    results = []
    for name, want in expected.items():
        have = got[name]
        drift = 0.0 if want == have else abs(have - want) / max(want, 1) * 100
        verdict = "MATCH" if have == want else ("DRIFT" if drift <= warn_pct else "WARN")
        results.append({"check": name, "expected": want, "got": have, "drift_pct": round(drift, 2), "verdict": verdict})
    return results


def load_expected() -> dict:
    """The pinned spec counts. They only apply while REPORT_YEAR matches the year they were pinned for."""
    expected = json.loads(EXPECTED_PATH.read_text())
    if expected["report_year"] != REPORT_YEAR:
        raise SystemExit(
            f"scanner/expected.json is pinned for {expected['report_year']} but REPORT_YEAR is {REPORT_YEAR}. "
            "Re-pin it from `python -m scanner.counts` output after rolling forward."
        )
    return expected


def live_crosscheck(la_rows: list[dict], sf_rows: list[dict]) -> list[str]:
    """Run the spec's two curl queries and compare every group with our local rows."""
    session, _ = socrata.make_session()
    problems = []
    server_la = socrata.get_json(session, LA.resource_url, {
        "$select": "program_year,compliance,count(*)",
        "$group": "program_year,compliance",
        "$order": "program_year,compliance",
        "$limit": 500,
    })
    local_la = Counter((r["program_year"], r["compliance"]) for r in la_rows)
    for g in server_la:
        key = (g["program_year"], g["compliance"])
        if int(g["count"]) != local_la.get(key, 0):
            problems.append(f"LA {key}: server {g['count']} vs local {local_la.get(key, 0)}")
    if len(server_la) != len(local_la):
        problems.append(f"LA: server has {len(server_la)} groups, local has {len(local_la)}")

    years = (str(REPORT_YEAR["SF"] - 1), str(REPORT_YEAR["SF"]))
    server_sf = socrata.get_json(session, SF.resource_url, {
        "$select": "benchmark_year,benchmark_status,count(*)",
        "$where": f"benchmark_year in('{years[0]}','{years[1]}')",
        "$group": "benchmark_year,benchmark_status",
    })
    local_sf = Counter((r["benchmark_year"], r["benchmark_status"]) for r in sf_rows if r["benchmark_year"] in years)
    for g in server_sf:
        key = (g["benchmark_year"], g["benchmark_status"])
        if int(g["count"]) != local_sf.get(key, 0):
            problems.append(f"SF {key}: server {g['count']} vs local {local_sf.get(key, 0)}")
    if len(server_sf) != len(local_sf):
        problems.append(f"SF: server has {len(server_sf)} groups, local has {len(local_sf)}")
    return problems


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--live", action="store_true", help="also compare with server-side totals")
    parser.add_argument("--strict", action="store_true", help="exit 1 on drift above the warn limit")
    args = parser.parse_args(argv)

    la_rows, la_manifest = load_latest("LA")
    sf_rows, sf_manifest = load_latest("SF")
    pinned = load_expected()

    for m in (la_manifest, sf_manifest):
        note = "" if m["rows_updated_at"] == pinned["pinned_rows_updated_at"][m["dataset"]] else "  <- newer than the spec's pinned refresh"
        print(f"{m['dataset']}: {m['row_count']:,} rows, city updated {m['rows_updated_at']}, pulled {m['fetched_at']}{note}")

    print("\nLA status by program year (local snapshot):")
    by_year = Counter((r["program_year"], r["compliance"]) for r in la_rows)
    for year in sorted({y for y, _ in by_year}):
        print(f"  {year}  COMPLIED {by_year[(year, 'COMPLIED')]:>6,}   NOT COMPLIED {by_year[(year, 'NOT COMPLIED')]:>6,}")
    sf_years = (str(REPORT_YEAR["SF"] - 1), str(REPORT_YEAR["SF"]))
    print(f"\nSF status, benchmark years {sf_years[0]}-{sf_years[1]} (local snapshot):")
    for (year, status), n in sorted(Counter((r["benchmark_year"], r["benchmark_status"]) for r in sf_rows if r["benchmark_year"] in sf_years).items()):
        print(f"  {status:<40} {n:>6,}")

    got = {**la_counts(la_rows), **sf_counts(sf_rows)}
    results = compare(got, pinned["counts"], pinned["drift_warn_pct"])
    print(f"\n{'check':<46}{'expected':>9}{'got':>9}  verdict")
    for r in results:
        extra = f" ({r['drift_pct']}%)" if r["verdict"] != "MATCH" else ""
        print(f"{label(r['check']):<46}{r['expected']:>9,}{r['got']:>9,}  {r['verdict']}{extra}")
    print(f"\nLA lapsed + chronic + other = {got['la_lapsed'] + got['la_chronic'] + got['la_other']:,}"
          f" (NOT COMPLIED {REPORT_YEAR['LA']} = {got['la_not_complied']:,})")

    failed = [r for r in results if r["verdict"] == "WARN"]
    if args.live:
        problems = live_crosscheck(la_rows, sf_rows)
        print("\nlive cross-check vs server totals:", "all groups match" if not problems else "")
        for p in problems:
            print("  MISMATCH", p)
        if problems and args.strict:
            return 1
    if failed:
        message = f"{len(failed)} count(s) drifted more than {pinned['drift_warn_pct']}% from the pinned spec values"
        print(f"\nWARNING: {message}")
        if os.environ.get("GITHUB_ACTIONS") == "true":
            print(f"::warning title=Count drift::{message}: " + ", ".join(label(r["check"]) for r in failed))
        return 1 if args.strict else 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
