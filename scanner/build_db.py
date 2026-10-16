"""Milestone 2: load the four tables into SQLite and assign segments and flags.

    python -m scanner.build_db

Reads the newest raw snapshot for each city (scanner.pull writes them) and
rebuilds data/scanner.db from scratch, then prints the segment counts. It
stops without replacing the database if LA's city-owned label looks broken
(see city_owned_problems).
"""

import json
import os
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from urllib.parse import quote

from . import counts as raw_counts
from .classify import (
    NON_COMPLIANT,
    SIZE_RANK,
    UnknownLabel,
    area_fits_band,
    audit_status,
    filer_name,
    history_segment,
    la_city_owned,
    la_size_band,
    la_status,
    present,
    sf_city_owned,
    sf_size_band,
    sf_status,
    to_float,
    to_int,
)
from .config import DB_PATH, LA, RAW, REPORT_YEAR, SF
from .snapshot import load_latest

SCHEMA = """
CREATE TABLE buildings (
    id                  TEXT PRIMARY KEY,   -- 'la:<building_id>' or 'sf:<parcel_number>'
    city                TEXT NOT NULL,      -- 'LA' or 'SF'
    source_key          TEXT NOT NULL,      -- the city's own building key
    address             TEXT NOT NULL,
    alt_name            TEXT,               -- SF building_name
    postal_code         TEXT,
    size_band           TEXT NOT NULL,
    size_band_raw       TEXT,               -- LA building_programclass, verbatim
    size_rank           INTEGER NOT NULL,   -- bigger band = bigger number
    floor_area_sqft     INTEGER,            -- only when it fits the size band
    floor_area_reported INTEGER,            -- LA self-reported area, even when it doesn't fit (not published)
    property_type       TEXT,
    year_built          INTEGER,
    city_owned          INTEGER NOT NULL,
    city_owned_basis    TEXT,               -- why we think it is city-owned
    parcel              TEXT,               -- LA: last 3 digits only
    pim_link            TEXT,
    latitude            REAL,
    longitude           REAL,
    first_year          INTEGER NOT NULL,
    latest_year         INTEGER NOT NULL,
    -- classification for the report year (config.REPORT_YEAR)
    report_year         INTEGER NOT NULL,
    report_status       TEXT,               -- NULL when the building has no row that year
    report_status_raw   TEXT,
    history             TEXT,               -- lapsed / chronic / other, for non-compliers
    segment             TEXT,               -- LA: = history. SF: did_not_report / insufficient_data
    priority            TEXT,               -- 'A', 'B', 'excluded' (city-owned), or NULL
    data_on_file        INTEGER,            -- LA only: report-year row has organization or site_eui
    audit_overdue       INTEGER,            -- SF only: audit status Did Not Comply
    last_filed_by       TEXT,               -- LA: entity on the newest COMPLIED row, if publishable
    last_filed_by_note  TEXT,               -- 'withheld' when that entity may name a person
    last_filed_by_raw   TEXT,               -- the city's value (not published)
    last_filed_year     INTEGER,
    same_address_others   INTEGER,          -- other report-year records at this address, same city
    same_address_complied INTEGER,          -- how many of those are compliant
    same_address_ids      TEXT              -- JSON list of those records' ids
);
CREATE TABLE filings (
    building_id          TEXT NOT NULL REFERENCES buildings(id),
    year                 INTEGER NOT NULL,
    status_raw           TEXT NOT NULL,     -- the city's label, verbatim
    status               TEXT NOT NULL,     -- complied / not_complied / did_not_report / insufficient_data / exempt / other
    filed_by             TEXT,              -- LA organization, if publishable; NULL for SF
    filed_by_note        TEXT,              -- 'withheld' when the organization may name a person
    filed_by_raw         TEXT,              -- the city's value (not published)
    reason_for_exemption TEXT,              -- SF, verbatim
    energy_star_score    INTEGER,
    site_eui             REAL,
    source_url           TEXT NOT NULL,     -- API URL that returns exactly this row
    PRIMARY KEY (building_id, year)
);
CREATE TABLE audits (
    building_id       TEXT PRIMARY KEY REFERENCES buildings(id),
    due_date          TEXT,
    status_raw        TEXT,
    status            TEXT NOT NULL       -- upcoming / did_not_comply / pending / exempt / complied / none
);
CREATE TABLE pulls (
    dataset           TEXT NOT NULL,      -- 'LA' or 'SF'
    stamp             TEXT NOT NULL,
    rows_updated_at   TEXT NOT NULL,      -- when the city last changed rows (UTC)
    fetched_at        TEXT NOT NULL,      -- when we downloaded them (UTC)
    checked_at        TEXT NOT NULL,      -- last time a run confirmed this is still the newest data (UTC)
    data_as_of        TEXT,               -- SF's own per-row data_as_of (newest), verbatim
    row_count         INTEGER NOT NULL,
    resource_url      TEXT NOT NULL,
    sha256            TEXT NOT NULL,
    app_token_used    INTEGER NOT NULL,
    is_current        INTEGER NOT NULL,   -- the snapshot this database was built from
    PRIMARY KEY (dataset, stamp)
);
CREATE INDEX filings_year ON filings(year, status);
"""


