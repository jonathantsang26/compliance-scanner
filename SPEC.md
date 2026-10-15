# Compliance-Risk Scanner — Build Spec

Oct 15, 2026 · @Jonathan Tsang

> Copied from the founder's spec as pasted on 2026-10-15. Tables were flattened in the paste and are rebuilt here as Markdown tables; the words and numbers are unchanged. Where the live data turned out to differ from this text, see `DRIFT.md` rather than editing this file.

## How to use this spec

Hand this doc to a Fable 5.1 agent at max effort. It should ship a working scanner in 1–2 days by following the milestones in order, passing each checkpoint before it moves on.

Prompt to give the agent:

> Build the Compliance-Risk Scanner in this spec. Work one milestone at a time and do not start the next until its checkpoint passes. Milestone 1 is only to reproduce the counts under Acceptance tests from the live APIs. Treat Guardrails as hard rules. Stop and ask before deploying publicly, paying for any data source, or sending any message.

Decisions that stay with the founder, not the agent:

- Whether and how to find owner contacts (paid source, manual lookup, or skip for now).
- Sign-off on what LA's program_year 2025 means before any LA outreach copy is used.
- The public URL and domain the demo lives on.

## Goal and success criteria

The scanner answers one question for any covered building in Los Angeles or San Francisco: is it out of compliance with its city's energy benchmarking law, according to the city's own public data, and as of when? It uses only city open data, so it needs no permission from owners like SWIG or Kilroy.

It serves two jobs:

- **YC demo.** A live URL where you type an address and see the building's filing history, its current status, and a link to the source record. Headline numbers on the home page: 5,253 LA buildings marked NOT COMPLIED for program year 2025, and 646 SF buildings in benchmark violation for 2025 (628 did not report, 18 insufficient data).
- **Outreach.** A prospect list, sorted by intent, that exports to CSV with a one-line, source-linked opener per building.

Done means:

- [ ] A public URL with address search across both cities.
- [ ] A page per building showing status by year, segment, data-as-of date and source link.
- [ ] A filterable prospect list with CSV export and an outreach line per row.
- [ ] A nightly refresh that updates the as-of date.
- [ ] Every check under Acceptance tests passes.

Out of scope for v1: owner contact lookup, other cities, user accounts, payments, a map, and sending any email.

## Data sources

Two public Socrata datasets cover everything v1 needs. Both were queried live for this spec; neither has owner names.

| | Los Angeles | San Francisco |
|---|---|---|
| Dataset | EBEWE Program (LADBS) | Existing Buildings Energy Performance Ordinance Report (SF Environment) |
| API endpoint | https://data.lacity.org/resource/9yda-i4ya.json | https://data.sf.gov/resource/96ck-qcfe.json |
| Grain | One row per building per program_year (2016–2025) | One row per parcel per benchmark_year |
| Building key | building_id (12 digits) | parcel_number (e.g. 0012/001) |
| Status field | compliance: COMPLIED or NOT COMPLIED | benchmark_status, e.g. 2025 - Violation - Did Not Report |
| Second obligation | Audit/retro-commissioning (A/RCx), not in this dataset | energy_audit_status, energy_audit_due_date |
| 2025 buildings | 11,241 | 2,488 |
| Rows last updated | 2026-10-11 | 2026-10-09 (monthly) |

Other LA fields to keep: building_address, postal_code, building_programclass (size band), organization (entity that filed the benchmark), apn, property_gfa_1, primary_property_1, energy_star_score, site_eui, year_built.

Other SF fields to keep: building_name, building_address, postal_code, floor_area, property_type, category, reason_for_exemption, pim_link, latitude, longitude, data_as_of.

Quirks the builder must handle:

