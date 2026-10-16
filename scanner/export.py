"""Build the static site's JSON from data/scanner.db.

    python -m scanner.export

Writes into site/data/:
    meta.json      as-of dates, headline counts, flags (every page loads this)
    search.json    one small record per building, for client-side search
    b/<xx>.json    full building records (all years), split into 256 files
    prospects.json the prospect list (Milestone 4)
The site never talks to the city APIs. It only reads these files, which the
nightly job rebuilds.
"""

import json
import os
import shutil
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone

from .config import (
    DB_PATH, LA, LA_LIVE_STATUS_URL, LA_OUTREACH_APPROVED, PACIFIC, REPORT_YEAR, SF, SF_DUE_DATE_CONFIRMED, SITE,
    YEAR_NOTES,
)
from .outreach import LA_HELD_REASON, outreach_for

SHARD_COUNT = 256
OUT = SITE / "data"

CITY_INFO = {
    "LA": {
        "city_name": "Los Angeles",
        "agency": "LADBS",
        "program": "EBEWE",
        "dataset_name": "Existing Buildings Energy & Water Efficiency (EBEWE) Program",
        "dataset_url": f"https://{LA.domain}/d/{LA.resource}",
        "api_url": LA.resource_url,
    },
    "SF": {
        "city_name": "San Francisco",
        "agency": "SF Environment",
        "program": "Existing Buildings Energy Performance Ordinance",
        "dataset_name": "Existing Buildings Energy Performance Ordinance Report",
        "dataset_url": f"https://{SF.domain}/d/{SF.resource}",
        "api_url": SF.resource_url,
    },
}


def shard_of(building_id: str) -> str:
    """FNV-1a hash of the id, as two hex digits. site/js/core.js has the same function."""
    h = 0x811C9DC5
    for byte in building_id.encode("utf-8"):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return f"{h % SHARD_COUNT:02x}"


def pacific_date_label(iso: str) -> tuple[str, str]:
    """'2026-10-10T00:10:46+00:00' -> ('2026-10-09', 'October 9, 2026'), in Pacific time."""
    local = datetime.fromisoformat(iso).astimezone(PACIFIC)
    return local.date().isoformat(), f"{local:%B} {local.day}, {local.year}"


def pacific_time_label(iso: str) -> str:
    local = datetime.fromisoformat(iso).astimezone(PACIFIC)
    hour = local.hour % 12 or 12
    return f"{local:%B} {local.day}, {local.year}, {hour}:{local:%M} {'AM' if local.hour < 12 else 'PM'} PT"


def rows(con, sql, *args) -> list[dict]:
    cur = con.execute(sql, args)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r)) for r in cur.fetchall()]


def city_meta(con) -> dict:
    out = {}
    for city in ("LA", "SF"):
        [pull] = rows(con, "SELECT * FROM pulls WHERE dataset=? AND is_current", city)
        as_of, as_of_label = pacific_date_label(pull["rows_updated_at"])
        year = REPORT_YEAR[city]
        q = lambda sql: con.execute(sql, (city,)).fetchone()[0]  # noqa: E731
        meta = {
            **CITY_INFO[city],
            "report_year": year,
            "rows_updated_at": pull["rows_updated_at"],
            "as_of": as_of,
            "as_of_label": as_of_label,
            "fetched_at": pull["fetched_at"],
            "fetched_label": pacific_time_label(pull["fetched_at"]),
            "checked_at": pull["checked_at"],
            "checked_label": pacific_time_label(pull["checked_at"]),
            "data_as_of": pull["data_as_of"],
            "row_count": pull["row_count"],
            "buildings_total": q("SELECT count(*) FROM buildings WHERE city=?"),
            "buildings_in_report_year": q("SELECT count(*) FROM buildings WHERE city=? AND report_status IS NOT NULL"),
        }
        status = dict(con.execute(
            "SELECT report_status, count(*) FROM buildings WHERE city=? AND report_status IS NOT NULL GROUP BY 1", (city,)))
        segment = dict(con.execute(
            "SELECT segment, count(*) FROM buildings WHERE city=? AND segment IS NOT NULL GROUP BY 1", (city,)))
        history = dict(con.execute(
            "SELECT history, count(*) FROM buildings WHERE city=? AND segment IS NOT NULL GROUP BY 1", (city,)))
        owned = q("SELECT count(*) FROM buildings WHERE city=? AND segment IS NOT NULL AND city_owned")
        if city == "LA":
            meta["headline"] = {
                "not_complied": status.get("not_complied", 0),
                "complied": status.get("complied", 0),
                "lapsed": segment.get("lapsed", 0),
                "chronic": segment.get("chronic", 0),
                "other": segment.get("other", 0),
                "city_owned": owned,
                "data_on_file": q("SELECT count(*) FROM buildings WHERE city=? AND segment IS NOT NULL AND data_on_file"),
            }
        else:
            meta["headline"] = {
                "violations": sum(segment.values()),
                "did_not_report": segment.get("did_not_report", 0),
                "insufficient_data": segment.get("insufficient_data", 0),
                "complied": status.get("complied", 0),
                "exempt": status.get("exempt", 0),
                "lapsed": history.get("lapsed", 0),
                "chronic": history.get("chronic", 0),
                "other": history.get("other", 0),
                "city_owned": owned,
                "audit_overdue": q("SELECT count(*) FROM buildings WHERE city=? AND audit_overdue"),
                "violation_and_audit_overdue": q("SELECT count(*) FROM buildings WHERE city=? AND segment IS NOT NULL AND audit_overdue"),
            }
            # The verbatim labels behind the headline numbers.
            meta["headline_labels"] = {
                "did_not_report": f"{year} - Violation - Did Not Report",
                "insufficient_data": f"{year} - Violation - Insufficient Data",
            }
        # What the report year means. LA's note waits for the same founder
        # sign-off as LA's outreach lines.
        note = YEAR_NOTES.get(city, {}).get(year)
        if city == "LA" and not LA_OUTREACH_APPROVED:
            note = None
        meta["year_note"] = note["text"] if note else None
        meta["year_note_url"] = note["url"] if note else None
        out[city] = meta
    return out


