# Compliance-Risk Scanner

Type an address and see whether a Los Angeles or San Francisco building is out of compliance with its city's energy benchmarking law, according to the city's own open data. Each answer comes with an as-of date and a link to the exact source record. A prospect list exports to CSV with a one-line, source-linked opener per building.

The spec is `SPEC.md`. Where the live data differs from it, see `DRIFT.md`. What "2025" means in each city's data is answered, with sources, in `docs/research/benchmark-year.md`.

## Status (2026-10-15)

| Milestone | State | Evidence |
|---|---|---|
| 1. Reproduce the counts | Done | `python -m scanner.counts --live`: all 15 acceptance counts match exactly, and every status group matches the city servers' own totals. Two independent recounts agree: `scanner.counts` (plain Python over the raw rows) and the database (`scanner.build_db`); `tests/test_pipeline.py` checks that they match. A one-off DuckDB SQL recount during the build agreed too; it is not kept in the repo. |
| 2. Normalize and classify | Done | `python -m scanner.build_db`: LA 1,388 + 3,327 + 538 = 5,253; data on file 624 / 4,629; SF 646 violations, 290 also audit-overdue. The database and the raw recount agree on all 15. |
| 3. Search and building pages | Done | `npm test` and `npm run e2e`: the three spec lookups pass at phone and desktop widths, and every page is checked for sideways scrolling at nine widths from 320 to 1280px. |
| 4. Prospect list, CSV, outreach | Done. LA lines signed off 2026-10-16 | The CSV row count equals the on-screen count. Every row has `as_of` and a `source_url`. All 126,639 source links match exactly one row (offline), and a live sample of 25 does too. |
| 5. Deploy and nightly refresh | Prepared, not deployed | `.github/workflows/nightly.yml` is ready. It needs the founder's go-ahead (see Deploy). |

An adversarial review (five reviewers, findings checked by skeptics) found 32 real issues after Milestone 4. The biggest were personal names in LA's filer field, and Enter opening the wrong building for an address that isn't covered. All 32 are fixed. A second full check the same day confirmed 34 more, mostly small: names that a company word let through, address search edge cases (units, a typed city, North/South parts of one address), tables at tablet widths, and a nightly run that stayed green after a failed pull. All 34 are fixed. Two calls are left for the founder: firms named after a person, and one SF building name (see Decisions). See `DRIFT.md` items 12 to 21.

## Run it locally

```sh
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt
npm ci --ignore-scripts                     # test tools only; the site itself has no build step

.venv/bin/python -m scanner.build           # pull -> check counts -> SQLite -> site/data
python3 -m http.server --directory site 8000   # then open http://localhost:8000
```

Each step also runs on its own:

| Command | What it does |
|---|---|
| `python -m scanner.pull [--force]` | Downloads both datasets (paged, `$order=:id`) into `data/raw/<city>/<stamp>/`. Reuses the last snapshot, and records the check, when the city has not published since. Refuses pages served from a stale copy, and a sudden large drop in rows. |
| `python -m scanner.counts [--live]` | Milestone 1 check. Recounts the acceptance numbers from the raw rows and warns on drift above 2%. After a roll-forward it prints the new counts and the steps to re-pin `scanner/expected.json`, and exits 1 until that is done. |
| `python -m scanner.build_db` | Milestone 2. Builds `data/scanner.db` (buildings, filings, audits, pulls) and prints the segment counts. Stops without replacing the database if LA's city-owned label looks changed (DRIFT.md item 3) or the count pin is for another year. |
| `python -m scanner.export` | Writes `site/data/` (meta, search index, building files, prospects). |
| `python -m scanner.outreach --sample 5` | Prints example outreach lines, LA included, for review. Nothing is published. |

Tests:

```sh
.venv/bin/python -m pytest -q                                   # pipeline, rules, guardrails, source links
LIVE_SOURCES=1 .venv/bin/python -m pytest -q tests/test_source_urls.py   # also asks the city APIs (about 25 requests)
npm test                                                        # search, filters, CSV
npm run e2e                                                     # real Chrome, phone to desktop widths (Node 22+); about 2 minutes
```

## How it works

```
city APIs ──pull──> data/raw/<city>/<stamp>/rows.json   (complete copy, sha256, as-of stamp)
                         │
                    build_db + classify  ──> data/scanner.db
                         │                   buildings · filings · audits · pulls
                    export + outreach    ──> site/data/*.json
                         │
                    static site (site/)  ──  search, building pages, prospect list, CSV
```

The site never calls the city APIs. It only reads the JSON the nightly job writes.