def la_source_url(building_id: str, year: int) -> str:
    return f"{LA.resource_url}?building_id={quote(building_id)}&program_year={year}"


def sf_source_url(parcel: str, year: int) -> str:
    return f"{SF.resource_url}?unique_identifier={quote(f'{parcel}_{year}', safe='/')}"


def newest_value(rows: list[dict], field: str):
    """The field from the newest row that has it (rows sorted oldest first)."""
    for row in reversed(rows):
        if present(row.get(field)):
            return row[field]
    return None


def anchored(rows: list[dict], report_row: dict | None, field: str, city: str, key: str, required: bool = False):
    """A building-level field: from the report-year row when it has one, else the newest row that does.

    The report-year row wins so that a sparse row from a newly opened year
    can't change a building's address, size band or city-owned label.
    """
    if report_row is not None and present(report_row.get(field)):
        return report_row[field]
    value = newest_value(rows, field)
    if value is None and required:
        raise UnknownLabel(f"{city} {key}: no row has {field}")
    return value


def build_la(rows: list[dict], report_year: int) -> tuple[list[dict], list[dict]]:
    by_building = defaultdict(list)
    for row in rows:
        by_building[row["building_id"]].append(row)

    buildings, filings = [], []
    for source_key, rs in by_building.items():
        rs.sort(key=lambda r: int(r["program_year"]))
        bid = f"la:{source_key}"
        statuses = {}
        for r in rs:
            year = int(r["program_year"])
            statuses[year] = la_status(r["compliance"])
            name, note = filer_name(r.get("organization"))
            filings.append({
                "building_id": bid,
                "year": year,
                "status_raw": r["compliance"],
                "status": statuses[year],
                "filed_by": name,
                "filed_by_note": note,
                "filed_by_raw": r.get("organization"),
                "reason_for_exemption": None,
                "energy_star_score": to_int(r.get("energy_star_score")),
                "site_eui": to_float(r.get("site_eui")),
                "source_url": la_source_url(source_key, year),
            })

        report_row = next((r for r in rs if int(r["program_year"]) == report_year), None)
        programclass = anchored(rs, report_row, "building_programclass", "LA", source_key, required=True)
        band = la_size_band(programclass)
        city_owned = la_city_owned(programclass)
        history = history_segment(statuses, report_year)
        complied = [r for r in rs if r["compliance"] == "COMPLIED" and int(r["program_year"]) <= report_year]
        last_complied = complied[-1] if complied else None
        last_name, last_note = filer_name(last_complied.get("organization")) if last_complied else (None, None)
        if history is None:
            priority = None
        elif city_owned:
            priority = "excluded"
        else:
            priority = "A" if history == "lapsed" else "B"
        reported_area = to_int(newest_value(rs, "property_gfa_1"))
        buildings.append({
            "id": bid,
            "city": "LA",
            "source_key": source_key,
            "address": anchored(rs, report_row, "building_address", "LA", source_key, required=True),
            "alt_name": None,
            "postal_code": anchored(rs, report_row, "postal_code", "LA", source_key),
            "size_band": band,
            "size_band_raw": programclass,
            "size_rank": SIZE_RANK[band],
            # Self-reported areas sometimes contradict LADBS's own band (1 sq ft in
            # the 100,000+ band); those are kept out of the published data.
            "floor_area_sqft": reported_area if area_fits_band(reported_area, band) else None,
            "floor_area_reported": reported_area,
            "property_type": newest_value(rs, "primary_property_1"),
            "year_built": to_int(newest_value(rs, "year_built")),
            "city_owned": city_owned,
            "city_owned_basis": "CITY OWNED size-band suffix" if city_owned else None,
            "parcel": anchored(rs, report_row, "apn", "LA", source_key),
            "pim_link": None,
            "latitude": None,
            "longitude": None,
            "first_year": int(rs[0]["program_year"]),
            "latest_year": int(rs[-1]["program_year"]),
            "report_year": report_year,
            "report_status": statuses.get(report_year),
            "report_status_raw": report_row["compliance"] if report_row else None,
            "history": history,
            "segment": history,
            "priority": priority,
            "data_on_file": (
                present(report_row.get("organization")) or present(report_row.get("site_eui"))
            ) if report_row else None,
            "audit_overdue": None,
            "last_filed_by": last_name,
            "last_filed_by_note": last_note,
            "last_filed_by_raw": last_complied.get("organization") if last_complied else None,
            "last_filed_year": int(last_complied["program_year"]) if last_complied else None,
        })
    return buildings, filings