- data.sfgov.org now redirects to data.sf.gov; use the new host.
- Socrata returns 1,000 rows by default. Set $limit and page with $offset plus a stable $order, and send an app token in X-App-Token.
- LA primary_property_1 is blank for 4,629 of the 5,253 non-compliers, because non-filers send no Portfolio Manager data. Segment LA by building_programclass, not property type.
- LA apn holds only the last 3 digits of the parcel number, so it cannot be joined to assessor data.
- LA size bands carry a (CITY OWNED BUILDING) or (CITY OWNED BUILDINGS) suffix on public buildings. 216 of the 5,253 non-compliers are city-owned.
- SF building_name can differ from building_address (parcel 0012/001 is named "211 Jefferson St" but listed at 2739 TAYLOR ST). Search both.
- SF status strings embed the year; parse the year off and keep the rest.
- LA has no coordinates. Skip the map in v1 rather than geocode.

Open question, blocking LA outreach copy only: does LA program_year 2025 mean calendar-2025 data or the 2025 filing cycle? No 2026 rows exist as of the 2026-10-11 refresh, and the LADBS due-date pages could not be opened to confirm the deadline; the agent should check LAMC Division 97 or ask LADBS at ladbs.ebewe@lacity.org (listed in LADBS notices; verify it is current). SF is clear: SF Environment says the 2025 benchmark was due May 1, 2026.

## Unified data model

Four tables normalize both cities: one row per building, one per building-year filing, one per SF audit obligation, and one per dataset pull. Keep each city's raw status string next to the normalized value, because outreach quotes the raw string.

### buildings (one per building)

| Field | Type | LA source | SF source |
|---|---|---|---|
| id | text | la: + building_id | sf: + parcel_number |
| city | text | LA | SF |
| address | text | building_address | building_address |
| alt_name | text | — | building_name |
| postal_code | text | postal_code | postal_code |
| size_band | text | building_programclass, suffix removed | Derived from floor_area using LA's bands plus a 10,000 to 19,999 sqft band |
| floor_area_sqft | int | property_gfa_1 (filers only) | floor_area |
| property_type | text | primary_property_1 (filers only) | property_type + category |
| year_built | int | year_built | year_built |
| city_owned | bool | CITY OWNED suffix present | Heuristic, not a dataset field: property_type = Port Facility or audit status Exempt - Municipal |
| parcel | text | apn (last 3 digits only) | parcel_number |
| pim_link | text | — | pim_link |

### filings (one per building per year)

| Field | Type | Notes |
|---|---|---|
| building_id | text | FK to buildings.id |
| year | int | LA program_year, SF benchmark_year |
| status_raw | text | Verbatim: NOT COMPLIED, 2025 - Violation - Did Not Report |
| status | enum | complied, not_complied, did_not_report, insufficient_data, exempt |
| filed_by | text | LA organization; null for SF |
| energy_star_score | int | Both cities |
| site_eui | float | Both cities |
| source_url | text | API URL filtered to this one row (see below) |

audits (SF only): building_id, due_date, status_raw, status (upcoming, did_not_comply, pending, exempt, complied, none).

pulls: dataset, rows_updated_at, fetched_at, row_count. The UI reads the as-of date from here.

Source links point at the exact row so anyone can verify it:

- LA: `https://data.lacity.org/resource/9yda-i4ya.json?building_id={id}&program_year={year}`
- SF: `https://data.sf.gov/resource/96ck-qcfe.json?unique_identifier={parcel}_{year}`

Use SQLite or DuckDB as the working store. The site reads static JSON built from it.

## Risk logic

Classify each building by its latest-year status and its history, then rank by segment and size. Skip a numeric risk score; the city's own labels and three years of history are the defensible signal.

| City | Segment | Rule | 2025 count | Priority |
|---|---|---|---|---|
| LA | Lapsed | NOT COMPLIED in 2025, COMPLIED in 2024 | 1,388 | A |
| LA | Chronic | NOT COMPLIED in 2023, 2024 and 2025 | 3,327 | B |
| LA | Other non-compliant | NOT COMPLIED in 2025, any other history | 538 | B |
| LA | City-owned | Any of the above with the city-owned suffix | 216 | Excluded |
| SF | Did not report | 2025 - Violation - Did Not Report | 628 | A |
| SF | Insufficient data | 2025 - Violation - Insufficient Data | 18 | A |
| SF | Audit overdue | energy_audit_status = Did Not Comply | 620 | Separate column |