- **Data as of** is when the city last changed its rows (`rowsUpdatedAt`), shown as a Pacific date. **Checked** is the last time a run confirmed that is still the newest data. Checked moves every night. Data as of moves only when the city publishes.
- **Segments** (report year 2025): LA *lapsed* = NOT COMPLIED 2025 and COMPLIED 2024; *chronic* = NOT COMPLIED 2023, 2024 and 2025; *other* = the rest. SF uses the violation type (did not report or insufficient data) as its segment and gets the same lapsed, chronic and other labels as its history.
- **Priority**: LA lapsed and every SF violation are A. LA chronic and other are B. City-owned buildings are labeled, left out of the prospect list unless you ask for them, and get no outreach line. Within a priority, larger size bands come first.
- **Last filed by** (LA) is the entity on the building's newest COMPLIED year. For lapsed buildings that is the 2024 filer. Names that may belong to a person are withheld (DRIFT.md item 12).
- The report year is pinned in `scanner/config.py`. When a city starts publishing 2026, the build warns, and moving to 2026 is the founder's decision. To roll forward, change `REPORT_YEAR` and add that year's `YEAR_NOTES` and `SF_DUE_DATE_SENTENCES`. Then run `python -m scanner.counts`: it prints the new year's counts and stops, with a block of the `report_year`, `pinned_rows_updated_at` and `counts` to put in `scanner/expected.json`. Paste them in, rerun it (every check should say MATCH), then run the build. The site's text follows `meta.cities.*.report_year` (the prospect page's description and its History filter), so no site file needs an edit.

CSV columns: the spec's twelve (`id, city, address, size_band, segment, status_raw, year, last_filed_by, audit_status, as_of, source_url, outreach_line`) in that order, then `priority, history, last_filed_year, last_filed_by_note, building_name, same_address_others, same_address_complied` (19 in all). `last_filed_by_note` is `withheld` when LADBS's name may be a person's; `last_filed_by` is then empty.

## Decisions for the founder

| Decision | Where | State |
|---|---|---|
| What LA's program year 2025 means. Research (high confidence): calendar-2025 data, which LADBS says was due June 1, 2026. | `config.LA_OUTREACH_APPROVED` | Accepted 2026-10-16 (`True`). LA lines and LA's year note are in the site data and CSV. |
| LA line wording. The memo recommends adding the data year and due date, and naming LADBS's column ("entity responsible for the benchmark") instead of "filed by". | `scanner/outreach.py` `la_line` | Spec wording plus ` Source: <url>` at the end. The "filed by" part is left out when the name is withheld or missing. Approved as is on 2026-10-16; the memo's rewording is not applied. |
| The SF date sentence. It is confirmed and credited to SF Environment, because the city code still says April 1. | `config.SF_DUE_DATE_CONFIRMED` (on/off) and `config.SF_DUE_DATE_SENTENCES` (the text for each year) | On |
| SF as-of date: October 9 (portal update, used now) or October 8 (SF's own per-row date). | `scanner/export.py` | October 9 |
| Hand-check each LA building on LADBS's live status page before sending; the open data runs a few days behind. | `meta.flags.la_live_status_url` | Recommended |
| LA filer values that are firms named after a person ("Given Surname Properties, Inc"). Clear person shapes are withheld (DRIFT item 12); these 23 values still show, on 41 pages and 13 default prospect rows. | `scanner/classify.py` `looks_personal`, `KNOWN_FILERS` | Shown |
| One SF building name reads as a person's name. SF publishes `building_name` as a building field; it is searchable and shown on the page, never in a line or the CSV (not a prospect). | `scanner/build_db.py` (SF `building_name`) | Shown as SF lists it |
| Owner contact lookup | not built | Out of scope for v1 |
| Public URL and domain | `.github/workflows/nightly.yml` | Nothing runs on a schedule or deploys until `DEPLOY_ENABLED` is set |

## Deploy (Milestone 5, needs approval)

The repo is on GitHub (public): github.com/jonathantsang26/compliance-scanner. Pages is off and the workflow has never run. These steps are for the founder.

1. Get a Socrata app token. It is free: sign in at data.lacity.org or data.sf.gov, then Developer Settings, then Create New App Token. One token works on both portals.
2. Add the token as the repository secret `SOCRATA_APP_TOKEN`. The nightly job fails on purpose without it.
3. Settings > Pages > Source: **GitHub Actions** (free on a public repo). Cloudflare Pages or Netlify also work. Point them at `site/` after running `python -m scanner.build`.
4. Run the workflow by hand (Actions > Nightly refresh > Run workflow) with **force** ticked. It pulls, builds and runs every test, but does not publish yet.
5. Once the URL is approved, add the repository variable `DEPLOY_ENABLED = true` and run it again. Only then does the schedule start: it publishes nightly at 13:17 UTC. Until that variable is set, nothing runs on its own.
6. Checkpoint: after each run the site's "checked" time is new. The "data as of" date changes when a city publishes new rows; a forced run only changes "checked".
7. If one city's pull fails, the other city still refreshes and publishes, and the run ends red (its last job, `status`, fails) so GitHub emails you. The pull error in the build job's log says why. For a refused drop in rows, check the city portal, then run the workflow by hand with **force** ticked.

## Guardrails, and how they're enforced

- Status labels are the city's own words. Tests fail if any LA line or page says "not filed" or "didn't file", or if a line has no "NOT COMPLIED" (`tests/test_outreach.py`, `tests/e2e/site.test.js`).
- Every building page and CSV row carries the as-of date and a row-level source link. Every outreach line ends with `Source: <url>`, so a pasted line can still be checked (tests check all three).
- No dollar amounts, penalties or fines. pytest checks every outreach line, and an e2e test checks the home page, the prospect list and three building pages.
- No owner or personal data. The scanner lists buildings. LA filer names that may name a person are withheld everywhere: page, CSV and lines (tested on made-up names, and on the real data by `tests/test_names.py`, which reports building IDs only). Firms named after a founder still show; see Decisions.
- City-owned buildings are labeled, left out of the default prospect list, and get no outreach line (tested). The build stops if LA's city-owned label looks changed: an LA building in the 7,500 to 14,999 or 15,000 to 19,999 sqft band without it, or no city-owned LA building at all.
- An address that still has a comma inside after trimming (one LA address lists several house numbers) gets no outreach line until someone checks it by hand (tested).
- The product writes copy and never sends it. Before sending: CAN-SPAM requires a real postal address and a working opt-out.
- No city seals or logos. Every page's footer says, in static HTML, that the site is independent of LADBS and SF Environment, so it shows even if scripts or data fail.
- One pull per dataset per night, skipped when the city has not published. Socrata freshness headers are checked, and a sudden large drop in rows is refused.
