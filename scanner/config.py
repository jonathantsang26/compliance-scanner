"""Settings shared by every step: which datasets, which fields, where files go."""

from dataclasses import dataclass
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
RAW = DATA / "raw"
DB_PATH = DATA / "scanner.db"
SITE = ROOT / "site"
EXPECTED_PATH = Path(__file__).resolve().parent / "expected.json"

# Both cities publish in Pacific time. The spec's as-of dates (LA 2026-10-11,
# SF 2026-10-09) are Pacific dates, so we show dates in this zone too.
PACIFIC = ZoneInfo("America/Los_Angeles")

# The year the scanner reports on, per city. Pinned on purpose: when a city
# starts publishing a new year, its first rows can make almost every building
# look non-compliant. Rolling forward is the founder's call, so the build only
# warns when it sees a newer year. To roll forward: change the year here, add
# that year's entries to YEAR_NOTES and SF_DUE_DATE_SENTENCES, then re-pin
# scanner/expected.json from a fresh `python -m scanner.counts`.
REPORT_YEAR = {"LA": 2025, "SF": 2025}

# What each city's report year means, with the source that says so
# (docs/research/benchmark-year.md, researched 2026-10-15).
YEAR_NOTES = {
    "LA": {
        2025: {
            "text": "Program year 2025 covers calendar-2025 energy and water use. LADBS says it was due June 1, 2026.",
            "url": "https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/Benchmark-What%27s-New-FINAL.pdf",
        },
    },
    "SF": {
        2025: {
            "text": "Benchmark year 2025 covers calendar-2025 energy use. SF Environment says it was due May 1, 2026.",
            "url": "https://www.sfenvironment.org/existing-buildings-energy-performance-ordinance",
        },
    },
}

# Founder sign-off gates (SPEC.md, Milestone 4).
#   LA_OUTREACH_APPROVED: the founder signs off on what LA's program year
#     means (research says calendar-2025 data, due June 1, 2026). Until then
#     LA outreach lines (and the LA year note) are generated and tested but
#     never published or exported.
#   SF_DUE_DATE_CONFIRMED: SF Environment's page says "The 2025 Annual Energy
#     Benchmark is due May 1, 2026." (confirmed 2026-10-15). The city code still
#     says April 1, so the sentence credits SF Environment instead of stating
#     the date as law.
LA_OUTREACH_APPROVED = False
SF_DUE_DATE_CONFIRMED = True
SF_DUE_DATE_SENTENCES = {
    2025: "SF Environment says the 2025 Annual Energy Benchmark was due May 1, 2026.",
}

# LADBS's live status page runs a few days ahead of the open data. Check a
# building there by hand before sending it an LA line.
LA_LIVE_STATUS_URL = "https://www.ladbsservices2.lacity.org/EBEWECompliance/Default/Index1?syear={year}"


@dataclass(frozen=True)
class Dataset:
    city: str
    domain: str
    resource: str
    year_field: str
    key_field: str
    fields: tuple[str, ...]

    @property
    def resource_url(self) -> str:
        return f"https://{self.domain}/resource/{self.resource}.json"

    @property
    def views_url(self) -> str:
        return f"https://{self.domain}/api/views/{self.resource}.json"


LA = Dataset(
    city="LA",
    domain="data.lacity.org",
    resource="9yda-i4ya",
    year_field="program_year",
    key_field="building_id",
    fields=(
        "building_id",
        "program_year",
        "compliance",
        "building_address",
        "postal_code",
        "building_programclass",
        "organization",
        "apn",
        "property_gfa_1",
        "primary_property_1",
        "energy_star_score",
        "site_eui",
        "year_built",
    ),
)

# data.sfgov.org now redirects here, so we use the new host directly.
SF = Dataset(
    city="SF",
    domain="data.sf.gov",
    resource="96ck-qcfe",
    year_field="benchmark_year",
    key_field="parcel_number",
    fields=(
        "unique_identifier",
        "parcel_number",
        "benchmark_year",
        "benchmark_status",
        "building_name",
        "building_address",
        "postal_code",
        "floor_area",
        "property_type",
        "category",
        "reason_for_exemption",
        "pim_link",
        "latitude",
        "longitude",
        "data_as_of",
        "energy_audit_status",
        "energy_audit_due_date",
        "energy_star_score",
        "site_eui",
        "year_built",
    ),
)

DATASETS = {"LA": LA, "SF": SF}
