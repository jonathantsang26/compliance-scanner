// Prospect list filters and CSV, run against the built site/data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  CSV_COLUMNS, DEFAULT_FILTERS, bandOptions, csvFilename, filterProspects, filtersFromParams, filtersToParams, toCsv,
} from '../../site/js/core.js';
import { parseCsv } from './csv.js';

const DATA = new URL('../../site/data/', import.meta.url);
const built = existsSync(new URL('prospects.json', DATA));
const rows = built ? JSON.parse(readFileSync(new URL('prospects.json', DATA))) : [];
const meta = built ? JSON.parse(readFileSync(new URL('meta.json', DATA))) : null;
const skip = built ? false : 'site/data not built yet';

test('prospects cover every report-year non-complier, sorted by priority then size', { skip }, () => {
  const la = meta.cities.LA.headline;
  const sf = meta.cities.SF.headline;
  assert.equal(rows.length, la.not_complied + sf.violations);
  const order = { A: 0, B: 1, excluded: 2 };
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1];
    const b = rows[i];
    assert.ok(order[a.priority] < order[b.priority]
      || (order[a.priority] === order[b.priority] && a.size_rank >= b.size_rank), `${a.id} before ${b.id}`);
  }
});

test('city-owned buildings never appear in the default list', { skip }, () => {
  const shown = filterProspects(rows, DEFAULT_FILTERS);
  assert.ok(shown.length > 0);
  assert.equal(shown.filter((r) => r.city_owned).length, 0);
  const owned = rows.filter((r) => r.city_owned).length;
  assert.equal(shown.length, rows.length - owned);
  assert.equal(filterProspects(rows, { ...DEFAULT_FILTERS, cityOwned: true }).length, rows.length);
});

test('flag filters match the spec counts', { skip }, () => {
  const sfBoth = filterProspects(rows, { ...DEFAULT_FILTERS, cityOwned: true, auditOverdue: 'yes' });
  assert.equal(sfBoth.length, meta.cities.SF.headline.violation_and_audit_overdue);
  const laData = filterProspects(rows, { ...DEFAULT_FILTERS, cityOwned: true, dataOnFile: 'yes' });
  assert.equal(laData.length, meta.cities.LA.headline.data_on_file);
  const lapsed = filterProspects(rows, { ...DEFAULT_FILTERS, cityOwned: true, city: 'LA', segment: 'lapsed' });
  assert.equal(lapsed.length, meta.cities.LA.headline.lapsed);
});

test('filters survive a round trip through the URL', () => {
  const f = { ...DEFAULT_FILTERS, city: 'SF', auditOverdue: 'yes', cityOwned: true };
  assert.deepEqual(filtersFromParams(filtersToParams(f)), f);
  assert.equal(filtersToParams(DEFAULT_FILTERS).toString(), '');
});