def build_sf(rows: list[dict], report_year: int) -> tuple[list[dict], list[dict], list[dict]]:
    by_parcel = defaultdict(list)
    for row in rows:
        by_parcel[row["parcel_number"]].append(row)

    buildings, filings, audits = [], [], []
    for parcel, rs in by_parcel.items():
        rs.sort(key=lambda r: int(r["benchmark_year"]))
        bid = f"sf:{parcel}"
        statuses = {}
        for r in rs:
            year = int(r["benchmark_year"])
            statuses[year] = sf_status(r["benchmark_status"], year)
            reason = r.get("reason_for_exemption")
            filings.append({
                "building_id": bid,
                "year": year,
                "status_raw": r["benchmark_status"],
                "status": statuses[year],
                "filed_by": None,
                "filed_by_note": None,
                "filed_by_raw": None,
                "reason_for_exemption": reason if present(reason) else None,
                "energy_star_score": to_int(r.get("energy_star_score")),
                "site_eui": to_float(r.get("site_eui")),
                "source_url": sf_source_url(parcel, year),
            })

        # SF repeats the building's details and current audit on every year's
        # row (DRIFT.md item 11), so the report-year row (or newest) speaks for it.
        report_row = next((r for r in rs if int(r["benchmark_year"]) == report_year), None)
        anchor = report_row or rs[-1]
        audit_raw = anchor.get("energy_audit_status")
        audit = audit_status(audit_raw)
        due = anchor.get("energy_audit_due_date")
        audits.append({
            "building_id": bid,
            "due_date": due[:10] if present(due) else None,
            "status_raw": audit_raw if present(audit_raw) else None,
            "status": audit,
        })

        report_status = statuses.get(report_year)
        history = history_segment(statuses, report_year)
        segment = report_status if report_status in NON_COMPLIANT else None
        owned_basis = sf_city_owned(anchor.get("property_type"), audit_raw)
        if segment is None:
            priority = None
        else:
            priority = "excluded" if owned_basis else "A"
        floor_area = to_int(anchored(rs, report_row, "floor_area", "SF", parcel))
        band = sf_size_band(floor_area)
        type_parts = [p for p in (anchor.get("category"), anchor.get("property_type")) if present(p)]
        pim = anchor.get("pim_link")
        buildings.append({
            "id": bid,
            "city": "SF",
            "source_key": parcel,
            "address": anchored(rs, report_row, "building_address", "SF", parcel, required=True),
            "alt_name": anchored(rs, report_row, "building_name", "SF", parcel),
            "postal_code": anchored(rs, report_row, "postal_code", "SF", parcel),
            "size_band": band,
            "size_band_raw": None,
            "size_rank": SIZE_RANK[band],
            "floor_area_sqft": floor_area,
            "floor_area_reported": floor_area,
            "property_type": " · ".join(type_parts) or None,
            "year_built": to_int(anchored(rs, report_row, "year_built", "SF", parcel)),
            "city_owned": owned_basis is not None,
            "city_owned_basis": owned_basis,
            "parcel": parcel,
            "pim_link": pim.get("url") if isinstance(pim, dict) else pim,
            "latitude": to_float(anchor.get("latitude")),
            "longitude": to_float(anchor.get("longitude")),
            "first_year": int(rs[0]["benchmark_year"]),
            "latest_year": int(rs[-1]["benchmark_year"]),
            "report_year": report_year,
            "report_status": report_status,
            "report_status_raw": report_row["benchmark_status"] if report_row else None,
            "history": history,
            "segment": segment,
            "priority": priority,
            "data_on_file": None,
            "audit_overdue": audit == "did_not_comply",
            "last_filed_by": None,
            "last_filed_by_note": None,
            "last_filed_by_raw": None,
            "last_filed_year": None,
        })
    return buildings, filings, audits


