"""Unit tests for the label mapping and segment rules, on made-up rows."""

import json

import pytest

from scanner.build_db import build_la, build_sf, sf_source_url
from scanner.build_db import add_same_address
from scanner.classify import (
    KNOWN_FILERS,
    UnknownLabel,
    audit_status,
    filer_name,
    history_segment,
    la_city_owned,
    la_size_band,
    looks_personal,
    sf_city_owned,
    sf_size_band,
    sf_status,
)

C, N = "complied", "not_complied"


@pytest.mark.parametrize(
    "history, expected",
    [
        ({2023: N, 2024: C, 2025: N}, "lapsed"),
        ({2024: C, 2025: N}, "lapsed"),
        ({2023: N, 2024: N, 2025: N}, "chronic"),
        ({2023: C, 2024: N, 2025: N}, "other"),
        ({2024: N, 2025: N}, "other"),           # no 2023 row: not three years running
        ({2025: N}, "other"),                    # new to the list
        ({2023: N, 2025: N}, "other"),           # gap in 2024
        ({2024: N, 2025: C}, None),
        ({2024: N}, None),                       # no 2025 row
    ],
)
def test_history_segment(history, expected):
    assert history_segment(history, 2025) == expected


def test_sf_violation_kinds_count_as_non_compliant():
    assert history_segment({2024: "complied", 2025: "did_not_report"}, 2025) == "lapsed"
    assert history_segment({2023: "insufficient_data", 2024: "did_not_report", 2025: "did_not_report"}, 2025) == "chronic"
    assert history_segment({2024: "exempt", 2025: "did_not_report"}, 2025) == "other"


def test_sf_status_parses_year_prefix():
    assert sf_status("2025 - Violation - Did Not Report", 2025) == "did_not_report"
    assert sf_status("2025 - Violation - Insufficient Data", 2025) == "insufficient_data"
    assert sf_status("2017 - Data Not Verified", 2017) == "other"
    with pytest.raises(UnknownLabel):
        sf_status("2024 - Complied", 2025)       # year in the label must match the row
    with pytest.raises(UnknownLabel):
        sf_status("2025 - Violation - Something New", 2025)


def test_la_size_bands_and_city_owned():
    assert la_size_band("7,500 to 14,999 sqft (CITY OWNED BUILDING)") == "7,500 to 14,999 sqft"
    assert la_size_band("100,000+ sqft (CITY OWNED BUILDINGS)") == "100,000+ sqft"
    assert la_size_band("20,000 to 49,999 sqft") == "20,000 to 49,999 sqft"
    assert la_city_owned("50,000 to 99,999 sqft (CITY OWNED BUILDINGS)")
    assert not la_city_owned("50,000 to 99,999 sqft")
    with pytest.raises(UnknownLabel):
        la_size_band("1 to 2 sqft")


@pytest.mark.parametrize(
    "area, band",
    [(None, "Unknown"), (9_999, "Under 10,000 sqft"), (10_000, "10,000 to 19,999 sqft"),
     (19_999, "10,000 to 19,999 sqft"), (20_000, "20,000 to 49,999 sqft"),
     (99_999, "50,000 to 99,999 sqft"), (100_000, "100,000+ sqft")],
)
def test_sf_size_band(area, band):
    assert sf_size_band(area) == band


def test_sf_city_owned_heuristic_matches_real_values():
    assert sf_city_owned("Commercial - Port Facility", "Upcoming") == "Port Facility"
    assert sf_city_owned("Commercial", "Exempt - Municipal") == "Exempt - Municipal"
    assert sf_city_owned("Commercial", "Did Not Comply") is None


def test_audit_status_mapping():
    assert audit_status(None) == "none"
    assert audit_status("Did Not Comply") == "did_not_comply"
    assert audit_status("Delayed Till Next Cycle") == "upcoming"
    assert audit_status("Pending - Waiting for Clarification") == "pending"
    assert audit_status("Exempt - LEED EBOM") == "exempt"
    with pytest.raises(UnknownLabel):
        audit_status("Brand New Status")


def la_row(year, compliance, **extra):
    return {"building_id": "476102819647", "program_year": str(year), "compliance": compliance,
            "building_address": "5500 S FIGUEROA ST", "postal_code": "90037",
            "building_programclass": "20,000 to 49,999 sqft", "apn": "054", **extra}


def test_data_on_file_uses_report_year_row_only():
    # Like 5500 S Figueroa: data on file in older NOT COMPLIED years, none in 2025.
    rows = [
        la_row(2019, "NOT COMPLIED", organization="Vert Energy Group, Inc.", site_eui="22", energy_star_score="79"),
        la_row(2022, "COMPLIED", organization="CRCD Partners", site_eui="40.6"),
        la_row(2023, "NOT COMPLIED"),
        la_row(2024, "NOT COMPLIED"),
        la_row(2025, "NOT COMPLIED"),
    ]
    [building], filings = build_la(rows, 2025)
    assert building["segment"] == "chronic"
    assert building["priority"] == "B"
    assert building["data_on_file"] is False
    assert building["last_filed_by"] == "CRCD Partners" and building["last_filed_year"] == 2022
    assert [f["year"] for f in filings] == [2019, 2022, 2023, 2024, 2025]
    assert filings[-1]["source_url"].endswith("?building_id=476102819647&program_year=2025")


