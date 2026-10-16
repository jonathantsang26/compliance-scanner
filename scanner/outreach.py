"""One-line, source-linked outreach openers (SPEC.md "Outreach line templates").

    python -m scanner.outreach --sample 8    # print example lines for review

Rules these templates follow (SPEC.md Guardrails):
- Quote the city's status label exactly. An LA building is "NOT COMPLIED",
  never "not filed": 624 LA non-compliers did send benchmark data.
- Every line carries the as-of date of the city's data and ends with the
  row-level source link, so a pasted line can be checked on its own.
- No penalty amounts or fine language. No personal names: a filer name goes
  into a line only when scanner.classify.filer_name lets it be published.
- City-owned buildings get no line; they are excluded from outreach.
The product only writes these lines. It never sends anything.
"""

import argparse
import sqlite3
import sys

from .config import DB_PATH, LA_OUTREACH_APPROVED, SF_DUE_DATE_CONFIRMED, SF_DUE_DATE_SENTENCES

# Shown on public pages, so it names no internal file and no unconfirmed date.
LA_HELD_REASON = "LA outreach lines are held until the founder signs off on what LADBS's program year {year} covers."
CITY_OWNED_REASON = "City-owned building: kept out of outreach."


def clean_address(address: str) -> str:
    """Drop stray trailing punctuation the city left on an address ('2544 Mission St,')."""
    return address.strip().rstrip(",;:").strip()


def la_line(address: str, year: int, as_of_label: str, segment: str, last_filed_by: str | None,
            last_filed_year: int | None, source_url: str) -> str:
    line = f"LADBS's public EBEWE data (as of {as_of_label}) lists {clean_address(address)} as NOT COMPLIED for program year {year}."
    if segment == "lapsed" and last_filed_year == year - 1:
        line += f" It was listed as COMPLIED for {year - 1}" + (f", filed by {last_filed_by}" if last_filed_by else "")
        line += "" if line.endswith(".") else "."  # "Vert Energy Group, Inc." already ends the sentence
    return f"{line} Source: {source_url}"


def sf_line(address: str, status_raw: str, as_of_label: str, segment: str, year: int, source_url: str,
            due_date_confirmed: bool = SF_DUE_DATE_CONFIRMED) -> str:
    line = f"SF Environment's public data (as of {as_of_label}) lists {clean_address(address)} as '{status_raw}'."
    sentence = SF_DUE_DATE_SENTENCES.get(year)
    if segment == "did_not_report" and due_date_confirmed and sentence:
        line += f" {sentence}"
    return f"{line} Source: {source_url}"


def outreach_for(b: dict, as_of_label: str, la_approved: bool = LA_OUTREACH_APPROVED,
                 sf_due_date_confirmed: bool = SF_DUE_DATE_CONFIRMED) -> dict | None:
    """The outreach block for a building, or None if it is not a prospect.

    Returns {"line": str | None, "held_reason": str | None, "source_url": str}.
    A held line is None, so it never reaches the published JSON or the CSV.
    """
    if not b.get("segment"):
        return None
    year = b["report_year"]
    filing = next(f for f in b["filings"] if f["year"] == year)
    source_url = filing["source_url"]
    if b.get("city_owned"):
        return {"line": None, "held_reason": CITY_OWNED_REASON, "source_url": source_url}
    if b["city"] == "LA":
        if not la_approved:
            reason = LA_HELD_REASON.format(year=year)
            return {"line": None, "held_reason": reason, "source_url": source_url}
        line = la_line(b["address"], year, as_of_label, b["segment"], b.get("last_filed_by"),
                       b.get("last_filed_year"), source_url)
    else:
        line = sf_line(b["address"], filing["status_raw"], as_of_label, b["segment"], year, source_url,
                       sf_due_date_confirmed)
    return {"line": line, "held_reason": None, "source_url": source_url}


def main(argv=None) -> int:
    """Print sample lines with the LA gate open, for the founder to review."""
    parser = argparse.ArgumentParser(description=main.__doc__)
    parser.add_argument("--sample", type=int, default=6, help="lines per segment")
    args = parser.parse_args(argv)
    from .export import building_records, city_meta  # avoid an import loop

    con = sqlite3.connect(DB_PATH)
    meta = city_meta(con)
    records = building_records(con)
    con.close()
    print("PREVIEW ONLY. LA lines are not published until config.LA_OUTREACH_APPROVED is True.\n")
    for city in ("LA", "SF"):
        label = meta[city]["as_of_label"]
        for segment in ("lapsed", "chronic", "other", "did_not_report", "insufficient_data"):
            picks = [b for b in records.values() if b["city"] == city and b["segment"] == segment
                     and not b["city_owned"]][: args.sample]
            if not picks:
                continue
            print(f"--- {city} {segment}")
            for b in picks:
                print(outreach_for(b, label, la_approved=True)["line"])
            print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
