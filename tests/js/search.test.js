// Search checks from SPEC.md "Functional checks", run against the built
// site/data. Build first: python -m scanner.build_db && python -m scanner.export
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import {
  buildIndex, cleanQuery, exactMatch, makeLookup, normalizeParcel, normalizeTerm, parseQuery, rankByDirection,
  search, shardOf, splitDirectional, tokenize,
} from '../../site/js/core.js';

const DATA = new URL('../../site/data/', import.meta.url);
const built = existsSync(new URL('search.json', DATA));
const docs = built ? JSON.parse(readFileSync(new URL('search.json', DATA))) : [];
const index = built ? buildIndex(docs) : null;
const lookup = built ? makeLookup(docs) : null;
const skip = built ? false : 'site/data not built yet';

const top = (q) => search(q, index, lookup).hits[0]?.id;
const topAddress = (q) => search(q, index, lookup).hits[0]?.address;
const target = (q) => search(q, index, lookup).target?.id ?? null;
const sameAddress = (a, b) => a.toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim()
  === b.toUpperCase().replace(/[.,]/g, '').replace(/\s+/g, ' ').trim();

test('"5500 S Figueroa" finds LA building 476102819647 first', { skip }, () => {
  assert.equal(top('5500 S Figueroa'), 'la:476102819647');
});

test('search tolerates St/Street and missing or spelled-out directionals', { skip }, () => {
  for (const q of ['5500 S FIGUEROA ST', '5500 South Figueroa Street', '5500 figueroa', '5500 Figueroa St.', '5500 s. figueroa', '5500 S. Figueroa']) {
    assert.equal(top(q), 'la:476102819647', q);
  }
  assert.ok(search('1 Montgomery St', index, lookup).hits.some((d) => d.address === '1 MONTGOMERY STREET'));
});

test('"211 Jefferson" finds SF parcel 0012/001 at 2739 TAYLOR ST', { skip }, () => {
  const hit = search('211 Jefferson', index, lookup).hits.find((d) => d.id === 'sf:0012/001');
  assert.ok(hit, 'parcel 0012/001 is in the results');
  assert.equal(hit.address, '2739 TAYLOR ST');
  assert.equal(top('211 Jefferson'), 'sf:0012/001');
});

test('a building ID or parcel number goes straight to its page', { skip }, () => {
  assert.deepEqual(exactMatch('476102819647', lookup), { doc: lookup.byId.get('la:476102819647'), direct: true });
  for (const q of ['0012/001', '0012-001', '0012 001', '0012001', 'sf:0012/001', ' 0012/001 ']) {
    const m = exactMatch(q, lookup);
    assert.equal(m?.doc.id, 'sf:0012/001', q);
    assert.equal(m.direct, true, q);
    assert.equal(target(q), 'sf:0012/001', q);
  }
  assert.equal(exactMatch('la:476102819647', lookup).doc.id, 'la:476102819647');
  assert.equal(target('476102819647'), 'la:476102819647');
});

test('every LA ID and SF parcel resolves to itself', { skip }, () => {
  for (const d of docs) {
    const m = exactMatch(d.key, lookup);
    assert.equal(m?.doc.id, d.id, d.key);
  }
});

test('short LA IDs that are also house numbers are listed first instead of jumped to', { skip }, () => {
  const shortIds = docs.filter((d) => d.city === 'LA' && d.key.length < 6);
  const clashing = shortIds.filter((d) => lookup.houseNumbers.has(d.key));
  assert.ok(clashing.length > 0);
  for (const d of clashing) {
    const { exact, hits, target: t } = search(d.key, index, lookup);
    assert.equal(exact.direct, false);
    assert.equal(hits[0].id, d.id);
    assert.equal(t, null, d.key);
  }
  for (const d of shortIds.filter((x) => !lookup.houseNumbers.has(x.key))) {
    assert.equal(exactMatch(d.key, lookup).direct, true, d.key);
  }
});