# LA covers city buildings from 7,500 sqft and private ones from 20,000 sqft,
# so these two bands only ever carry the city-owned suffix (DRIFT.md item 3).
LA_CITY_ONLY_BANDS = ("7,500 to 14,999 sqft", "15,000 to 19,999 sqft")


def city_owned_problems(la_buildings: list[dict]) -> list[str]:
    """Why LA's city-owned label can't be trusted on this snapshot (empty when it can).

    The label comes only from the size-band suffix, and scanner.counts reads
    the same suffix. So if LADBS dropped it, every count would still agree
    while city buildings turned into prospects. Two facts that hold in every
    year of the data catch that.
    """
    problems = []
    unlabeled = [b for b in la_buildings if b["size_band"] in LA_CITY_ONLY_BANDS and not b["city_owned"]]
    if unlabeled:
        examples = ", ".join(f"{b['id']} ({b['size_band_raw']!r})" for b in unlabeled[:3])
        problems.append(
            f"{len(unlabeled):,} LA buildings in the {' or '.join(LA_CITY_ONLY_BANDS)} band have no city-owned "
            f"suffix, e.g. {examples}. LADBS uses those bands only for city buildings (DRIFT.md item 3).")
    if not any(b["city_owned"] for b in la_buildings):
        problems.append("No LA building has the city-owned size-band suffix.")
    return problems


# Same-address matching. These only compare addresses; the address shown
# everywhere stays the city's own text.
DIRECTIONALS = {"N", "S", "E", "W"}
STREET_TYPES = {"ST", "AVE", "BLVD", "DR", "RD", "WAY", "PL", "LN", "CT", "CIR", "TER", "PKWY", "HWY", "PLZ"}
SPELLED_STREET_TYPES = {"STREET": "ST", "AVENUE": "AVE", "AV": "AVE", "BOULEVARD": "BLVD", "DRIVE": "DR", "ROAD": "RD"}
_UNIT = re.compile(r"\s*(#|\b(UNIT|STE|SUITE|APT)\b).*$")
_SF_SIDE = re.compile(r"\s+-\s*(NORTH|SOUTH|EAST|WEST)$")  # '350 RHODE ISLAND ST - SOUTH'


def base_address(address: str) -> str:
    """The address without a unit or an SF-style ' - NORTH' suffix: '3450 3rd St #2 A' -> '3450 3RD ST'."""
    text = re.sub(r"\s+", " ", address.upper().replace(".", "")).strip(" ,;:")
    text = _UNIT.sub("", text).strip(" ,;:")
    return _SF_SIDE.sub("", text).strip(" ,;:")


def address_parts(address: str) -> tuple[str, str | None, str | None]:
    """(house number and street name, directional, street type) of the base address.

    '11150 W SANTA MONICA BLVD' -> ('11150 SANTA MONICA', 'W', 'BLVD'). Only a
    lone N/S/E/W right after the house number counts as a directional, so
    'WEST BLVD' and 'CAHUENGA BLVD WEST' stay street names.
    """
    words = base_address(address).split()
    directional = street_type = None
    if len(words) >= 3 and words[0][0].isdigit() and words[1] in DIRECTIONALS:
        directional = words.pop(1)
    last = SPELLED_STREET_TYPES.get(words[-1], words[-1]) if words else None
    if len(words) >= 3 and last in STREET_TYPES:  # a street name must be left
        street_type = last
        words.pop()
    return " ".join(words), directional, street_type


