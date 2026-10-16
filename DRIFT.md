# Where the live data differs from SPEC.md

Each entry says what the spec assumes, what the data shows (with the date checked), and what the code does about it. Newest entries go at the bottom.

## 2026-10-15 (data: LA refresh 2026-10-11, SF refresh 2026-10-09)

1. **SF `property_type` and `category` hold each other's content.** The portal describes `category` as "commercial, mixed residential, multifamily" and `property_type` as the primary function. The data is the other way round: `property_type` has `Commercial`, `Commercial - Port Facility`, `Multifamily`, `Mixed Residential`; `category` has `Office`, `Hotel`, `Multifamily Housing`, and so on.
   - Code: the city-owned rule tests `property_type` *containing* `Port Facility`. The real value is `Commercial - Port Facility` (24 buildings in 2025), so an exact match on `Port Facility` would find none. `buildings.property_type` for SF is `"<category> · <property_type>"`, for example `Office · Commercial`.

2. **5500 S FIGUEROA ST has no data on file for 2025.** Its 2025 row has no `organization` and no `site_eui`. The spec's example of "an ENERGY STAR score in a NOT COMPLIED year" is its 2019 and 2020 rows (Vert Energy Group, scores 79 and 15). For 2025 it is **chronic** (NOT COMPLIED in 2023, 2024, 2025) and counts in the 4,629 *without* data on file, not in the 624.
   - Code: "data on file" looks at the 2025 row only.

3. **LA private buildings have only three size bands.** In every year, `7,500 to 14,999 sqft` and `15,000 to 19,999 sqft` appear only with the city-owned suffix (LA covers city buildings from 7,500 sqft, private ones from 20,000 sqft).
   - Code: SF bands are `10,000 to 19,999`, `20,000 to 49,999`, `50,000 to 99,999`, `100,000+` sqft. No SF building in the data is under 10,000 sqft or missing a floor area (checked 2026-10-15), but the code still labels those cases `Under 10,000 sqft` / `Unknown` if they appear.
   - Code: `build_db` stops (exit 1, `data/scanner.db` not replaced) if any LA building in those two bands is not labeled city-owned, or if no LA building is. If LADBS dropped or renamed the suffix, every count would still agree (`scanner.counts` reads the same suffix) while city buildings turned into prospects. On 2026-10-15: 0 such buildings, 601 city-owned LA buildings.

4. **SF's update time falls on the next UTC day.** `rowsUpdatedAt` is 2026-10-10 00:10 UTC, which is 2026-10-09 17:10 Pacific. The spec's "2026-10-09" is the Pacific date.
   - Code: every as-of date is shown in America/Los_Angeles time.

5. **SF's own column description is wrong; the spec's due date is right.** DataSF describes `benchmark_year` as "The year when the building's benchmark data was submitted". Research on 2026-10-15 (`docs/research/benchmark-year.md`) shows it is the data year. SF Environment's live page says "The 2025 Annual Energy Benchmark is due May 1, 2026." But Environment Code Sec. 2004 (last readable text, 2023) still says "annually no later than April 1".
   - Code: SF did-not-report lines add "SF Environment says the 2025 Annual Energy Benchmark was due May 1, 2026." That sentence credits the agency rather than stating the date as law, a small change from the spec's "The 2025 benchmark was due May 1, 2026." (`config.SF_DUE_DATE_SENTENCES`).

6. **52 LA buildings have short IDs.** Most `building_id` values are 12 digits, but 52 buildings (437 rows) have 3 to 6 digits, all private. 7 of those short IDs are also house numbers that appear in some LA address.
   - Code: search jumps straight to a building page on an exact ID match. A short all-digit query that is also a house number shows the list, with the ID match first.

7. **SF has status labels the spec's enum does not cover**, all in older years: `2017 - Data Not Verified` (8), `2018 - Upcoming` (1), `2019 - Upcoming` (1), `2020 - Pending - Submitted` (2).
   - Code: these map to the extra enum value `other`. The page still shows the raw label. None of them fall in 2023 to 2025, so no segment changes.

