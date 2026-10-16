"""build_db's own checks on made-up rows: the city-owned stop and same-address matching."""

import json

import pytest

from scanner import build_db
from scanner.build_db import add_same_address, address_parts, base_address, build_la, city_owned_problems


def la_row(building_id, programclass, compliance="NOT COMPLIED", year=2025):
    return {"building_id": building_id, "program_year": str(year), "compliance": compliance,
            "building_address": f"{building_id} LANTERN ST", "postal_code": "90012",
            "building_programclass": programclass}


# ---- city-owned stop (DRIFT.md item 3) ------------------------------------------

def test_city_owned_label_passes_when_the_suffix_is_there():
    buildings, _ = build_la([
        la_row("101", "7,500 to 14,999 sqft (CITY OWNED BUILDING)"),
        la_row("102", "15,000 to 19,999 sqft (CITY OWNED BUILDING)"),
        la_row("103", "20,000 to 49,999 sqft"),
    ], 2025)
    assert city_owned_problems(buildings) == []


def test_a_small_band_without_the_suffix_stops_the_build():
    # LADBS dropping the suffix: city buildings would turn into prospects while every count still agrees.
    buildings, _ = build_la([
        la_row("101", "7,500 to 14,999 sqft"),
        la_row("102", "15,000 to 19,999 sqft"),
        la_row("103", "20,000 to 49,999 sqft (CITY OWNED BUILDINGS)"),
    ], 2025)
    [problem] = city_owned_problems(buildings)
    assert problem.startswith("2 LA buildings") and "la:101" in problem and "DRIFT.md item 3" in problem


def test_no_city_owned_building_at_all_stops_the_build():
    buildings, _ = build_la([la_row("101", "20,000 to 49,999 sqft"), la_row("102", "100,000+ sqft")], 2025)
    [problem] = city_owned_problems(buildings)
    assert problem.startswith("No LA building")


def test_the_stop_comes_before_the_database_is_replaced(monkeypatch, capsys):
    la = [la_row("101", "7,500 to 14,999 sqft"), la_row("102", "20,000 to 49,999 sqft")]
    sf = [{"parcel_number": "0001/001", "benchmark_year": "2025", "benchmark_status": "2025 - Complied",
           "building_address": "1 QUILL ST"}]
    snapshots = {"LA": (la, {"stamp": "a"}), "SF": (sf, {"stamp": "b"})}
    monkeypatch.setattr(build_db, "load_latest", lambda city: snapshots[city])
    monkeypatch.setattr(build_db, "write_db", lambda *a: pytest.fail("must not replace the database"))
    assert build_db.main([]) == 1
    err = capsys.readouterr().err
    assert "have no city-owned suffix" in err and "No LA building" in err and "was not replaced" in err


# ---- same address (DRIFT.md item 14) ----------------------------------------------

def rec(bid, address, status="not_complied", zip_code="90012"):
    city = "LA" if bid.startswith("la:") else "SF"
    return {"id": bid, "city": city, "address": address, "postal_code": zip_code, "report_status": status}


def others(b):
    return json.loads(b["same_address_ids"]) if b["same_address_ids"] else []


@pytest.mark.parametrize("address, parts", [
    ("100 W Lantern Blvd", ("100 LANTERN", "W", "BLVD")),
    ("12 Quill St #2 A", ("12 QUILL", None, "ST")),
    ("40 Pretend St.", ("40 PRETEND", None, "ST")),
    ("40 Pretend Street", ("40 PRETEND", None, "ST")),
    ("50 Lantern Ave Ste. 505", ("50 LANTERN", None, "AVE")),
    ("70 PRETEND ST - SOUTH", ("70 PRETEND", None, "ST")),
    ("70 PRETEND - NORTH", ("70 PRETEND", None, None)),
    # Words that only look like a directional or a type stay in the street name.
    ("80 WEST BLVD", ("80 WEST", None, "BLVD")),
    ("90 LANTERN BLVD WEST", ("90 LANTERN BLVD WEST", None, None)),
    ("95 1/2 S QUILL AVE", ("95 1/2 S QUILL", None, "AVE")),
    ("60 PARK", ("60 PARK", None, None)),
])
def test_address_parts(address, parts):
    assert address_parts(address) == parts


def test_base_address_drops_the_unit_and_trailing_punctuation():
    assert base_address("Pier 9, Suite 100") == "PIER 9"
    assert base_address("12 Quill St,") == "12 QUILL ST"
    assert base_address("THE PROMENADE #0003") == "THE PROMENADE"