def zip5(postal_code) -> str | None:
    """'94118' or 'CA 94118' -> '94118'."""
    found = re.search(r"\d{5}", str(postal_code or ""))
    return found.group(0) if found else None


def agree(a, b) -> bool:
    """The same value, or one side doesn't give it."""
    return a == b or a is None or b is None


def has_street(street: str) -> bool:
    """A house number and a street word. Pier numbers ('THE EMBARCADERO #0001'), a
    unit alone, or a street cut short ('100 STE MARIE AVE' -> '100') don't group."""
    words = street.split()
    return len(words) >= 2 and words[0][0].isdigit()


def add_same_address(buildings: list[dict]) -> None:
    """Flag records that share an address with other records listed for the report year.

    An owner who looks up "865 MARKET ST" may find a compliant parcel next to
    the one we list (DRIFT.md item 14), so these rows deserve a second look
    before outreach. Two records in a city share an address when the house
    number and street name match, the unit and SF's ' - NORTH' suffix are left
    out, and the directional, the street type and the ZIP each agree or are
    missing on one side. So '6222 W WILSHIRE BLVD' matches '6222 WILSHIRE BLVD',
    but never '6222 E WILSHIRE BLVD'. That isn't transitive (both match the
    plain one), so each record gets its own list.
    """
    listed = [b for b in buildings if b["report_status"] is not None]
    parts = {b["id"]: (*address_parts(b["address"]), zip5(b.get("postal_code"))) for b in listed}
    by_street = defaultdict(list)
    for b in listed:
        by_street[(b["city"], parts[b["id"]][0])].append(b)
    for b in buildings:
        others = []
        if b["report_status"] is not None and has_street(parts[b["id"]][0]):
            street, directional, street_type, zip_code = parts[b["id"]]
            others = [
                o for o in by_street[(b["city"], street)]
                if o["id"] != b["id"] and agree(directional, parts[o["id"]][1])
                and agree(street_type, parts[o["id"]][2]) and agree(zip_code, parts[o["id"]][3])
            ]
        b["same_address_others"] = len(others)
        b["same_address_complied"] = sum(1 for o in others if o["report_status"] == "complied")
        b["same_address_ids"] = json.dumps(sorted(o["id"] for o in others)) if others else None


def pull_rows(current: dict[str, str], data_as_of: dict[str, str | None]) -> list[dict]:
    """Every snapshot manifest on disk, marking the ones this build uses."""
    rows = []
    for city in ("LA", "SF"):
        for manifest_path in sorted((RAW / city).glob("*/manifest.json")):
            m = json.loads(manifest_path.read_text())
            rows.append({
                "dataset": m["dataset"],
                "stamp": m["stamp"],
                "rows_updated_at": m["rows_updated_at"],
                "fetched_at": m["fetched_at"],
                "checked_at": m.get("checked_at") or m["fetched_at"],
                "data_as_of": data_as_of.get(city) if m["stamp"] == current[city] else None,
                "row_count": m["row_count"],
                "resource_url": m["resource_url"],
                "sha256": m["sha256"],
                "app_token_used": m["app_token_used"],
                "is_current": m["stamp"] == current[city],
            })
    return rows


def write_db(path, buildings, filings, audits, pulls) -> None:
    tmp = path.with_suffix(".db.tmp")
    tmp.unlink(missing_ok=True)
    con = sqlite3.connect(tmp)
    con.executescript(SCHEMA)
    for table, rows in (("buildings", buildings), ("filings", filings), ("audits", audits), ("pulls", pulls)):
        cols = list(rows[0])
        con.executemany(
            f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({', '.join('?' * len(cols))})",
            [tuple(r[c] for c in cols) for r in rows],
        )
    con.commit()
    con.close()
    os.replace(tmp, path)


def warn_newer_years(city: str, rows: list[dict], year_field: str, report_year: int) -> None:
    newer = sorted({int(r[year_field]) for r in rows if int(r[year_field]) > report_year})
    if newer:
        print(f"WARNING: {city} now publishes year(s) {newer}; the report year is still pinned to {report_year} "
              f"(config.REPORT_YEAR). Rolling forward is a founder decision.", file=sys.stderr)