BUILDING_FIELDS = (
    "id", "city", "source_key", "address", "alt_name", "postal_code", "size_band", "size_band_raw",
    "size_rank", "floor_area_sqft", "property_type", "year_built", "city_owned", "city_owned_basis",
    "parcel", "pim_link", "first_year", "latest_year", "report_year", "report_status",
    "report_status_raw", "history", "segment", "priority", "data_on_file", "audit_overdue",
    "last_filed_by", "last_filed_by_note", "last_filed_year",
    "same_address_others", "same_address_complied", "same_address_ids",
)
# Published per filing. filed_by_raw stays in the database: it can name people.
FILING_FIELDS = (
    "building_id", "year", "status_raw", "status", "filed_by", "filed_by_note", "reason_for_exemption",
    "energy_star_score", "site_eui", "source_url",
)
BOOL_FIELDS = ("city_owned", "data_on_file", "audit_overdue")


def building_records(con) -> dict[str, dict]:
    filings = defaultdict(list)
    for f in rows(con, f"SELECT {', '.join(FILING_FIELDS)} FROM filings ORDER BY building_id, year DESC"):
        bid = f.pop("building_id")
        filings[bid].append(f)
    audits = {a.pop("building_id"): a for a in rows(con, "SELECT * FROM audits")}
    records = {}
    for b in rows(con, f"SELECT {', '.join(BUILDING_FIELDS)} FROM buildings"):
        for field in BOOL_FIELDS:
            if b[field] is not None:
                b[field] = bool(b[field])
        ids = b.pop("same_address_ids")
        others = b.pop("same_address_others")
        complied = b.pop("same_address_complied")
        b["same_address"] = {"others": others, "complied": complied, "ids": json.loads(ids)} if others else None
        b["filings"] = filings[b["id"]]
        b["audit"] = audits.get(b["id"])
        records[b["id"]] = b
    return records


def search_docs(records: dict[str, dict]) -> list[dict]:
    """Just enough per building to search and to show a result line."""
    docs = []
    for b in records.values():
        newest = b["filings"][0]
        doc = {
            "id": b["id"],
            "city": b["city"],
            "address": b["address"],
            "key": b["source_key"],
            "zip": b["postal_code"],
            "status": b["report_status_raw"] or newest["status_raw"],
            "year": b["report_year"] if b["report_status_raw"] else newest["year"],
        }
        # Only keep an SF building name that adds something beyond the address.
        if b["alt_name"] and b["alt_name"].strip().lower() != b["address"].strip().lower():
            doc["name"] = b["alt_name"]
        docs.append(doc)
    docs.sort(key=lambda d: d["id"])
    return docs


PRIORITY_ORDER = {"A": 0, "B": 1, "excluded": 2}
HISTORY_ORDER = {"lapsed": 0, "other": 1, "chronic": 2}