test('parcel formats normalize', () => {
  assert.equal(normalizeParcel('3721/120-a'), '3721/120-A');
  assert.equal(normalizeParcel('0236a/001'), '0236A/001');
  assert.equal(normalizeParcel('5500 S Figueroa'), null);
});

test('every building sits in the shard file the browser will ask for', { skip }, () => {
  const shards = new Map();
  for (const d of docs) {
    const s = shardOf(d.id);
    if (!shards.has(s)) shards.set(s, JSON.parse(readFileSync(new URL(`b/${s}.json`, DATA))));
    assert.ok(shards.get(s)[d.id], `${d.id} not in b/${s}.json`);
  }
});

// ---- Enter: open a building only on an exact match (review finding F2) --------

test('Enter stays on the list for an address that is not covered', { skip }, () => {
  // None of these addresses is in either city's data; each one used to open a
  // different building.
  for (const q of ['4028 West Blvd', '1411 S Highland Ave', '141 N Highland Ave', '55 Market St']) {
    const r = search(q, index, lookup);
    assert.equal(r.target, null, q);
    assert.ok(r.hits.length > 0, `${q} still lists the closest matches`);
  }
  // A different street that contains the typed one, or the same street name
  // in the other city, is not an exact match either.
  for (const q of ['90 Montgomery St', '140 Van Ness Ave', '211 South Park', '2300 Pacific Ave', 'Green', '5500']) {
    assert.equal(target(q), null, q);
  }
});

test('Enter opens the building for an exact address, ID or parcel', { skip }, () => {
  for (const [q, id] of [
    ['5500 S Figueroa St', 'la:476102819647'], ['476102819647', 'la:476102819647'], ['0012/001', 'sf:0012/001'],
    ['5500 S Figueroa St, Los Angeles, CA 90037', 'la:476102819647'], ['600 N Broadway', top('600 N Broadway')],
    ['211 Jefferson', 'sf:0012/001'], ['1 Sutter Street', 'sf:0291/001'], ['300 Grant', 'sf:0287/035'],
  ]) {
    assert.equal(target(q), id, q);
  }
});

test('Enter shows the list when two records share the address', { skip }, () => {
  const byAddress = new Map();
  for (const d of docs) {
    const k = `${d.city}|${d.address.toUpperCase()}`;
    byAddress.set(k, [...(byAddress.get(k) ?? []), d.id]);
  }
  const shared = [...byAddress.values()].filter((ids) => ids.length > 1).slice(0, 20);
  assert.ok(shared.length > 0);
  for (const ids of shared) {
    const r = search(lookup.byId.get(ids[0]).address, index, lookup);
    assert.equal(r.target, null, ids.join(' '));
    for (const id of ids) assert.ok(r.hits.some((d) => d.id === id), id);
  }
});

test('typing a covered address as the city lists it never opens a different address', { skip }, () => {
  let opened = 0;
  for (const d of docs.filter((_, i) => i % 20 === 0)) {
    const t = search(d.address, index, lookup).target;
    if (!t) continue;
    opened++;
    assert.ok(sameAddress(t.address, d.address), `${d.address} opened ${t.address}`);
  }
  assert.ok(opened > 500, `${opened} addresses opened directly`);
});

// ---- directionals (F3) ----------------------------------------------------------

test('a directional ranks the matching side of the street first', { skip }, () => {
  assert.equal(topAddress('600 N Broadway'), '600 N BROADWAY');
  assert.equal(topAddress('201 N Figueroa St'), '201 N FIGUEROA ST');
  assert.equal(topAddress('1801 Century Park East'), '1801 CENTURY PARK EAST');
  assert.equal(topAddress('720 E E St'), '720 E E ST');
  assert.match(topAddress('North Point'), /NORTH POINT/i);
  assert.match(topAddress('West Blvd'), /^\d+ WEST BLVD$/);
  for (const q of ['5500 Figueroa', '5500 South Figueroa Street', '5500 S. Figueroa']) {
    assert.equal(top(q), 'la:476102819647', q);
  }
  // A spelled-out direction can be the street's name: "West" in WEST BLVD.
  assert.equal(topAddress('1240 West Blvd'), '1240 S WEST BLVD');
  assert.equal(topAddress('6400 West Blvd'), '6400 WEST BLVD');
  assert.equal(topAddress('100 North Point St'), '100 NORTH POINT ST');
});