def test_la_lapsed_city_owned_is_excluded():
    rows = [
        la_row(2024, "COMPLIED", organization="Vert Energy Group, Inc.", building_programclass="7,500 to 14,999 sqft (CITY OWNED BUILDING)"),
        la_row(2025, "NOT COMPLIED", building_programclass="7,500 to 14,999 sqft (CITY OWNED BUILDING)"),
    ]
    [building], _ = build_la(rows, 2025)
    assert building["segment"] == "lapsed"
    assert building["city_owned"] is True
    assert building["priority"] == "excluded"
    assert building["size_band"] == "7,500 to 14,999 sqft"


def test_sf_building_and_source_url():
    base = {"parcel_number": "0012/001", "building_name": "211 Jefferson St", "building_address": "2739 TAYLOR ST",
            "floor_area": "40052", "property_type": "Commercial", "category": "Retail Store",
            "energy_audit_status": "Did Not Comply", "energy_audit_due_date": "2024-04-01T00:00:00.000",
            "pim_link": {"url": "https://sfplanninggis.org/PIM/?tab=Property&search=0012/001"}}
    rows = [
        {**base, "benchmark_year": "2024", "benchmark_status": "2024 - Complied", "site_eui": "15.3"},
        {**base, "benchmark_year": "2025", "benchmark_status": "2025 - Violation - Did Not Report"},
    ]
    [building], filings, [audit] = build_sf(rows, 2025)
    assert building["id"] == "sf:0012/001"
    assert building["segment"] == "did_not_report" and building["history"] == "lapsed"
    assert building["priority"] == "A" and building["audit_overdue"] is True
    assert building["property_type"] == "Retail Store · Commercial"
    assert building["size_band"] == "20,000 to 49,999 sqft"
    assert audit == {"building_id": "sf:0012/001", "due_date": "2024-04-01", "status_raw": "Did Not Comply", "status": "did_not_comply"}
    assert filings[1]["source_url"] == "https://data.sf.gov/resource/96ck-qcfe.json?unique_identifier=0012/001_2025"


def test_sf_source_url_keeps_parcel_letters_and_dashes():
    assert sf_source_url("3721/120-A", 2025).endswith("unique_identifier=3721/120-A_2025")
    assert sf_source_url("0236A/001", 2025).endswith("unique_identifier=0236A/001_2025")


def test_unknown_city_owned_suffix_stops_the_build():
    with pytest.raises(UnknownLabel):
        la_size_band("20,000 to 49,999 sqft (CITY-OWNED BUILDING)")
    with pytest.raises(UnknownLabel):
        la_city_owned("100,000+ sqft (MUNICIPAL)")


@pytest.mark.parametrize("raw, expected", [
    ("Vert Energy Group, Inc.", ("Vert Energy Group, Inc.", None)),
    ("Bay Efficiency", ("Bay Efficiency", None)),
    ("Cushman &amp; Wakefield", ("Cushman & Wakefield", None)),
    ("Kroger, Inc.", ("Kroger, Inc.", None)),
    ("Unknown", (None, None)),
    ("My Organization", (None, None)),
    ("000488305760", (None, None)),
    ("jordan roe", (None, "withheld")),
    ("Roe, Jordan CO TR ET AL Jordan Roe Trust", (None, "withheld")),
    ("JANE Q ROE TRUST", (None, "withheld")),
    ("Sam Roe and Alex Roe, Co-Owners", (None, "withheld")),
    ("Roe, Jordan F", (None, "withheld")),
    ("Business Enterprises Centre LLC and Roe, Sam Co Tr Roe Trust", (None, "withheld")),
    ("Tenant is Royal-Pedic Mattress Mfg. / Keleco, LLC is building owner", (None, "withheld")),
    # People's names that a company word or suffix used to let through (made-up names).
    ("Avery and Blair Roe Family LP", (None, "withheld")),
    ("Avery and Blair Roe", (None, "withheld")),
    ("Quinn and Riley ROE LLC", (None, "withheld")),
    ("Q and R Roe LLC", (None, "withheld")),
    ("Q&R Roe Partnership LP", (None, "withheld")),
    ("Roe Family Partnership", (None, "withheld")),
    ("Roe Family Limited Partnership", (None, "withheld")),
    ("Roe fmily properties", (None, "withheld")),
    ("Series 2, Elm Enterprises, Roe Family Series LP", (None, "withheld")),
    ("Jordan Q. Roe, Inc", (None, "withheld")),
    ("Law Offices of Jordan Q Roe", (None, "withheld")),
    ("Roe, Jordan and QRS Equities LP", (None, "withheld")),
    ("Jordan Roe", (None, "withheld")),
    # The same shapes in capitals, as LADBS sometimes sends them.
    ("QUINN AND RILEY ROE LLC", (None, "withheld")),
    ("Quinn And Riley Roe LLC", (None, "withheld")),
    ("JORDAN Q. ROE, INC", (None, "withheld")),
    ("AVERY AND BLAIR ROE", (None, "withheld")),
    ("ROE FAMILY LP", (None, "withheld")),
    # Company names of the same rough shape stay published.
    ("Harbor Family Health Center", ("Harbor Family Health Center", None)),
    ("Roe & Doe Associates", ("Roe & Doe Associates", None)),
    ("Delta V Business Systems", ("Delta V Business Systems", None)),
    ("Sunset Vine Holdings, LLC", ("Sunset Vine Holdings, LLC", None)),
    ("Bay Efficiency, LLC", ("Bay Efficiency, LLC", None)),
    ("Smart and Final", ("Smart and Final", None)),
    ("ROE & DOE ASSOCIATES", ("ROE & DOE ASSOCIATES", None)),
    ("SUNSET VINE HOLDINGS, LLC", ("SUNSET VINE HOLDINGS, LLC", None)),
])
def test_filer_name(raw, expected):
    assert filer_name(raw) == expected