test('CSV has one row per building, with as_of and source_url on every row', { skip }, () => {
  for (const f of [DEFAULT_FILTERS, { ...DEFAULT_FILTERS, city: 'SF' }, { ...DEFAULT_FILTERS, cityOwned: true }]) {
    const shown = filterProspects(rows, f);
    const csv = parseCsv(toCsv(shown, meta));
    assert.deepEqual(csv.header, CSV_COLUMNS);
    assert.equal(csv.records.length, shown.length);
    const urls = new Set();
    for (const r of csv.records) {
      assert.match(r.as_of, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(r.source_url.startsWith('https://'), r.id);
      urls.add(r.source_url);
      assert.equal(r.as_of, meta.cities[r.city].as_of);
      if (r.city === 'LA' && r.outreach_line) {
        assert.match(r.outreach_line, /NOT COMPLIED/);
        assert.doesNotMatch(r.outreach_line, /not filed|didn't file/i);
      }
    }
    assert.equal(urls.size, csv.records.length, 'source URLs are unique');
  }
});

test('LA outreach lines stay empty in the CSV while the gate is closed', { skip }, () => {
  const csv = parseCsv(toCsv(rows, meta));
  const owned = new Set(rows.filter((r) => r.city_owned).map((r) => r.id));
  if (!meta.flags.la_outreach_approved) {
    assert.ok(csv.records.filter((r) => r.city === 'LA').every((r) => r.outreach_line === ''));
  }
  const sf = csv.records.filter((r) => r.city === 'SF');
  assert.ok(sf.some((r) => owned.has(r.id)), 'the data has city-owned SF rows to check');
  for (const r of sf) {
    if (owned.has(r.id)) assert.equal(r.outreach_line, '', r.id);
    else assert.ok(r.outreach_line.startsWith("SF Environment's public data (as of"), r.id);
  }
});

test('outreach lines: none for city-owned rows, none for LA while gated, and each ends with its source', { skip }, () => {
  for (const r of rows) {
    if (r.city_owned) assert.equal(r.outreach_line, null, `${r.id} is city-owned`);
    if (r.city === 'LA' && !meta.flags.la_outreach_approved) assert.equal(r.outreach_line, null, `${r.id} is LA`);
    if (r.outreach_line == null) continue;
    assert.ok(r.outreach_line.endsWith(` Source: ${r.source_url}`), r.id);
    assert.ok(r.outreach_line.includes(`(as of ${meta.cities[r.city].as_of_label})`), r.id);
    // The line drops stray punctuation at the end of the city's address ("2544 Mission St,").
    assert.ok(r.outreach_line.includes(r.address.replace(/[\s,.;]+$/, '')), r.id);
    assert.ok(r.outreach_line.includes(`'${r.status_raw}'`), `${r.id} quotes the city's label`);
    assert.doesNotMatch(r.outreach_line, /penalt|\bfines?\b|\$\s?\d/i, r.id);
    if (r.city === 'LA') {
      assert.match(r.outreach_line, /NOT COMPLIED/);
      assert.doesNotMatch(r.outreach_line, /not filed|didn't file|did not file/i);
    }
  }
  assert.ok(rows.some((r) => r.outreach_line), 'some rows have a line to check');
});

test('CSV keeps the spec columns first and the extras after', () => {
  assert.deepEqual(CSV_COLUMNS.slice(0, 12), [
    'id', 'city', 'address', 'size_band', 'segment', 'status_raw', 'year', 'last_filed_by', 'audit_status',
    'as_of', 'source_url', 'outreach_line',
  ]);
  assert.deepEqual(CSV_COLUMNS.slice(-2), ['same_address_others', 'same_address_complied']);
});

test('CSV tells a withheld name apart from "no entity listed"', { skip }, () => {
  assert.ok(CSV_COLUMNS.indexOf('last_filed_by_note') > CSV_COLUMNS.indexOf('outreach_line'), 'an extra, after the spec columns');
  const csv = parseCsv(toCsv(rows, meta));
  const withheld = csv.records.filter((r) => r.last_filed_by_note === 'withheld');
  assert.equal(withheld.length, rows.filter((r) => r.last_filed_by_note === 'withheld').length);
  assert.ok(withheld.length > 0, 'the data has withheld names to check');
  for (const r of withheld) {
    assert.equal(r.last_filed_by, '', r.id);
    assert.match(r.last_filed_year, /^\d{4}$/, r.id);
  }
  // A COMPLIED year with no entity listed has an empty note.
  const unnamed = csv.records.filter((r) => r.last_filed_year && !r.last_filed_by && !r.last_filed_by_note);
  assert.ok(unnamed.length > 0, 'the data has COMPLIED years with no entity listed');
  assert.ok(csv.records.every((r) => ['', 'withheld'].includes(r.last_filed_by_note)));
});

test('CSV carries the same-address counts', { skip }, () => {
  const shared = rows.filter((r) => r.same_address_others > 0);
  assert.ok(shared.length > 0);
  const csv = parseCsv(toCsv(shared, meta));
  csv.records.forEach((rec, i) => {
    assert.equal(rec.same_address_others, String(shared[i].same_address_others));
    assert.equal(rec.same_address_complied, String(shared[i].same_address_complied));
  });
});

test('size bands say when only city-owned or only SF buildings have them', () => {
  const fake = [
    { size_band: '100,000+ sqft', size_rank: 7, city: 'LA', city_owned: false },
    { size_band: '100,000+ sqft', size_rank: 7, city: 'SF', city_owned: false },
    { size_band: '15,000 to 19,999 sqft', size_rank: 4, city: 'LA', city_owned: true },
    { size_band: '10,000 to 19,999 sqft', size_rank: 3, city: 'SF', city_owned: false },
    { size_band: '7,500 to 14,999 sqft', size_rank: 2, city: 'LA', city_owned: true },
    { size_band: 'Under 10,000 sqft', size_rank: 1, city: 'SF', city_owned: true },
  ];
  assert.deepEqual(bandOptions(fake), [
    ['100,000+ sqft', '100,000+ sqft'],
    ['15,000 to 19,999 sqft', '15,000 to 19,999 sqft (city-owned only)'],
    ['10,000 to 19,999 sqft', '10,000 to 19,999 sqft (SF only)'],
    ['7,500 to 14,999 sqft', '7,500 to 14,999 sqft (city-owned only)'],
    ['Under 10,000 sqft', 'Under 10,000 sqft (SF, city-owned only)'],
  ]);
});

test('size-band labels match the built data', { skip }, () => {
  for (const [band, label] of bandOptions(rows)) {
    const inBand = rows.filter((r) => r.size_band === band);
    assert.equal(label.includes('city-owned only'), inBand.every((r) => r.city_owned), band);
    assert.equal(/\(SF(,| only)/.test(label), inBand.every((r) => r.city === 'SF'), band);
  }
});

test('the CSV file name uses the Pacific build date', () => {
  assert.equal(csvFilename({ built_date_pt: '2026-10-15', built_at: '2026-10-16T03:10:00+00:00' }), 'compliance-prospects-2026-10-15.csv');
  assert.equal(csvFilename({ built_at: '2026-10-16T03:10:00+00:00' }), 'compliance-prospects-2026-10-16.csv');
});

test('CSV cells that look like formulas are neutralized', () => {
  const fake = [{ id: 'la:1', city: 'LA', address: '=HYPERLINK("x")', size_band: 'b', segment: 'other', status_raw: 'NOT COMPLIED', year: 2025, source_url: 'https://x', outreach_line: null, priority: 'B', history: 'other' }];
  const csv = parseCsv(toCsv(fake, { cities: { LA: { as_of: '2026-10-11' } } }));
  assert.equal(csv.records[0].address, `'=HYPERLINK("x")`);
});