def checkpoint(db_path) -> dict:
    """Recount segments from the database itself and print them."""
    con = sqlite3.connect(db_path)
    q = lambda sql, *a: con.execute(sql, a).fetchall()  # noqa: E731
    got = {}
    for city in ("LA", "SF"):
        year = REPORT_YEAR[city]
        n_b, n_f = q("SELECT (SELECT count(*) FROM buildings WHERE city=?), "
                     "(SELECT count(*) FROM filings f JOIN buildings b ON b.id=f.building_id WHERE b.city=?)", city, city)[0]
        print(f"\n{city}: {n_b:,} buildings, {n_f:,} filings, report year {year}")
        if city == "LA":
            seg = dict(q("SELECT segment, count(*) FROM buildings WHERE city='LA' AND segment IS NOT NULL GROUP BY segment"))
            seg_private = dict(q("SELECT segment, count(*) FROM buildings WHERE city='LA' AND segment IS NOT NULL AND NOT city_owned GROUP BY segment"))
            pri = dict(q("SELECT priority, count(*) FROM buildings WHERE city='LA' AND priority IS NOT NULL GROUP BY priority"))
            dof = dict(q("SELECT data_on_file, count(*) FROM buildings WHERE city='LA' AND segment IS NOT NULL GROUP BY data_on_file"))
            total = sum(seg.values())
            print(f"  NOT COMPLIED {year}: {total:,} = lapsed {seg.get('lapsed', 0):,} + chronic {seg.get('chronic', 0):,} + other {seg.get('other', 0):,}")
            owned = total - sum(seg_private.values())
            print(f"  city-owned among them: {owned:,} (lapsed {seg.get('lapsed', 0) - seg_private.get('lapsed', 0)}, "
                  f"chronic {seg.get('chronic', 0) - seg_private.get('chronic', 0)}, other {seg.get('other', 0) - seg_private.get('other', 0)})")
            print(f"  excluding city-owned: lapsed {seg_private.get('lapsed', 0):,} + chronic {seg_private.get('chronic', 0):,} "
                  f"+ other {seg_private.get('other', 0):,} = {sum(seg_private.values()):,}")
            print(f"  priority A {pri.get('A', 0):,} · B {pri.get('B', 0):,} · excluded {pri.get('excluded', 0):,}")
            print(f"  data on file {dof.get(1, 0):,} · none {dof.get(0, 0):,}")
            withheld = q("SELECT count(DISTINCT filed_by_raw), count(DISTINCT building_id) FROM filings WHERE filed_by_note='withheld'")[0]
            print(f"  filer names withheld as possibly personal: {withheld[0]:,} distinct values on {withheld[1]:,} buildings")
            got.update({
                "la_not_complied": total,
                "la_lapsed": seg.get("lapsed", 0),
                "la_chronic": seg.get("chronic", 0),
                "la_other": seg.get("other", 0),
                "la_nc_data_on_file": dof.get(1, 0),
                "la_nc_no_data_on_file": dof.get(0, 0),
                "la_nc_city_owned": owned,
                "la_complied": q("SELECT count(*) FROM buildings WHERE city='LA' AND report_status='complied'")[0][0],
                "la_prev_not_complied": q("SELECT count(*) FROM filings WHERE building_id LIKE 'la:%' AND year=? AND status='not_complied'", year - 1)[0][0],
            })
        else:
            seg = dict(q("SELECT segment, count(*) FROM buildings WHERE city='SF' AND segment IS NOT NULL GROUP BY segment"))
            hist = dict(q("SELECT history, count(*) FROM buildings WHERE city='SF' AND segment IS NOT NULL GROUP BY history"))
            pri = dict(q("SELECT priority, count(*) FROM buildings WHERE city='SF' AND priority IS NOT NULL GROUP BY priority"))
            status = dict(q("SELECT report_status, count(*) FROM buildings WHERE city='SF' GROUP BY report_status"))
            audit_dnc = q("SELECT count(*) FROM buildings WHERE city='SF' AND report_status IS NOT NULL AND audit_overdue")[0][0]
            both = q("SELECT count(*) FROM buildings WHERE city='SF' AND segment IS NOT NULL AND audit_overdue")[0][0]
            total = sum(seg.values())
            print(f"  violations {year}: {total:,} = did not report {seg.get('did_not_report', 0):,} + insufficient data {seg.get('insufficient_data', 0):,}")
            print(f"  history: lapsed {hist.get('lapsed', 0):,} · chronic {hist.get('chronic', 0):,} · other {hist.get('other', 0):,}")
            print(f"  priority A {pri.get('A', 0):,} · excluded (city-owned heuristic) {pri.get('excluded', 0):,}")
            print(f"  complied {status.get('complied', 0):,} · exempt {status.get('exempt', 0):,}")
            print(f"  audit Did Not Comply: {audit_dnc:,} (with a {year} violation: {both:,})")
            got.update({
                "sf_did_not_report": seg.get("did_not_report", 0),
                "sf_insufficient_data": seg.get("insufficient_data", 0),
                "sf_complied": status.get("complied", 0),
                "sf_exempt": status.get("exempt", 0),
                "sf_audit_did_not_comply": audit_dnc,
                "sf_violation_and_audit_did_not_comply": both,
            })
    shared = q("SELECT count(*) FROM buildings WHERE segment IS NOT NULL AND same_address_complied > 0")[0][0]
    print(f"\nnon-compliers sharing an address with a compliant record: {shared:,} (flagged for review before outreach)")
    con.close()
    return got