test('the building directional is a single letter after the house number', () => {
  assert.deepEqual(splitDirectional('5500 S FIGUEROA ST'), { dir: 's', street: '5500 FIGUEROA ST' });
  assert.deepEqual(splitDirectional('720 E E ST'), { dir: 'e', street: '720 E ST' });
  // Spelled-out words are part of the street name.
  for (const a of ['100 NORTH POINT ST', '1801 CENTURY PARK EAST', '4026 WEST BLVD', 'One Post Street']) {
    assert.deepEqual(splitDirectional(a), { dir: null, street: a });
  }
});

test('a query directional is a letter or word after the house number', () => {
  assert.equal(parseQuery('600 N Broadway').dir, 'n');
  assert.equal(parseQuery('600 N Broadway').text, '600 Broadway');
  assert.equal(parseQuery('5500 South Figueroa Street').dir, 's');
  assert.equal(parseQuery('5500 S. Figueroa').dir, 's');
  assert.equal(parseQuery('5500 Sou Figueroa').dir, 's');
  // Not right after a house number, or nothing after it: stays a search word.
  assert.equal(parseQuery('1801 Century Park East').dir, null);
  assert.equal(parseQuery('North Point').dir, null);
  assert.equal(parseQuery('600 N').dir, null);
  assert.deepEqual(parseQuery('North Point').words, ['n', 'point']);
});

test('direction ranking keeps search order inside each group', () => {
  const docs = [{ id: 1, dir: 's' }, { id: 2, dir: null }, { id: 3, dir: 'n' }, { id: 4, dir: 's' }, { id: 5, dir: 'n' }, { id: 6, dir: null }];
  assert.deepEqual(rankByDirection(docs, 'n').map((d) => d.id), [3, 5, 2, 6, 1, 4]);
  assert.deepEqual(rankByDirection(docs, null).map((d) => d.id), [1, 2, 3, 4, 5, 6]);
  // A hit that matched the spelled-out word as part of its street name counts as matching.
  assert.deepEqual(rankByDirection(docs, 'n', new Set([4])).map((d) => d.id), [3, 4, 5, 2, 6, 1]);
});

// ---- IDs and ZIPs are whole words (F4), whole words first (F5) -------------------

test('parcel and ID numbers do not outrank addresses', { skip }, () => {
  assert.equal(topAddress('125 3rd St'), '125 3RD ST');
  assert.equal(top('4761028'), 'la:476102819647');
  assert.deepEqual(tokenize('3995/125', 'key'), ['3995/125']);
  assert.deepEqual(tokenize('94133', 'zip'), ['94133']);
  assert.deepEqual(tokenize('3995/125 Main'), ['3995', '125', 'Main']);
});

test('whole-word matches come before prefix and typo matches', { skip }, () => {
  assert.ok(search('1 Sutter Street', index, lookup).hits.slice(0, 3).some((d) => d.id === 'sf:0291/001'));
  const ids = search('300 Grant', index, lookup).hits.map((d) => d.id);
  const grand = docs.find((d) => d.address === '300 S GRAND AVE').id;
  assert.ok(ids.includes('sf:0287/035'));
  assert.ok(!ids.includes(grand) || ids.indexOf('sf:0287/035') < ids.indexOf(grand));
});

// ---- pasted addresses (F6) ----------------------------------------------------------