8. **SF audit statuses outside the spec's enum.** The audit fields are the same on every year's row for a parcel, so they describe the building's current audit, not a per-year one. Mapping used:

   | Raw `energy_audit_status` | `audits.status` |
   |---|---|
   | Upcoming | upcoming |
   | Delayed Till Next Cycle | upcoming (the audit moved to the next cycle) |
   | Did Not Comply | did_not_comply |
   | Pending - Contracted | pending |
   | Pending - Waiting for Clarification | pending |
   | Complied | complied |
   | Exempt - ENERGY STAR, Exempt - LEED EBOM, Exempt - Demolition, Exempt - Other, Exempt - Temporary, Exempt - Municipal | exempt |
   | blank | none |

9. **No Socrata app token yet.** The spec says to send one in `X-App-Token`. None is set up, so pulls run without one, which gives a lower rate limit. That is fine for one pull a night: LA is 2 pages and SF is 1. The code sends the token whenever `SOCRATA_APP_TOKEN` is set. The founder needs to create one (free) and add it as a GitHub secret.

10. **SF lists only parcels that are covered today.** All 2,488 parcels have a 2025 row, and older years only include parcels that are still covered. LA keeps 251 buildings that dropped out before 2025 (11,492 building IDs in all). Search covers every building in both datasets. Buildings with no 2025 row show their history and get no segment.

11. **SF building fields are the same in every year.** Address, name, floor area, property type, category, year built and audit fields never change across a parcel's rows. LA's address and size band also never change across a building's rows. So `buildings` takes them from the report-year (2025) row, or from the newest row that has the field when there is no 2025 row.

## 2026-10-15, after the review and research passes

12. **LA's organization field sometimes names people.** The spec says neither dataset has owner names. But LADBS's "ENTITY RESPONSIBLE FOR BENCHMARK" includes values like "Last, First TR ... Family Trust", "First Last and First Last, Co-Owners" and plain personal names. That would break the guardrail "No owner or personal data in v1."
    - Code: `classify.filer_name` publishes a name only when it reads as an organization: a company word or legal suffix, or a hand-checked list of frequent filers. Trust, owner or "Last, First" markers, free text and unrecognized names are withheld. 787 of 3,663 distinct values are withheld, on 1,000 buildings, and the page says "name not shown". Some withheld values are really companies; that is the safe direction. The city's raw value stays in `data/scanner.db` (`filed_by_raw`, `last_filed_by_raw`) and is never exported. A withheld name never goes into an outreach line.
    - The final check (2026-10-15) found people's names that a company word let through, such as two given names and a surname before "LLC", "<Surname> Family LP" and a middle initial before "Inc". `classify.looks_personal` now withholds those shapes even with a suffix, in capitals too. That also stops a page from withholding a bare name in one year and showing the same people with "Family LP" in another (tested on the real data in `tests/test_names.py`). A bare "Given Surname" is never on the known-filer list. Firms named after a founder ("Given Surname Properties, Inc") still show, because no rule can tell them from a one-person company: 23 such values on 41 pages, 13 default prospect rows. Whether to withhold them is the founder's call.

13. **LA self-reported floor areas can contradict LADBS's size band.** For example, 757 S FLOWER ST is in the 100,000+ sqft band with a reported area of 1 sq ft. 433 default LA prospects had an area outside their band.
    - Code: the floor area is published only when it fits the band (`floor_area_reported` keeps the raw value). The within-band sort uses only areas that fit.

