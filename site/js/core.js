// Pure logic shared by the pages and by the Node tests (tests/js/).
// No DOM and no fetch in here, so it runs the same in both places.

import MiniSearch from '../vendor/minisearch-7.2.0.js';

// ---- search normalization ---------------------------------------------------
// Applied to every word, both when indexing and when searching, so
// "5500 South Figueroa Street" and "5500 S FIGUEROA ST" turn into the same words.

const SUFFIXES = {
  street: 'st', str: 'st', saint: 'st',
  avenue: 'ave', av: 'ave', avn: 'ave',
  boulevard: 'blvd', boul: 'blvd', blv: 'blvd',
  drive: 'dr', drv: 'dr',
  road: 'rd', place: 'pl', lane: 'ln', court: 'ct', terrace: 'ter',
  parkway: 'pkwy', highway: 'hwy', square: 'sq', circle: 'cir',
  plaza: 'plz', alley: 'aly', center: 'ctr', mount: 'mt',
};

// Half-typed words map to the same abbreviation, so results don't vanish
// while someone is still typing "Street" or "North".
const PARTIAL_WORDS = {
  stre: 'st', stree: 'st',
  aven: 'ave', avenu: 'ave',
  boule: 'blvd', boulev: 'blvd', bouleva: 'blvd', boulevar: 'blvd', boulv: 'blvd',
  driv: 'dr',
  terr: 'ter', terra: 'ter', terrac: 'ter',
  parkw: 'pkwy', parkwa: 'pkwy',
  highw: 'hwy', highwa: 'hwy',
  squa: 'sq', squar: 'sq',
  circ: 'cir', circl: 'cir',
  plaz: 'plz',
  nor: 'n', nort: 'n', sou: 's', sout: 's', eas: 'e', wes: 'w',
};

// Spelled-out directions become letters, so "North" and "N" are the same word.
const DIRECTIONS = { north: 'n', south: 's', east: 'e', west: 'w' };
const DIRECTION_LETTERS = new Set(['n', 's', 'e', 'w']);

const ORDINALS = {
  first: '1st', second: '2nd', third: '3rd', fourth: '4th', fifth: '5th',
  sixth: '6th', seventh: '7th', eighth: '8th', ninth: '9th', tenth: '10th',
  eleventh: '11th', twelfth: '12th', thirteenth: '13th', fourteenth: '14th', fifteenth: '15th',
  sixteenth: '16th', seventeenth: '17th', eighteenth: '18th', nineteenth: '19th',
  twentieth: '20th', thirtieth: '30th', fortieth: '40th', fiftieth: '50th',
  sixtieth: '60th', seventieth: '70th', eightieth: '80th', ninetieth: '90th',
};

// A Map, so a word like "constructor" can't pick up an Object property.
const WORD_MAP = new Map(Object.entries({ ...SUFFIXES, ...PARTIAL_WORDS, ...DIRECTIONS, ...ORDINALS }));

// The street types an address ends with. A query that is only a house number
// and a street type ("4028 Blvd") names no street.
const STREET_TYPES = new Set(['st', 'ave', 'blvd', 'dr', 'rd', 'pl', 'ln', 'ct', 'ter', 'pkwy', 'hwy', 'sq', 'cir', 'plz', 'aly', 'way']);