test('pasted full addresses find the building', { skip }, () => {
  assert.equal(top('5500 S Figueroa St, Los Angeles, CA 90037'), 'la:476102819647');
  assert.equal(top('2739 Taylor St, San Francisco, CA 94133'), 'sf:0012/001');
  assert.match(topAddress('555 California Street, Suite 100'), /^555 CALIFORNIA ST/i);
  assert.match(topAddress('555 California'), /^555 CALIFORNIA ST/i);
  assert.equal(top('5500 S Figueroa St Los Angeles CA 90037'), 'la:476102819647');
  // A ZIP that differs from the city's still finds it, but Enter shows the list.
  const r = search('5500 S Figueroa St, Los Angeles, CA 90099', index, lookup);
  assert.equal(r.hits[0]?.id, 'la:476102819647');
  assert.equal(r.target, null);
});

test('pasted addresses are cut down to the street address and ZIP', () => {
  const cases = [
    ['5500 S Figueroa St, Los Angeles, CA 90037', '5500 S Figueroa St', '90037'],
    ['2739 Taylor St, San Francisco, CA 94133, USA', '2739 Taylor St', '94133'],
    ['555 California Street, Suite 100', '555 California Street', null],
    ['555 California Street Suite 100', '555 California Street', null],
    ['100 Main St Apt 4B', '100 Main St', null],
    ['100 Main St Ste. 300', '100 Main St', null],
    ['100 Main St #200', '100 Main St', null],
    ['555 California St San Francisco CA 94104', '555 California St', '94104'],
    ['600 W 7th St Los Angeles California United States', '600 W 7th St', null],
    // City and state words come off the end only, and only while a street is left.
    ['555 California', '555 California', null],
    ['100 S Los Angeles', '100 S Los Angeles', null],
    ['100 S Los Angeles St', '100 S Los Angeles St', null],
    ['California', 'California', null],
    ['90037', '90037', null],
  ];
  for (const [input, text, zip] of cases) assert.deepEqual(cleanQuery(input), { text, zip }, input);
});

// ---- half-typed words and spelled-out numbers (F7) -----------------------------------

test('half-typed street types and directions map to the abbreviation', () => {
  const cases = {
    stre: 'st', stree: 'st', aven: 'ave', avenu: 'ave',
    boul: 'blvd', boule: 'blvd', boulev: 'blvd', bouleva: 'blvd', boulevar: 'blvd', boulv: 'blvd',
    driv: 'dr', terr: 'ter', terra: 'ter', terrac: 'ter', parkw: 'pkwy', parkwa: 'pkwy',
    highw: 'hwy', highwa: 'hwy', squa: 'sq', squar: 'sq', circ: 'cir', circl: 'cir', plaz: 'plz',
    nor: 'n', nort: 'n', north: 'n', sou: 's', sout: 's', south: 's', eas: 'e', east: 'e', wes: 'w', west: 'w',
  };
  for (const [word, term] of Object.entries(cases)) assert.equal(normalizeTerm(word), term, word);
  // Single letters are kept now (they used to be dropped).
  for (const letter of ['n', 's', 'e', 'w']) assert.equal(normalizeTerm(letter.toUpperCase()), letter);
  assert.equal(normalizeTerm('constructor'), 'constructor');
});

test('spelled-out ordinals become numbers', () => {
  const cases = {
    first: '1st', twelfth: '12th', thirteenth: '13th', fifteenth: '15th', nineteenth: '19th',
    twentieth: '20th', thirtieth: '30th', fortieth: '40th', fiftieth: '50th', sixtieth: '60th',
    seventieth: '70th', eightieth: '80th', ninetieth: '90th',
  };
  for (const [word, term] of Object.entries(cases)) assert.equal(normalizeTerm(word), term, word);
});

test('the building stays in the results while a word is half typed', { skip }, () => {
  for (const q of ['5500 S Figueroa Stre', '5500 Sou Figueroa', '5500 South Figueroa Stree']) {
    assert.equal(top(q), 'la:476102819647', q);
  }
  assert.equal(topAddress('1801 Century Park Eas'), '1801 CENTURY PARK EAST');
  assert.equal(topAddress('600 Nort Broadway'), '600 N BROADWAY');
});