14. **Several records can share one address.** These are LA campuses (88 addresses with more than one building ID in 2025) and SF split parcels (865 MARKET ST is 3705/042, Did Not Report, and 3705/042-A, Complied). An owner who looks the address up may find the compliant record.
    - Code: each building carries `same_address`: the other report-year records at the same address in the same city, and how many are compliant. Two records share an address when the house number and street name match after dropping a unit (`#`, `UNIT`, `STE`/`SUITE`, `APT`) and SF's ` - NORTH/SOUTH/EAST/WEST` suffix, and when the directional (N/S/E/W), the street type (`STREET` counts as `ST`) and the ZIP each match or are missing on one side. E and W, ST and AVE, and two different ZIPs are never merged. The match is not transitive, so each record gets its own list. The page and the prospect list flag it, and the CSV has `same_address_others` and `same_address_complied`. 24 non-compliers share an address with a compliant record: 23 prospects and one city-owned building. Every outreach line ends with its row-level source link, which names the exact building ID or parcel.

15. **SF has two as-of dates.** Every SF row says `data_as_of` 2026-10-08T22:18:12 (when SF's source system last changed the row). The portal's `rowsUpdatedAt` is 2026-10-09 Pacific. Following the spec, the site shows `rowsUpdatedAt`. `data_as_of` is kept in `pulls.data_as_of` and `meta.json`. Whether to switch to October 8, the more cautious date, is the founder's call.

16. **LA's open data runs a few days behind LADBS's live status page.** On 2026-10-15 the live page showed 6,012 COMPLIED and 5,229 NOT COMPLIED for 2025. The dataset (refreshed 2026-10-11) shows 5,988 and 5,253. LADBS still accepts and records late 2025 filings.
    - Code: `meta.flags.la_live_status_url`. Check each building there by hand before sending an LA line.

17. **LA organization names sometimes arrive HTML-escaped** (49 rows across 6 values, for example 'Cushman &amp; Wakefield'). They are unescaped for display. Placeholder values ('Unknown', 'My Organization', digits-only) count as "no name listed".

18. **186 LA building IDs look assigned rather than parcel-based** (999000000004 to 999000000497). 64 of them are 2025 non-compliers. They are handled like any other ID.

19. **"Compliance Year" means two things at LADBS.** For benchmarking it is the data year. For audits and retro-commissioning (A/RCx) it is the deadline year: "A/RCx Compliance Year 2026" is due December 1, 2026. This dataset is benchmarking only, so the site and the outreach lines never mention A/RCx.

20. **One LA address lists several house numbers.** la:480917841924 is '1234 1240, 1250,1254,1258,1260, W. WILSHIRE BLVD' (2025 NOT COMPLIED, chronic). A line quoting it would read as garbled copy.
    - Code: a building whose address still has a comma inside after trimming gets no outreach line, in either city, and its page and prospect row say to check the address by hand. It is the only non-complier affected today.

21. **Some addresses are written in ways a plain word match misses.** 4 LA addresses contain U+FFFD, a character lost in LADBS's data (la:473925826977, la:474757717603, la:474882717367, la:475329716819). SF writes some numbered streets with a leading zero (104 09TH ST, 1150 03RD ST) and spells one address out (One Post Street). SF also splits some addresses into records by unit or by a part after a dash: 3450 3RD ST #1 D, #2 A and #2 B; 350 RHODE ISLAND ST - SOUTH and 350 RHODE ISLAND - NORTH (only SOUTH has ST); 45 PIER - SHED A, B and D; 80 Pier's M&R Bldg and Service Building.
    - Code: search ignores U+FFFD and the leading zero, and reads spelled-out house numbers (one to twenty) and ordinals (Twenty-third, One Hundred Third). Records at one street address count as one address, so Enter on '3450 3rd St' lists all three ('3 records have that address. Pick one:'). A unit or part typed must be the record's own: '3450 3rd St #2 A' opens #2 A, and '3450 3rd St #2 D' lists all three instead of opening another unit. A city typed (Los Angeles, San Francisco, LA, SF) limits what Enter opens to that city: '1 Market St, Los Angeles' lists SF's 1 MARKET ST under 'No exact match in Los Angeles. Closest matches:'. Any other address Enter can't open says 'No single exact match for that address. Closest matches:', because the city may list it in a form search can't match (item 20). The same-address flag (item 14) groups units and the North/South pair but not the pier sheds, which are all compliant and city-owned.