def main(argv=None) -> int:
    la_rows, la_manifest = load_latest("LA")
    sf_rows, sf_manifest = load_latest("SF")
    expected = raw_counts.load_expected()  # stops on a stale pin before the database is touched
    warn_newer_years("LA", la_rows, "program_year", REPORT_YEAR["LA"])
    warn_newer_years("SF", sf_rows, "benchmark_year", REPORT_YEAR["SF"])

    la_buildings, la_filings = build_la(la_rows, REPORT_YEAR["LA"])
    problems = city_owned_problems(la_buildings)
    if problems:
        for problem in problems:
            print(f"error: {problem}", file=sys.stderr)
        print(f"error: LADBS has probably changed how it marks city-owned buildings, so {DB_PATH} was not "
              "replaced. Check building_programclass on the city portal and update classify.la_city_owned "
              "before building again.", file=sys.stderr)
        return 1
    sf_buildings, sf_filings, sf_audits = build_sf(sf_rows, REPORT_YEAR["SF"])
    buildings = la_buildings + sf_buildings
    add_same_address(buildings)
    # SF also stamps every row with its own data_as_of; keep the newest, verbatim.
    sf_as_of = max((r["data_as_of"] for r in sf_rows if present(r.get("data_as_of"))), default=None)
    pulls = pull_rows({"LA": la_manifest["stamp"], "SF": sf_manifest["stamp"]}, {"LA": None, "SF": sf_as_of})
    write_db(DB_PATH, buildings, la_filings + sf_filings, sf_audits, pulls)
    print(f"wrote {DB_PATH}")

    got = checkpoint(DB_PATH)

    # The same numbers, worked out a second way straight from the raw rows.
    independent = {**raw_counts.la_counts(la_rows, REPORT_YEAR["LA"]), **raw_counts.sf_counts(sf_rows, REPORT_YEAR["SF"])}
    disagree = {k: (got[k], independent[k]) for k in independent if got.get(k) != independent[k]}
    results = raw_counts.compare(got, expected["counts"], expected["drift_warn_pct"])
    tally = Counter(r["verdict"] for r in results)
    print(f"\ncross-check with scanner.counts (raw rows): {len(independent) - len(disagree)}/{len(independent)} equal")
    for k, (db, raw) in disagree.items():
        print(f"  DISAGREE {raw_counts.label(k)}: database {db} vs raw {raw}")
    print(f"against SPEC.md expected counts: {dict(tally)}")
    for r in results:
        if r["verdict"] != "MATCH":
            print(f"  {r['verdict']} {raw_counts.label(r['check'])}: expected {r['expected']}, got {r['got']} ({r['drift_pct']}%)")
    return 1 if disagree else 0


if __name__ == "__main__":
    sys.exit(main())