def test_page_never_shows_a_name_it_withholds_in_another_year():
    # The bare name is withheld; the longer value with "Family LP" must be too.
    rows = [
        la_row(2023, "COMPLIED", organization="Avery and Blair Roe"),
        la_row(2024, "COMPLIED", organization="Avery and Blair Roe Family LP"),
        la_row(2025, "NOT COMPLIED"),
    ]
    [building], filings = build_la(rows, 2025)
    assert [f["filed_by"] for f in filings] == [None, None, None]
    assert [f["filed_by_note"] for f in filings][:2] == ["withheld", "withheld"]
    assert building["last_filed_by"] is None and building["last_filed_by_note"] == "withheld"


def test_only_hand_checked_institutions_on_the_known_list_look_personal():
    # The known list skips the person check, so a person added to it would publish.
    # An institution named after someone has to be added here on purpose too.
    flagged = {k for k in KNOWN_FILERS if any(looks_personal(f(k)) for f in (str, str.title, str.upper))}
    assert flagged == {"the j paul getty trust", "the j. paul getty trust"}


def test_withheld_filer_never_reaches_the_building_record():
    rows = [
        la_row(2024, "COMPLIED", organization="Roe, Casey TR Casey Roe Trust"),
        la_row(2025, "NOT COMPLIED"),
    ]
    [building], filings = build_la(rows, 2025)
    assert building["segment"] == "lapsed"
    assert building["last_filed_by"] is None and building["last_filed_by_note"] == "withheld"
    assert filings[0]["filed_by"] is None and filings[0]["filed_by_note"] == "withheld"
    assert filings[0]["filed_by_raw"] == "Roe, Casey TR Casey Roe Trust"  # kept only in the database


def test_sparse_new_year_row_does_not_change_the_building():
    # LADBS opens 2026 with a row missing fields and a different suffix; the pinned 2025 row wins.
    rows = [
        la_row(2024, "COMPLIED", organization="Bay Efficiency"),
        la_row(2025, "NOT COMPLIED"),
        {"building_id": "476102819647", "program_year": "2026", "compliance": "NOT COMPLIED"},
    ]
    [building], _ = build_la(rows, 2025)
    assert building["address"] == "5500 S FIGUEROA ST"
    assert building["size_band"] == "20,000 to 49,999 sqft" and building["city_owned"] is False
    assert building["segment"] == "lapsed" and building["latest_year"] == 2026


def test_floor_area_that_contradicts_the_band_is_not_published():
    rows = [la_row(2017, "COMPLIED", organization="X Inc", property_gfa_1="1", building_programclass="100,000+ sqft"),
            la_row(2025, "NOT COMPLIED", building_programclass="100,000+ sqft")]
    [building], _ = build_la(rows, 2025)
    assert building["floor_area_sqft"] is None and building["floor_area_reported"] == 1


def test_same_address_flags_compliant_neighbours():
    a = {"id": "sf:3705/042", "city": "SF", "address": "865 MARKET ST", "report_status": "did_not_report"}
    b = {"id": "sf:3705/042-A", "city": "SF", "address": "865 Market St", "report_status": "complied"}
    c = {"id": "la:1", "city": "LA", "address": "865 MARKET ST", "report_status": "complied"}
    add_same_address([a, b, c])
    assert (a["same_address_others"], a["same_address_complied"]) == (1, 1)
    assert json.loads(a["same_address_ids"]) == ["sf:3705/042-A"]
    assert c["same_address_others"] == 0  # other city