def test_directional_twin_shares_an_address():
    a = rec("la:1", "100 W LANTERN BLVD")
    b = rec("la:2", "100 LANTERN BLVD", status="complied")
    add_same_address([a, b])
    assert (a["same_address_others"], a["same_address_complied"]) == (1, 1) and others(a) == ["la:2"]
    assert others(b) == ["la:1"]


def test_unit_twins_share_an_address():
    a = rec("sf:0001/031", "12 QUILL ST #1 D", status="did_not_report", zip_code="94124")
    b = rec("sf:0001/032", "12 Quill St #2 A", status="complied", zip_code="94124")
    c = rec("sf:0001/033", "12 QUILL ST", status="complied", zip_code="94124")
    add_same_address([a, b, c])
    assert others(a) == ["sf:0001/032", "sf:0001/033"] and a["same_address_complied"] == 2


def test_north_and_south_parts_share_an_address():
    north = rec("sf:0002/002", "70 PRETEND - NORTH", status="insufficient_data", zip_code="94103")
    south = rec("sf:0002/004", "70 PRETEND ST - SOUTH", status="complied", zip_code="94103")
    add_same_address([north, south])
    assert others(north) == ["sf:0002/004"] and north["same_address_complied"] == 1


def test_spelled_out_street_type_shares_an_address():
    a = rec("sf:0003/044", "40 PRETEND ST", status="did_not_report", zip_code="94118")
    b = rec("sf:0003/062", "40 Pretend Street", status="did_not_report", zip_code="94118")
    add_same_address([a, b])
    assert others(a) == ["sf:0003/062"] and others(b) == ["sf:0003/044"]


def test_east_and_west_are_never_merged():
    # Both match the plain address, but not each other: each record gets its own list.
    east = rec("la:1", "200 E LANTERN AVE")
    west = rec("la:2", "200 W LANTERN AVE")
    plain = rec("la:3", "200 LANTERN AVE", status="complied")
    add_same_address([east, west, plain])
    assert others(east) == ["la:3"] and others(west) == ["la:3"]
    assert others(plain) == ["la:1", "la:2"] and plain["same_address_complied"] == 0


def test_street_and_avenue_are_never_merged():
    a = rec("la:1", "300 QUILL ST")
    b = rec("la:2", "300 QUILL AVE", status="complied")
    c = rec("la:3", "300 QUILL", status="complied")
    add_same_address([a, b, c])
    assert others(a) == ["la:3"] and others(b) == ["la:3"]


def test_a_different_zip_is_never_merged():
    a = rec("la:1", "400 W LANTERN BLVD", zip_code="90001")
    b = rec("la:2", "400 LANTERN BLVD", status="complied", zip_code="90002")
    c = rec("la:3", "400 LANTERN BLVD", status="complied", zip_code=None)  # no ZIP to compare
    add_same_address([a, b, c])
    assert others(a) == ["la:3"] and others(b) == ["la:3"]


def test_different_streets_and_half_addresses_stay_apart():
    records = [
        rec("la:1", "500 LANTERN BLVD WEST"), rec("la:2", "500 LANTERN BLVD", status="complied"),
        rec("la:3", "600 1/2 QUILL AVE"), rec("la:4", "600 QUILL AVE", status="complied"),
        rec("sf:0004/001", "45 PRETEND - SHED A", zip_code="94133"),
        rec("sf:0004/002", "45 PRETEND - SHED B", status="complied", zip_code="94133"),
    ]
    add_same_address(records)
    assert [r["same_address_others"] for r in records] == [0] * 6


def test_addresses_without_a_house_number_and_street_never_group():
    records = [
        rec("sf:0005/001", "THE PRETEND #0001", zip_code="94111"),
        rec("sf:0005/002", "THE PRETEND #0009", status="complied", zip_code="94111"),
        rec("sf:0005/003", "#5", zip_code="94111"), rec("sf:0005/004", "SUITE 100", status="complied", zip_code="94111"),
        rec("la:5", "100 STE LANTERN AVE"), rec("la:6", "100 STE QUILL ST", status="complied"),
    ]
    add_same_address(records)
    assert [r["same_address_others"] for r in records] == [0] * 6


def test_records_outside_the_report_year_are_not_counted():
    a = rec("la:1", "700 W LANTERN BLVD")
    gone = rec("la:2", "700 LANTERN BLVD", status=None)
    add_same_address([a, gone])
    assert (a["same_address_others"], a["same_address_ids"]) == (0, None)
    assert (gone["same_address_others"], gone["same_address_complied"], gone["same_address_ids"]) == (0, 0, None)
