# What "2025" means in each city's data

_Research run 2026-10-15 by four independent source sweeps (LA code, LADBS pages, LA secondary sources, SF) plus two adversarial checks per city. Nobody was contacted. Full findings with every quote and URL are in `sources.json` next to this file._

# Decision memo: what "2025" means in the LA and SF outreach lines

Prepared 2026-10-15 for founder sign-off (the Milestone 4 gate in SPEC.md). Research only: nothing was sent, submitted or posted, and no one was contacted.

**Bottom line**

- **LA:** program_year 2025 means calendar-2025 energy and water data. LADBS says it was due June 1, 2026. It is not the 2025 filing cycle. Confidence: high.
- **SF:** the spec is right. SF Environment says the 2025 benchmark was due May 1, 2026, and benchmark_year 2025 is calendar-2025 data. But the city code still says April 1, so the line should credit SF Environment for the date. Confidence: high on what SF Environment says.

## 1. Problems

1. **The LA year label (the open question).** The spec could not tell whether program_year 2025 means calendar-2025 data or the 2025 filing cycle. It means calendar-2025 data, filed in 2026, due June 1, 2026. The filing due June 1, 2025 covered calendar-2024 data. That filing is program_year 2024.
2. **Why the LADBS due-date pages would not open.** LADBS moved its site from ladbs.org to dbs.lacity.gov. Old EBEWE links now land on the new home page, not on the EBEWE page. The dataset description still points at the old link. The dates now sit in PDFs on dbs.lacity.gov.
3. **"Compliance Year" has two meanings at LADBS.** For benchmarking it is the data year: LADBS's status tool says "Select Compliance Year(s)" and lists data years. For audits and retro-commissioning (A/RCx) it is the deadline year: "A/RCx Compliance Year 2026" is due December 1, 2026. Vendors also name benchmarking by its filing year and call the June 1, 2026 filing "the 2026 cycle". A line that says only "2025" or "2026" can be misread.
4. **NOT COMPLIED is not "did not file", and it is not final.** The spec already says the first part, and LADBS's own documents confirm it. Statuses also keep changing after the deadline. The open data runs a few days behind LADBS's live status page.
5. **SF: the date is right, but only the agency says it.** SF Environment says May 1, 2026. Environment Code Sec. 2004 still says April 1. We found no ordinance or rule that moves the date.
6. **SF: DataSF's column description is wrong.** It says benchmark_year is "The year when the building's benchmark data was submitted". Every test says it is the data year. This settles DRIFT.md item 5.
7. **A small wording issue in the LA lapsed add-on.** "filed by {last_filed_by}" is our wording. LADBS names that column "ENTITY RESPONSIBLE FOR BENCHMARK".
8. **The spec suggested emailing LADBS.** The address is current, but public documents answered the question. No email is needed, and none was sent.

## 2. Evidence

Quotes are copied from the page; only spacing was cleaned up. "Our count" means a tally we made from a page or dataset, not a quote. Pages were fetched on 2026-10-15 unless a date is given. For each city, two separate checks re-opened the key sources and reached the same reading.

### LA: why the old due-date pages would not open

- The dataset description still says: "please visit LADBS' EBEWE site at http://www.ladbs.org/services/green-building-sustainability/existing-buildings-energy-water-efficiency-program". https://data.lacity.org/api/views/9yda-i4ya.json . On 2026-10-15 that link redirected to https://dbs.lacity.gov/ (the home page).
- LADBS's notice on the old site (Wayback copy from 2025-04-07): "The newly redesigned website will also have the web address or URL change from ladbs.org to dbs.lacity.gov". https://web.archive.org/web/20250407121737/https://www.ladbs.org/services/green-building-sustainability/existing-buildings-energy-water-efficiency-program/ebewe-compliance-status

### LA: what program_year 2025 covers, and its due date