def prospect_rows(records: dict[str, dict]) -> list[dict]:
    """Every report-year non-complier, sorted by priority, then size (largest first).

    City-owned buildings are included with priority 'excluded'; the page hides
    them unless asked. Ties within a size band go lapsed, other, chronic, then
    larger floor area first.
    """
    out = []
    for b in records.values():
        if not b["segment"]:
            continue
        filing = next(f for f in b["filings"] if f["year"] == b["report_year"])
        audit = b["audit"] or {}
        name = b["alt_name"] if b["alt_name"] and b["alt_name"].strip().lower() != b["address"].strip().lower() else None
        out.append({
            "id": b["id"],
            "city": b["city"],
            "address": b["address"],
            "name": name,
            "size_band": b["size_band"],
            "size_rank": b["size_rank"],
            "floor_area": b["floor_area_sqft"],
            "segment": b["segment"],
            "history": b["history"],
            "priority": b["priority"],
            "status_raw": filing["status_raw"],
            "year": b["report_year"],
            "last_filed_by": b["last_filed_by"],
            "last_filed_by_note": b["last_filed_by_note"],
            "last_filed_year": b["last_filed_year"],
            "same_address_others": (b["same_address"] or {}).get("others", 0),
            "same_address_complied": (b["same_address"] or {}).get("complied", 0),
            "audit_status": audit.get("status_raw"),
            "audit_due": audit.get("due_date"),
            "data_on_file": b["data_on_file"],
            "audit_overdue": b["audit_overdue"],
            "city_owned": b["city_owned"],
            "source_url": filing["source_url"],
            "outreach_line": b["outreach"]["line"],
        })
    out.sort(key=lambda r: (
        PRIORITY_ORDER[r["priority"]], -r["size_rank"], HISTORY_ORDER[r["history"]],
        -(r["floor_area"] or 0), r["address"], r["id"],
    ))
    return out


def write_json(path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":"), ensure_ascii=False))


def export(out_dir=OUT, extra_files=None) -> dict:
    con = sqlite3.connect(DB_PATH)
    records = building_records(con)
    built = datetime.now(timezone.utc)
    meta = {
        "built_at": built.isoformat(timespec="seconds"),
        "built_date_pt": built.astimezone(PACIFIC).date().isoformat(),
        "shard_count": SHARD_COUNT,
        "cities": city_meta(con),
        "flags": {
            "la_outreach_approved": LA_OUTREACH_APPROVED,
            "sf_due_date_confirmed": SF_DUE_DATE_CONFIRMED,
            "la_held_reason": LA_HELD_REASON.format(year=REPORT_YEAR["LA"]),
            "la_live_status_url": LA_LIVE_STATUS_URL.format(year=REPORT_YEAR["LA"]),
        },
    }
    con.close()
    for b in records.values():
        b["outreach"] = outreach_for(b, meta["cities"][b["city"]]["as_of_label"])
    extra_files = {"prospects.json": prospect_rows(records), **(extra_files or {})}

    # Build into a temp folder and swap it in, so the site never sees half a build.
    tmp = out_dir.with_name(out_dir.name + ".tmp")
    if tmp.exists():
        shutil.rmtree(tmp)
    shards = defaultdict(dict)
    for bid, record in records.items():
        shards[shard_of(bid)][bid] = record
    for shard, members in shards.items():
        write_json(tmp / "b" / f"{shard}.json", members)
    write_json(tmp / "search.json", search_docs(records))
    for name, data in extra_files.items():
        write_json(tmp / name, data)
    write_json(tmp / "meta.json", meta)
    # Move the old build aside before the new one takes its place, so the
    # folder is never missing, then delete the old one.
    old = out_dir.with_name(out_dir.name + ".old")
    if old.exists():
        shutil.rmtree(old)
    if out_dir.exists():
        os.replace(out_dir, old)
    os.replace(tmp, out_dir)
    if old.exists():
        shutil.rmtree(old)
    return {"meta": meta, "records": records}


def main(argv=None) -> int:
    result = export()
    sizes = {p.name: p.stat().st_size for p in OUT.glob("*.json")}
    print(f"wrote {len(result['records']):,} buildings to {OUT}")
    for name, size in sorted(sizes.items()):
        print(f"  {name:<16} {size / 1024:,.0f} KB")
    shard_sizes = [p.stat().st_size for p in (OUT / "b").glob("*.json")]
    print(f"  b/*.json         {len(shard_sizes)} files, largest {max(shard_sizes) / 1024:,.0f} KB")
    for city, m in result["meta"]["cities"].items():
        print(f"  {city}: data as of {m['as_of_label']} (city update {m['rows_updated_at']}), checked {m['checked_label']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