LA counts include city-owned buildings; recompute after excluding them. Lapsed, chronic and other sum to 5,253.

Lapsed ranks first because those owners already know the program and paid someone to file in 2024. For each lapsed building, show the 2024 organization as "last filed by"; Vert Energy Group filed 1,560 of LA's compliant 2025 benchmarks, so that field also maps the competition.

Two flags sit beside the segment, never folded into it:

- **LA data on file.** 624 of the 5,253 LA non-compliers still have benchmark data published (for example 5500 S FIGUEROA ST shows an ENERGY STAR score in a NOT COMPLIED year). The other 4,629 have none. Rule: data on file means the organization or site_eui field is non-null. This proves LA's NOT COMPLIED is not the same as "not filed."
- **SF audit overdue.** It is a second obligation with its own due date. 290 SF buildings have both a 2025 benchmark violation and an overdue audit.

Apply the same lapsed and chronic rules to SF using 2023–2025 benchmark_status. Within each priority, sort by size band, largest first.

## Product surface

Three screens and one export. Every screen shows the data-as-of date for each city.

1. **Home.** Headline counts per city, the as-of dates, and one search box. Search matches address, SF building name, LA building ID and SF parcel number, and tolerates St/Street and missing directionals.
2. **Building page.** Address, city, size band, segment, the status for every year on file (verbatim labels), "last filed by" for LA, SF audit status and due date, the source link for each year, and a copy button for the outreach line.
3. **Prospect list.** Filters for city, segment, size band and the two flags; city-owned buildings hidden by default. Sorted by priority, then size.
4. **CSV export** of the current filter, one row per building: id, city, address, size_band, segment, status_raw, year, last_filed_by, audit_status, as_of, source_url, outreach_line.

Outreach line templates. Quote the city's label exactly; fill the date from pulls.

- SF, did not report: "SF Environment's public data (as of {as_of}) lists {address} as '2025 - Violation - Did Not Report'. The 2025 benchmark was due May 1, 2026."
- SF, insufficient data: "SF Environment's public data (as of {as_of}) lists {address} as '2025 - Violation - Insufficient Data'."
- LA, any segment: "LADBS's public EBEWE data (as of {as_of}) lists {address} as NOT COMPLIED for program year 2025."
- LA, lapsed (appended): "It was listed as COMPLIED for 2024, filed by {last_filed_by}."

Your line "your building shows as not filed for 2025" fits SF's did-not-report rows as written. For LA, use "NOT COMPLIED", since 624 LA non-compliers did submit data.

## Architecture and stack

One nightly job pulls both datasets, rebuilds the classified data and publishes a static site. No server or database runs in production.

About 14,000 buildings are in scope for 2025, small enough to ship as static JSON with client-side search.

- Pulls and processing: Python 3.12, requests or sodapy, SQLite or DuckDB as the working store.
- Site: plain HTML and JS or Astro, with MiniSearch for search.
- Hosting: any static host, such as Vercel, Netlify, Cloudflare Pages or GitHub Pages.
- Schedule: a nightly GitHub Actions cron, with the Socrata app token stored as a secret.

## Milestones

Six steps, each ending in a checkpoint the agent shows before moving on. Milestones 1–5 are the 1–2 day build; 6 is optional.

1. **Reproduce the counts.** A script pulls both datasets with paging and an app token, and prints the status counts from Acceptance tests.
   - Checkpoint: printed counts match, or the agent explains any drift since the 2026-10-11 and 2026-10-09 refreshes.
2. **Normalize and classify.** Load the four tables, assign segments and flags.
   - Checkpoint: segment counts printed; LA lapsed + chronic + other = 5,253.
3. **Search and building pages.** Static site built from JSON, with client-side search.
   - Checkpoint: the three lookups in Acceptance tests render correctly.