- LADBS What's New & Alerts (PDF, "Last Updated 10/08/2026"; entry dated 02/18/2026): "Benchmark Year 2025 compliance due date is June 1, 2026." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/Benchmark-What%27s-New-FINAL.pdf
- LADBS Benchmarking FAQ #9 ("Last Updated 02/19/2026"): "Buildings that are subject to the EBEWE Ordinance must be benchmarked by June 1st every year for the preceding calendar year. For example, the benchmark report due by June 1, 2025 covers the energy and water usage for calendar year 2024 (January through December)." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/EBEWE-Benchmark-FAQs-FINAL.pdf
- Same FAQ, #45: "Benchmark Report must still be for January 1st to December 31st of the Benchmark Year".
- LADBS COVID notice (August 13, 2021): "Benchmarking of Program Years 2019 (deadline was 6/1/2020) and 2020 (deadline was 6/1/2021)." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/covid19-ebewe-deadlines.pdf
- Old LADBS status page (Wayback copy from 2025-04-07; the text itself is older): "Year (Benchmark Year) This is the year for which the building was required to be benchmarked against (e.g., report of energy usage for the year shown)." https://web.archive.org/web/20250407121737/https://www.ladbs.org/services/green-building-sustainability/existing-buildings-energy-water-efficiency-program/ebewe-compliance-status
- City code, LAMC 91.9708.1 (Wayback copy of American Legal from 2025-02-18, marked "2024 Rev. 2 (current)"): "the owner must complete and submit the initial benchmarking report on or before December 1, 2017, and annually no later than June 1 thereafter." https://web.archive.org/web/20250218035014/https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-293810
- LAMC 91.9705.1 (same archive date) says the report covers "the entire calendar year being reported". https://web.archive.org/web/20250218192220/https://codelibrary.amlegal.com/codes/los_angeles/latest/lamc/0-0-0-294028
- If an LA source says April 1, it is quoting the original 2016 text. Ord. 184674 said "annually no later than April 1 thereafter" (https://dbs.lacity.gov/sites/default/files/efs/pdf/publications/misc/ord_184674.pdf). Ord. 185198 replaced it with "annually no later than June 1 thereafter" ("Ordinance Effective Date: November 22, 2017"; https://dbs.lacity.gov/sites/default/files/efs/pdf/publications/misc/ordinances_185198.pdf).
- Our count, LADBS's live status report for year 2025 (the page reads "As of 10/15/2026 11:10 AM"): all 6,012 "Complied" dates fall between 02/13/2026 and 10/15/2026. None fall in 2025. The busiest day is June 1, 2026. The same 11,241 building IDs make up program_year 2025 in the open dataset. https://www.ladbsservices2.lacity.org/EBEWECompliance/Default/Index1?syear=2025
- Our count, the dataset's phase-in: private buildings of 50,000 to 99,999 sq ft first appear in program_year 2017, and 20,000 to 49,999 sq ft in 2018. Their first reports were due June 1, 2018 and June 1, 2019. That only fits if program_year is the data year. https://data.lacity.org/resource/9yda-i4ya.json

### LA: where the cycle stands on 2026-10-15

- **The June 1, 2026 deadline has passed.** We found no blanket extension, and What's New lists none. The last one was for 2022 data: "the City of Los Angeles is granting an extension of time until July 1, 2023 to submit Benchmark 2022 data to LADBS using ESPM." (PDF created 2023-06-02) https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/Extend-Benchmark-2022-Deadline-Final-060123.pdf . Caveat: the What's New PDF is overwritten in place and has no archive copies.
- **Late filings still count.** Our count: 1,979 of the 6,012 complied buildings complied after June 1, 2026, 54 of them in October 2026. LADBS's 2024 status list says: "This list will change as new buildings are added/deleted or other revisions are made such as updating the EBEWE Compliance Status." ("Last Updated: 6/5/2024") https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/ebewe-status_20240605.pdf
- **The open data runs behind.** On 10/15, LADBS's live page showed 24 buildings as COMPLIED that the open dataset (rows updated 2026-10-11) still lists as NOT COMPLIED. One of those complied dates is 10/09, before the refresh. Live totals that day: 6,012 COMPLIED and 5,229 NOT COMPLIED. The dataset has 5,988 and 5,253.
- **The 2026 benchmarking cycle is not open.** LADBS's status tool: "As of 10/15/2026 11:10 AM Select Compliance Year(s) 2016 2017 2018 2019 2020 2021 2022 2023 2024 2025 ALL". https://dbs.lacity.gov/benchmarking2026 returns "Page not found | LADBS" (HTTP 404). FAQ #38: "We send out the Notices to Comply every December 1st of the Program Year", and the submission link opens "sometime between January 15 and February 15 of the following year."
- **The same thing happened last year.** A Wayback copy of the status tool reading "As of 10/16/2025 05:10 PM" lists years only up to 2024 (https://web.archive.org/web/20251017003605/https://www.ladbsservices2.lacity.org/EBEWECompliance/Default/Index1?syear=2020). A copy from 2025-01-20 already lists 2024 (https://web.archive.org/web/20250120022627/https://www.ladbsservices2.lacity.org/EBEWECompliance). So the missing 2026 rows are expected, not a data gap.
- **So calendar-2026 data should be due June 1, 2027.** That date comes from the rule. LADBS has not published it.
- **Do not mix in A/RCx.** What's New (entry dated 10/08/2026): "A/RCx Compliance Year 2026 for Building IDs ending in 0 or 1 compliance due date is December 1, 2026." That is the separate audit track. It is not in this dataset.

### LA: what NOT COMPLIED means

- Annual Benchmark Compliance Instructions ("Last Updated 02/18/2026"): "Keep in mind, Benchmark compliance consists of registration, payment of fees, and submission of the annual benchmark report." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/annual-benchmark-compliance-instructions-final.pdf
- FAQ #33 (02/19/2026): "An ESPM receipt does not confirm compliance with the City’s requirements. Make sure you have completed all of the steps required by the City: 1. The building was registered with LADBS; 2. The annual registration fees were paid for the correct benchmark year, and 3. A report has been submitted to LADBS using ESPM for the appropriate calendar year."
- FAQ #28: a report needs the LADBS building ID and zip code from the notice. "Otherwise, LADBS cannot recognize and upload the data and the building will remain as “Not Complied”."
- User Guide 9, page 121 (guides "Last Updated 02/18/2026"): "If your building status still shows “NOT COMPLIED” even after submitting the Benchmark Report, verify that you have registered your building and paid the annual compliance disclosure fee." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/benchmarking-user-instruction-guides-toc-final.pdf
- Old status page (Wayback copy from 2025-04-07; text from about 2018): "Not complied means the building owner has not completed all of the requirements specified in the EBEWE Ordinance. For example, the owner may have submitted a benchmark report to Energy Star, but not to LADBS or has not registered the building with LADBS or has not paid the annual registration fee."
- FAQ #32: "Please note that it takes 5-10 business days from the date of submission for the “Benchmarked” column to be updated."
- FAQ #40: "Please note that payment of the non-compliance fee does not result in Compliance." It adds that each building's status "is posted publicly and, in the future, may be recorded on the property as an open violation."
- Our count, the 624 NOT COMPLIED rows that carry data: almost all show 2025 numbers that differ from the building's 2024 numbers, so they look like fresh 2025 reports. 616 were still NOT COMPLIED on LADBS's live page on 10/15. The likely cause is a missing registration or fee. That is an inference: LADBS does not publish a reason for each building.
- The field behind "last filed by": the dataset names the organization column "ENTITY RESPONSIBLE FOR BENCHMARK". https://data.lacity.org/api/views/9yda-i4ya.json

### LA: the contact address

- LADBS EBEWE portal (no page date; same text in Wayback copies from 2026-02-10 to 2026-07-07): "For assistance, email us regarding Benchmarking at ladbs.ebewe@lacity.org Audits & Retro-Commissioning at ladbs.arcx@lacity.org Please include the Building ID on the subject line." https://www.ladbsservices2.lacity.org/ebewe
- Benchmarking FAQ (02/19/2026): "Questions may be submitted to ladbs.EBEWE@lacity.org Please begin your subject line with “EBEWE Benchmark Question”." It is the same address with different capitals.
- A/RCx FAQ ("Last Updated 10/08/2026"): "Questions may be submitted to ladbs.ebewe@lacity.org Please begin your subject line with “EBEWE A/RCx Question”." https://dbs.lacity.gov/sites/default/files/efs/forms/pc17/EBEWE-ARCx-FAQs-FINAL.pdf
- The address is not on the dbs.lacity.gov EBEWE hub page, which holds only document tiles, or on the general LADBS contact page.

### SF: the due date

- SF Environment, ordinance page (no page date): "The 2025 Annual Energy Benchmark is due May 1, 2026." The same sentence is in Wayback copies from 2026-03-11 (before the deadline), 2026-08-10 and 2026-09-06. https://www.sfenvironment.org/existing-buildings-energy-performance-ordinance
- How to Comply page (no page date): "This year: 2025 Energy Benchmark Summary - Due May 1, 2026 Past years: 2024 Energy Benchmark Summary - Due May 1, 2025 2023 Energy Benchmark Summary - Due May 1, 2024 2022 Energy Benchmark Summary - Due May 1, 2023 2021 Energy Benchmark Summary - Due May 17, 2022 2020 Energy Benchmark Summary - Due April 1, 2021 2019 Energy Benchmark Summary - Due July 1, 2020" https://www.sfenvironment.org/energy-benchmarking-compliance-san-francisco
- FAQ (no page date): "When is my building’s benchmark due? Every year on May 1." and "Can I be granted an extension? No." https://www.sfenvironment.org/benchmarking-faq
- History: the same FAQ said "Every year on April 1." in a Wayback copy from 2022-12-08. https://web.archive.org/web/20221208014724/https://sfenvironment.org/benchmarking-faq . So "historically April 1" is true for most years up to the 2020 summary. Every summary since 2022 has been due May 1 of the next year.
- The code: Environment Code Sec. 2004(a)(1) (Wayback copy from 2023-05-19, version "2023 S-83"): "the owner must complete and submit the initial Annual Energy Benchmark Summary report on or before October 1, 2011, and annually no later than April 1 thereafter." Its history note ends at "amended by Ord. 74-19". https://web.archive.org/web/20230519151148/https://codelibrary.amlegal.com/codes/san_francisco/latest/sf_environment/0-0-0-1840
- The Board of Supervisors' ordinance lists for 2019 to 2026 show no later change to this chapter. The 2026 list was checked through entries dated 5/15/2026. https://sfbos.archive.sf.gov/ordinances-2026

### SF: what benchmark_year 2025 covers

- DataSF's description (the one that is wrong): "The year when the building's benchmark data was submitted". https://data.sf.gov/api/views/96ck-qcfe.json
- SF Environment names each report by its data year: "2010 Energy Benchmark Summary - Due October 1, 2011" (Wayback copy from 2022-01-19). https://web.archive.org/web/20220119075001/https://sfenvironment.org/energy-benchmarking-compliance-san-francisco
- FAQ: the data must cover "the year you are benchmarking (from January 1 through Dec 31)".
- DataSF's retired dataset described "Benchmark 2014 Status" as "Status of benchmark report due 4/1/2015." (Wayback copy from 2019-01-02) https://web.archive.org/web/20190102114156/https://data.sfgov.org/Energy-and-Environment/Existing-Commercial-Buildings-Energy-Performance-O/j2j3-acqj
- Our count from archived copies of the dataset: 2025 rows first appear in the copy with data as of 2026-03-06, mostly as "2025 - Upcoming" (2,375 rows). The copy with data as of 2026-07-31 has 726 "2025 - Violation - Did Not Report". Today's data has 628. https://web.archive.org/web/20260311014713id_/https://data.sfgov.org/api/views/96ck-qcfe/rows.json
- Our count: for the same commercial buildings, median energy use falls by about a fifth in the rows labelled 2020, then holds flat the next year. That is the 2020 lockdown, so the label is the data year. https://data.sf.gov/resource/96ck-qcfe.json
- FAQ: "The compliance map is not a real time record and only reflects the compliance status when SF Environment most recently refreshed the data."
- Related datasets: 4ua7-5sfx and vgqy-2ca4 are live filtered views of 96ck-qcfe, not older copies. Their metadata say "assetType": "filter" and "modifyingViewUid": "96ck-qcfe". The real older copy, j2j3-acqj, now returns "Cannot find view with id j2j3-acqj", though SF Environment pages still link to it.

### What we could not confirm

- The live code sites (American Legal) blocked us for both cities. LA's current code text rests on a February 2025 archive copy plus a third-party mirror dated September/October 2026. SF's rests on a 2023 archive copy plus the Board's ordinance lists through mid-May 2026.
- LADBS's What's New PDF has no archive copies, so a short-lived 2026 extension notice can't be fully ruled out.
- Why each of the 624 data-bearing LA rows is NOT COMPLIED. "Registration or fee missing" is an inference.
- LA's June 1, 2027 date for calendar-2026 data is derived, not published. SF has published no date for 2026 data.
- No SF source explains why the agency's date (May 1) differs from the code (April 1).
- Portfolio Manager report templates sit behind a login and were not viewed.
- Whether LA's compliance field ever reflects A/RCx. No LADBS document links the two, but that rests on absence of evidence.

### Where the evidence files are

Downloaded pages, PDFs, archive copies and query results sit in the session scratchpad. It is temporary, so copy what you want into the repo (README and config.py point to `docs/research/`, which does not exist yet):

- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/lamc-ebewe/ (LA code and ordinances)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/ladbs/ (LADBS PDFs, portal pages, live status reports)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/la-ebewe-secondary/ (vendor pages and cross-checks)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/la-fidelity-check/ and /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/la-opposite-check/ (LA verification)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/sf/ (SF pages, code, ordinances, dataset metadata)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/sf-fidelity-check/ and /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/sf-adversarial/ (SF verification, archived dataset copies)
- /private/tmp/claude-501/-Users-jonathantsang/b045b256-d0a7-4268-bdd6-5095e27b953d/scratchpad/research/memo-synthesis/ (this memo's draft)

## 3. What it means for the outreach lines

### LA

Current line (held while `LA_OUTREACH_APPROVED = False`):

> LADBS's public EBEWE data (as of {as_of}) lists {address} as NOT COMPLIED for program year 2025.

It is accurate. But a reader can take "2025" to mean the 2025 filing. Recommended:

> LADBS's public EBEWE data (as of {as_of}) lists {address} as NOT COMPLIED for program year 2025 (calendar-2025 energy and water data, which LADBS says was due June 1, 2026).

Lapsed add-on today:

> It was listed as COMPLIED for 2024, filed by {last_filed_by}.

Recommended, closer to LADBS's own column name:

> It was listed as COMPLIED for program year 2024, with {last_filed_by} named as the entity responsible for the benchmark.

Optional closing clause, for both cities:

> The city updates this list over time, so recent changes may not show yet.

Do not say, in LA lines:

- "not filed", "didn't file" or "did not report". The label is NOT COMPLIED, and 624 of these buildings sent data.
- "violation". LADBS says the status may be recorded as an open violation only "in the future".
- "overdue", "late" or "missed the deadline". The label does not say which step is missing.
- "compliance year 2025", "compliance year 2026" or "the 2026 cycle". These have more than one meaning.
- Anything about A/RCx or December 1, 2026. That is a separate obligation, not in this dataset.
- Any fee, fine or penalty language. The guardrail stays. Vendor pages state penalty figures that LADBS's own FAQ does not support.

Before sending any LA line by hand, look the building up on LADBS's public status page (https://www.ladbsservices2.lacity.org/EBEWECompliance/Default/Index1?syear=2025). It is fresher than the open data. Do it by hand: one automated fetch got HTTP 403, and the spec says to go easy on city servers.

The same fix fits the home page headline. "5,253 LA buildings marked NOT COMPLIED for program year 2025" should carry the data year and its as-of date. LADBS's live count was already 5,229 on 10/15.

### SF

Current did-not-report line (the date sentence is held while `SF_DUE_DATE_CONFIRMED = False`):

> SF Environment's public data (as of {as_of}) lists {address} as '2025 - Violation - Did Not Report'. The 2025 benchmark was due May 1, 2026.

Recommended: keep the first sentence, and credit the date to SF Environment in its own words:

> SF Environment's public data (as of {as_of}) lists {address} as '2025 - Violation - Did Not Report'. SF Environment says the 2025 Annual Energy Benchmark was due May 1, 2026.

Why credit it: the code says April 1. If an owner checks the code, the line is still true, because it reports what the agency says. Never cite Sec. 2004 for May 1.

Insufficient-data line: no change.

Do not say, in SF lines:

- "required by law by May 1", or any code cite for May 1.
- "your 2025 filing" or "filed in 2025". benchmark_year 2025 is calendar-2025 data, filed in 2026.
- Any fee, fine or penalty language. No SF amount was confirmed.
- The spec's phrase "your building shows as not filed for 2025" fits these rows, but "for 2025" is vague. Quoting the label is safer.

SF as-of date: every SF row says data_as_of 2026-10-08 ("Timestamp when the record (row) was last updated in the source system"). The portal published the rows on 2026-10-09 Pacific, and the scanner shows that date today. Both are true. October 8 is the safer claim.

## 4. Decisions for the founder

1. **Accept the LA reading.** program_year 2025 = calendar-2025 data, due June 1, 2026. Recommended: accept. Confidence is high.
2. **Pick the LA line.** Recommended: the version with the data year and due date. Then update `la_line` in `scanner/outreach.py` and set `LA_OUTREACH_APPROVED = True` in `scanner/config.py`.
3. **Pick the lapsed add-on.** Recommended: LADBS's column name instead of "filed by".
4. **Approve the SF date sentence, credited to SF Environment.** Recommended: set `SF_DUE_DATE_SENTENCE` to "SF Environment says the 2025 Annual Energy Benchmark was due May 1, 2026." and then set `SF_DUE_DATE_CONFIRMED = True`.
5. **Add the "recent changes may not show yet" clause?** Optional. Recommended for both cities.
6. **SF as-of date: October 8 or October 9?** Either is true. October 8 is safer. (Today the as-of date is the portal's rowsUpdatedAt, per the README.)
7. **Hand-check LADBS's live status page before each LA send?** Recommended: yes, by hand. No scraping.
8. **Email LADBS for written confirmation?** Not needed. If you want it anyway, it needs your go-ahead first. Nothing has been sent. If you approve one: ladbs.ebewe@lacity.org, with a subject line that starts "EBEWE Benchmark Question" and includes a Building ID.
9. **Keep the report year pinned at 2025.** Recommended: yes, until the 2026 deadlines pass. LADBS's tool still did not list the newest year in mid-October 2025, and it listed 2024 by January 2025. So LA 2026 rows will likely show up around the December 1 notices, before the submission link opens (an inference from that pattern). SF's first 2025 rows said "Upcoming", not violation. Do not treat either as non-compliance.
10. **Penalty language.** Recommended: keep it out. No change to the guardrail.

## 5. Learnings

- **A year label is not a date.** "2025" can mean the data year or the filing year. Both cities use the data year. Vendors use the filing year. LADBS uses "Compliance Year" for both. Always write the data year and the due date together.
- **Portal descriptions can be wrong.** DataSF's was. Test a label against the data: when rows first appear, when compliance dates cluster, and where a known event like 2020 lands.
- **Agency pages and the code can disagree.** Quote the agency for what the agency says. Cite the code only for what the code says.
- **City sites move.** LADBS moved to dbs.lacity.gov, and old links now go to the home page. Look for the agency's PDFs and their "Last Updated" lines.
- **Old code text lingers.** Any LA source that says April 1 is quoting the 2016 ordinance, replaced by June 1 in 2017. That is separate from SF's April 1.
- **A status is a snapshot.** Both cities keep updating after the deadline. Every line needs its as-of date, and a hand check before sending helps.
- **Vendor pages are leads, not sources.** They label cycles differently and overstate penalties.
- **Public documents were enough.** No one had to be contacted to answer the question.