export function normalizeTerm(term) {
  const t = term.toLowerCase().replace(/[.'’]/g, '');
  if (!t) return null;
  return WORD_MAP.get(t) ?? t;
}

// MiniSearch's default split (spaces and punctuation), except that IDs and ZIP
// codes stay whole: parcel 3995/125 must not match the house number in "125 3rd St".
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

export function tokenize(text, field) {
  if (field === 'key' || field === 'zip') return [String(text).trim()];
  return String(text).split(SPACE_OR_PUNCTUATION);
}

export function terms(text) {
  return tokenize(text || '').map(normalizeTerm).filter(Boolean);
}

// ---- addresses and queries ----------------------------------------------------

// 5500, 1234A, 655-675
const HOUSE_NUMBER = /^\d+[a-z]?(?:-\d+[a-z]?)?$/i;

// A building's directional is a single N, S, E or W right after the house
// number, with more words after it ("5500 S FIGUEROA ST"). It is indexed on
// its own, so the address text is "5500 FIGUEROA ST". Spelled-out words stay
// part of the street name (NORTH POINT ST, CENTURY PARK EAST, WEST BLVD).
export function splitDirectional(address) {
  const text = (address || '').trim();
  const parts = text.split(/\s+/);
  if (parts.length >= 3 && HOUSE_NUMBER.test(parts[0]) && /^[nsew]\.?$/i.test(parts[1])) {
    return { dir: parts[1][0].toLowerCase(), street: [parts[0], ...parts.slice(2)].join(' ') };
  }
  return { dir: null, street: text };
}

// The house number of an address or name as index words ("655-675" -> ["655", "675"]).
function houseWords(text) {
  const first = (text || '').trim().split(/\s+/)[0];
  return HOUSE_NUMBER.test(first) ? terms(first) : [];
}

function houseNumber(text) {
  return houseWords(text)[0] ?? null;
}

const UNIT = /(?:\b(?:suite|ste|unit|apt|apartment)\b\.?\s*#?|#)\s*[a-z0-9-]+/gi;
const PLACE_AT_END = /(?:^|\s)(?:los angeles|san francisco|ca|california|usa|united states)\.?$/i;

// True when the text names a street, not just a house number and a direction.
function hasStreetWord(text) {
  return text.trim().split(/\s+/).some((w, i) => w
    && !(i === 0 && HOUSE_NUMBER.test(w)) && !DIRECTION_LETTERS.has(normalizeTerm(w) ?? ''));
}

// Turns a pasted full address into the words worth searching:
// "5500 S Figueroa St, Los Angeles, CA 90037" -> "5500 S Figueroa St 90037".
// Keeps the text before the first comma plus a ZIP found after it, drops
// unit numbers (Suite 100, Apt 4B, #200), and drops city, state and country
// words from the end only, and only while a street name is left ("555 California"
// stays as typed).
export function cleanQuery(text) {
  let s = String(text ?? '').trim();
  let zip = null;
  const comma = s.indexOf(',');
  if (comma >= 0) {
    zip = /\b(\d{5})(?:-\d{4})?\b/.exec(s.slice(comma + 1))?.[1] ?? null;
    s = s.slice(0, comma);
  } else {
    const m = /\s(\d{5})(?:-\d{4})?$/.exec(s);
    if (m) {
      zip = m[1];
      s = s.slice(0, m.index);
    }
  }
  s = s.replace(UNIT, ' ').replace(/\s+/g, ' ').trim();
  for (let m = PLACE_AT_END.exec(s); m && hasStreetWord(s.slice(0, m.index)); m = PLACE_AT_END.exec(s)) {
    s = s.slice(0, m.index).trim();
  }
  return { text: s, zip };
}

// A query's directional is N/S/E/W or North/South/East/West right after the
// house number, with more words after it. It is taken out of the words searched
// and used to order the results instead (rankByDirection).
export function parseQuery(query) {
  const { text, zip } = cleanQuery(query);
  const parts = text.split(/\s+/).filter(Boolean);
  let dir = null;
  let dirSpelled = false;
  if (parts.length >= 3 && HOUSE_NUMBER.test(parts[0])) {
    const t = normalizeTerm(parts[1]);
    if (DIRECTION_LETTERS.has(t)) {
      dir = t;
      dirSpelled = parts[1].replace(/\./g, '').length > 1;
      parts.splice(1, 1);
    }
  }
  const searched = [...parts, zip].filter(Boolean).join(' ');
  return { text: searched, words: terms(searched), house: houseNumber(searched), dir, dirSpelled, zip };
}

function withoutZip(parsed) {
  const text = parsed.text.replace(new RegExp(`\\s*\\b${parsed.zip}$`), '');
  return { ...parsed, text, words: terms(text), house: houseNumber(text), zip: null };
}

// ---- index --------------------------------------------------------------------

// Adds `dir` and `street` (the address without its directional) to a search
// doc. Done in place, so the index and the lookup share the same objects.
function prepareDoc(d) {
  if (d.street === undefined) Object.assign(d, splitDirectional(d.address));
  return d;
}

// The words of an address or name, without the part after a comma or a unit
// number ("Pier 17, Suite 100" -> pier, 17).
function fieldWords(text) {
  return terms(text.split(',')[0].replace(UNIT, ' '));
}

// The street name alone: no house number, ZIP or street type ("5500 FIGUEROA ST" -> "figueroa").
function streetName(words, skip = []) {
  return words.filter((w) => !skip.includes(w) && !STREET_TYPES.has(w)).join(' ');
}

export function buildIndex(docs) {
  const index = new MiniSearch({
    idField: 'id',
    fields: ['address', 'name', 'key', 'zip', 'dir'],
    // The address is indexed without its directional, which has its own field.
    extractField: (doc, field) => (field === 'address' ? doc.street : doc[field]),
    storeFields: [],
    tokenize,
    processTerm: normalizeTerm,
    searchOptions: {
      combineWith: 'AND',
      prefix: true,
      // Allow small typos in street names, never in numbers.
      fuzzy: (term) => (term.length >= 5 && !/\d/.test(term) ? 0.2 : false),
      boost: { address: 2, name: 2, key: 1, zip: 1, dir: 0.5 },
    },
  });
  index.addAll(docs.map(prepareDoc));
  return index;
}

// ---- exact ID lookups -------------------------------------------------------

export function normalizeParcel(text) {
  // SF parcels look like 0012/001, 3721/120-A, 0236A/001. Accept a slash,
  // a dash, a space or nothing between block and lot.
  const m = text.trim().toUpperCase().replace(/\s+/g, '')
    .match(/^(\d{4}[A-Z]?)[/-]?(\d{3}[A-Z]?(?:-[A-Z])?)$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function makeLookup(docs) {
  const byId = new Map();
  const laKeys = new Map();
  const sfKeys = new Map();
  const houseNumbers = new Set();
  // Street names per city, to spot a street that exists in both ("PACIFIC AVE").
  const streets = { LA: new Set(), SF: new Set() };
  for (const d of docs) {
    prepareDoc(d);
    byId.set(d.id, d);
    if (d.city === 'LA') laKeys.set(d.key, d);
    else sfKeys.set(d.key, d);
    const m = /^\s*(\d+)/.exec(d.address || '');
    if (m) houseNumbers.add(m[1]);
    streets[d.city]?.add(streetName(fieldWords(d.street), houseWords(d.street)));
  }
  return { byId, laKeys, sfKeys, houseNumbers, streets };
}

// Returns {doc, direct} when the query is a building ID or parcel number.
// direct=false means "show it first in the list" instead of jumping to it:
// a few short LA IDs are also house numbers (DRIFT.md item 6).
export function exactMatch(query, lookup) {
  const q = query.trim();
  if (!q) return null;
  const prefixed = /^(la|sf)\s*:\s*(.+)$/i.exec(q);
  if (prefixed) {
    const city = prefixed[1].toLowerCase();
    const rest = prefixed[2].trim();
    const id = city === 'la' ? `la:${rest}` : `sf:${normalizeParcel(rest) ?? rest.toUpperCase()}`;
    const doc = lookup.byId.get(id);
    return doc ? { doc, direct: true } : null;
  }
  const digits = q.replace(/\s+/g, '');
  if (/^\d{3,12}$/.test(digits) && lookup.laKeys.has(digits)) {
    const direct = digits.length >= 6 || !lookup.houseNumbers.has(digits);
    return { doc: lookup.laKeys.get(digits), direct };
  }
  const parcel = normalizeParcel(q);
  if (parcel && lookup.sfKeys.has(parcel)) return { doc: lookup.sfKeys.get(parcel), direct: true };
  return null;
}

// ---- search -------------------------------------------------------------------

// True when the building's address (or its SF building name) says the same as
// the query: the same house number, the same street name word for word (the
// street type may be left off), any ZIP given matches, and no other
// directional. Only then may pressing Enter open the building without
// showing the list. So "Green" or "4028 Blvd" only list matches, and
// "90 Montgomery St" does not open 90 NEW MONTGOMERY ST.
export function isAddressMatch(parsed, doc, lookup) {
  if (!parsed.house) return false;
  if (parsed.dir && parsed.dir !== doc.dir) return false;
  const street = streetName(parsed.words, [parsed.house, parsed.zip]);
  if (!street) return false;
  // SF addresses have no directionals, so "2300 Pacific Ave" may mean SF's
  // Pacific Ave rather than LA's 2300 S PACIFIC AVE: list both cities instead.
  if (!parsed.dir && doc.dir && !parsed.zip && lookup?.streets?.[doc.city === 'LA' ? 'SF' : 'LA']?.has(street)) return false;
  return [prepareDoc(doc).street, doc.name].some((field) => {
    if (!field || houseNumber(field) !== parsed.house) return false;
    const words = fieldWords(field);
    const house = houseWords(field);
    const allowed = new Set(doc.zip ? [...words, doc.zip] : words);
    return parsed.words.every((w) => allowed.has(w)) && streetName(words, house) === street;
  });
}

// Hits with the query's directional first, then hits with none, then hits with
// a different one. The sort is stable, so each group keeps its search order.
// `asStreet` holds hits that matched a spelled-out direction as part of the
// street name ("1240 West Blvd" -> 1240 S WEST BLVD); they count as matching.
export function rankByDirection(docs, dir, asStreet = new Set()) {
  if (!dir) return docs;
  const group = (d) => (d.dir === dir || asStreet.has(d.id) ? 0 : d.dir == null ? 1 : 2);
  return [...docs].sort((a, b) => group(a) - group(b));
}

const EXACT_WORDS = { prefix: false, fuzzy: false };

// Whole-word matches first, then prefix and typo matches, so "300 Grant" lists
// the SF building named "300 Grant" above 300 S GRAND AVE.
function runSearch(parsed, index, lookup) {
  if (!parsed.text) return { docs: [], exactIds: new Set() };
  // "6400 West Blvd": also try "West" as part of the street name (WEST BLVD).
  const asStreet = parsed.dirSpelled ? index.search(`${parsed.dir} ${parsed.text}`, EXACT_WORDS) : [];
  const exactPasses = [...asStreet, ...index.search(parsed.text, EXACT_WORDS)];
  const exactIds = new Set(exactPasses.map((r) => r.id));
  const seen = new Set();
  const docs = [];
  for (const r of [...exactPasses, ...index.search(parsed.text)]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    docs.push(lookup.byId.get(r.id));
  }
  return { docs: rankByDirection(docs, parsed.dir, new Set(asStreet.map((r) => r.id))), exactIds };
}

// Returns {exact, hits, target, addressMatches}. target is the building Enter
// should open, or null when the list should stay up: an ID or parcel number,
// or an address that matches exactly one building word for word. Exact address
// matches are listed first.
export function search(query, index, lookup, limit = 25) {
  const exact = exactMatch(query, lookup);
  let parsed = parseQuery(query);
  let found = runSearch(parsed, index, lookup);
  let zipDropped = false;
  if (!found.docs.length && parsed.zip) {
    // The city's ZIP can differ from the one pasted; try again without it.
    parsed = withoutZip(parsed);
    found = runSearch(parsed, index, lookup);
    zipDropped = true;
  }
  const matches = found.docs.filter((d) => found.exactIds.has(d.id) && isAddressMatch(parsed, d, lookup))
    // Of two records at "22122 VICTORY BLVD" and "22122 W VICTORY BLVD", list the one typed first.
    .sort((a, b) => (a.dir === parsed.dir ? 0 : 1) - (b.dir === parsed.dir ? 0 : 1));
  let hits = [...matches, ...found.docs.filter((d) => !matches.includes(d))].slice(0, limit);
  if (exact) hits = [exact.doc, ...hits.filter((d) => d.id !== exact.doc.id)].slice(0, limit);
  let target = null;
  if (exact?.direct) target = exact.doc;
  else if (!exact && !zipDropped && matches.length === 1) target = matches[0];
  return { exact, hits, target, addressMatches: matches.length, parsed };
}

// ---- building files -----------------------------------------------------------

// FNV-1a hash, identical to scanner/export.py shard_of().
export function shardOf(id, count = 256) {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(id)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h % count).toString(16).padStart(2, '0');
}

export function buildingUrl(id) {
  return `building.html?id=${encodeURIComponent(id)}`;
}

// ---- labels -----------------------------------------------------------------

export const SEGMENT_LABELS = {
  lapsed: 'Lapsed',
  chronic: 'Chronic',
  other: 'Other non-compliant',
  did_not_report: 'Did not report',
  insufficient_data: 'Insufficient data',
};

export const PRIORITY_LABELS = { A: 'Priority A', B: 'Priority B', excluded: 'Excluded (city-owned)' };

// Shown on hover where the city's "entity responsible" value is left out.
export const WITHHELD_NOTE = 'This value may name a person; v1 does not publish personal data.';

// How each segment is defined, in the city's own terms.
export function segmentRule(segment, city, year) {
  const nc = city === 'LA' ? 'NOT COMPLIED' : 'in violation';
  const ok = city === 'LA' ? 'COMPLIED' : 'Complied';
  switch (segment) {
    case 'lapsed': return `${nc} in ${year}, ${ok} in ${year - 1}`;
    case 'chronic': return `${nc} in ${year - 2}, ${year - 1} and ${year}`;
    case 'other': return `${nc} in ${year}, any other history`;
    case 'did_not_report': return `Listed as '${year} - Violation - Did Not Report'`;
    case 'insufficient_data': return `Listed as '${year} - Violation - Insufficient Data'`;
    default: return '';
  }
}

// Status tone for coloring only; the text shown is always the raw label.
export function statusTone(status) {
  if (status === 'complied') return 'ok';
  if (status === 'not_complied' || status === 'did_not_report' || status === 'insufficient_data') return 'bad';
  return 'neutral';
}

export function rawStatusTone(raw) {
  if (!raw) return 'neutral';
  if (raw === 'COMPLIED' || /- Complied$/.test(raw)) return 'ok';
  if (raw === 'NOT COMPLIED' || /- Violation -/.test(raw)) return 'bad';
  return 'neutral';
}

export function formatInt(n) {
  return n == null ? '' : Number(n).toLocaleString('en-US');
}

// ---- prospect list ------------------------------------------------------------

export const DEFAULT_FILTERS = {
  city: 'all', segment: 'all', history: 'all', band: 'all', dataOnFile: 'any', auditOverdue: 'any', cityOwned: false,
};

const yesNo = (want, value) => want === 'any' || (want === 'yes' ? value === true : value === false);

// Rows arrive already sorted by priority, then size (scanner/export.py), so
// filtering keeps that order.
export function filterProspects(rows, f) {
  return rows.filter((r) =>
    (f.cityOwned || !r.city_owned)
    && (f.city === 'all' || r.city === f.city)
    && (f.segment === 'all' || r.segment === f.segment)
    && (f.history === 'all' || r.history === f.history)
    && (f.band === 'all' || r.size_band === f.band)
    // The two flags only exist in one city each; filtering on one keeps only that city.
    && (f.dataOnFile === 'any' || (r.city === 'LA' && yesNo(f.dataOnFile, r.data_on_file)))
    && (f.auditOverdue === 'any' || (r.city === 'SF' && yesNo(f.auditOverdue, r.audit_overdue))));
}

// Size-band filter options, largest first, as [value, label]. A band that only
// city-owned buildings, or only SF buildings, have says so in its label.
export function bandOptions(rows) {
  const bands = new Map();
  for (const r of rows) {
    const b = bands.get(r.size_band) ?? { rank: r.size_rank, owned: true, sf: true };
    b.owned &&= Boolean(r.city_owned);
    b.sf &&= r.city === 'SF';
    bands.set(r.size_band, b);
  }
  return [...bands.entries()].sort((a, b) => b[1].rank - a[1].rank).map(([band, b]) => {
    const only = [b.sf ? 'SF' : null, b.owned ? 'city-owned' : null].filter(Boolean);
    return [band, only.length ? `${band} (${only.join(', ')} only)` : band];
  });
}

export function filtersFromParams(params) {
  const f = { ...DEFAULT_FILTERS };
  for (const key of Object.keys(DEFAULT_FILTERS)) {
    const v = params.get(key);
    if (v == null) continue;
    f[key] = key === 'cityOwned' ? v === '1' : v;
  }
  return f;
}

export function filtersToParams(f) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) {
    if (value === DEFAULT_FILTERS[key]) continue;
    params.set(key, key === 'cityOwned' ? (value ? '1' : '0') : value);
  }
  return params;
}

// The spec's CSV columns first, in the spec's order, then the extras.
export const CSV_COLUMNS = [
  'id', 'city', 'address', 'size_band', 'segment', 'status_raw', 'year', 'last_filed_by', 'audit_status',
  'as_of', 'source_url', 'outreach_line', 'priority', 'history', 'last_filed_year', 'building_name',
  'same_address_others', 'same_address_complied',
];

// Spreadsheet apps run a cell that starts with = + - @ as a formula. A leading
// apostrophe makes them show it as plain text instead.
function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRecord(r, meta) {
  return {
    id: r.id,
    city: r.city,
    address: r.address,
    size_band: r.size_band,
    segment: SEGMENT_LABELS[r.segment] ?? r.segment,
    status_raw: r.status_raw,
    year: r.year,
    last_filed_by: r.last_filed_by ?? '',
    audit_status: r.audit_status ?? '',
    as_of: meta.cities[r.city].as_of,
    source_url: r.source_url,
    outreach_line: r.outreach_line ?? '',
    priority: r.priority === 'excluded' ? 'Excluded (city-owned)' : r.priority,
    history: SEGMENT_LABELS[r.history] ?? '',
    last_filed_year: r.last_filed_year ?? '',
    building_name: r.name ?? '',
    same_address_others: r.same_address_others ?? '',
    same_address_complied: r.same_address_complied ?? '',
  };
}

export function toCsv(rows, meta) {
  const lines = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const rec = csvRecord(r, meta);
    lines.push(CSV_COLUMNS.map((c) => csvCell(rec[c])).join(','));
  }
  // Byte-order mark so Excel opens it as UTF-8; CRLF line ends per RFC 4180.
  return `﻿${lines.join('\r\n')}\r\n`;
}

// The build's Pacific date, so a download made in the evening isn't stamped tomorrow (UTC).
export function csvFilename(meta) {
  return `compliance-prospects-${meta.built_date_pt ?? meta.built_at.slice(0, 10)}.csv`;
}