4. **Prospect list, export and outreach lines.** Filters, CSV, templates.
   - Checkpoint: CSV row count equals the on-screen count, and every row has as_of and source_url.
   - Gate: LA outreach lines stay behind a flag until the founder signs off on the program_year question.
5. **Deploy and refresh.** Static hosting plus a nightly scheduled job that re-pulls, rebuilds and redeploys.
   - Checkpoint: the founder approves the public URL; the as-of date changes after a forced run.
6. **Stretch, founder's call.** Owner lookup, a map, LA A/RCx due dates by building ID, more cities.

## Guardrails

These are hard rules for the agent. They keep every claim checkable when an owner replies "we filed."

- **Quote, don't paraphrase.** UI and outreach use the city's status label verbatim. Never describe an LA NOT COMPLIED building as "not filed" or "didn't file."
- **Date and source everywhere.** Every building page, CSV row and outreach line carries the as-of date and the row-level source link.
- **No penalty amounts.** Show no dollar figures or fine language unless the agent cites the ordinance section and the founder approves. LA fee schedule sources conflict ($202 vs $660), and no SF amount was confirmed.
- **No owner or personal data in v1.** The scanner lists buildings, not people. Owner lookup is a founder decision.
- **City-owned buildings** are labeled and kept out of the prospect list.
- **No sending.** The product writes copy; it never sends email. When the founder sends, CAN-SPAM rules apply: a real postal address and a working opt-out.
- **No implied affiliation.** No city seals or logos, and a footer line saying the site is independent of LADBS and SF Environment.
- **Be polite to the APIs.** One pull per dataset per night, with an app token and cached results.

## Acceptance tests

The agent is done when every check below passes. The expected counts were pulled on 2026-10-15 from the 2026-10-11 (LA) and 2026-10-09 (SF) refreshes. Later refreshes may move them slightly: pin a snapshot at build time and warn on drift above 2%.

LA status counts:

```sh
curl -G "https://data.lacity.org/resource/9yda-i4ya.json" --data-urlencode '$select=program_year,compliance,count(*)' --data-urlencode '$group=program_year,compliance' --data-urlencode '$order=program_year,compliance' --data-urlencode '$limit=500'
```

SF status counts:

```sh
curl -G "https://data.sf.gov/resource/96ck-qcfe.json" --data-urlencode '$select=benchmark_year,benchmark_status,count(*)' --data-urlencode "\$where=benchmark_year in('2024','2025')" --data-urlencode '$group=benchmark_year,benchmark_status'
```

| Check | Expected |
|---|---|
| LA 2025 NOT COMPLIED | 5,253 |
| LA 2025 COMPLIED | 5,988 |
| LA 2024 NOT COMPLIED | 4,207 |
| LA 2025 lapsed / chronic / other | 1,388 / 3,327 / 538 |
| LA 2025 non-compliers with data on file / without | 624 / 4,629 |
| LA 2025 city-owned non-compliers | 216 |
| SF 2025 Did Not Report | 628 |
| SF 2025 Insufficient Data | 18 |
| SF 2025 Complied / Exempt | 1,752 / 90 |
| SF 2025 audit Did Not Comply | 620 |
| SF 2025 benchmark violation and audit Did Not Comply | 290 |

Functional checks:

- [ ] Searching "5500 S Figueroa" opens LA building 476102819647 with its full year history.
- [ ] Searching "211 Jefferson" finds SF parcel 0012/001, listed at 2739 TAYLOR ST.
- [ ] Searching a building ID or a parcel number goes straight to its page.
- [ ] No LA outreach line contains "not filed" or "didn't file"; each contains "NOT COMPLIED".
- [ ] Every CSV row has a non-empty as_of and a source_url that returns exactly one row.
- [ ] City-owned buildings never appear in the default prospect list.
- [ ] The page loads and searches on a phone-width screen.

## Sources

- LA EBEWE Program dataset, queried 2026-10-15
- SF Existing Buildings Energy Performance Ordinance Report, queried 2026-10-15
- SF Environment, Existing Buildings Energy Performance Ordinance, for the May 1, 2026 due date
