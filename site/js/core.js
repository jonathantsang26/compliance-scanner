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
// while someone is still typing "Street" or "North". The two-letter ones are
// safe because each letter is a prefix of what it replaces: a prefix search
// for "s" finds everything "so" would, and SOUTH too (indexed as "s").
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
  no: 'n', nor: 'n', nort: 'n', so: 's', sou: 's', sout: 's', ea: 'e', eas: 'e', we: 'w', wes: 'w',
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

// Spelled-out numbers become digits, so "One Post Street" and "1 Post St" are the same words.
const NUMBER_WORDS = {
  one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9', ten: '10',
  eleven: '11', twelve: '12', thirteen: '13', fourteen: '14', fifteen: '15', sixteen: '16', seventeen: '17',
  eighteen: '18', nineteen: '19', twenty: '20',
};

// A Map, so a word like "constructor" can't pick up an Object property.
const WORD_MAP = new Map(Object.entries({ ...SUFFIXES, ...PARTIAL_WORDS, ...DIRECTIONS, ...ORDINALS, ...NUMBER_WORDS }));

// The street types an address ends with. A query that is only a house number
// and a street type ("4028 Blvd") names no street.
const STREET_TYPES = new Set(['st', 'ave', 'blvd', 'dr', 'rd', 'pl', 'ln', 'ct', 'ter', 'pkwy', 'hwy', 'sq', 'cir', 'plz', 'aly', 'way']);

// Characters left out of every word. U+FFFD stands for a character lost in the
// city's data: 4 LA addresses have one (la:473925826977 is one of them).
const DROPPED = /[.'’\uFFFD]/g;

export function normalizeTerm(term) {
  const t = term.toLowerCase().replace(DROPPED, '');
  if (!t) return null;
  // SF writes some numbered streets with a leading zero: "104 09TH ST" is on 9th St.
  if (/^0+[1-9]\d*(?:st|nd|rd|th)$/.test(t)) return t.replace(/^0+/, '');
  return WORD_MAP.get(t) ?? t;
}

// "Twenty-third" and "One Hundred Third" as one word ("23rd", "103rd"), up to
// LA's highest street number (259th). It has to happen before the text is split
// into words, because the split would cut "twenty-third" in two.
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const COMPOUND_ORDINAL = new RegExp(`\\b(?:(one|two)[\\s-]+hundred(?:[\\s-]+and)?[\\s-]+)?(?:(${Object.keys(TENS).join('|')})[\\s-]*)?`
  + `(${Object.keys(ORDINALS).join('|')})\\b|\\b(one|two)[\\s-]+hundredth\\b`, 'gi');

function ordinal(n) {
  const end = n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return `${n}${end}`;
}

function joinOrdinals(text) {
  return text.replace(COMPOUND_ORDINAL, (words, hundreds, tens, word, hundredth) => {
    if (hundredth) return ordinal(hundredth.toLowerCase() === 'one' ? 100 : 200);
    const n = Number.parseInt(ORDINALS[word.toLowerCase()], 10);
    // A single word is left to normalizeTerm, and "twenty tenth" is not a number.
    if ((!hundreds && !tens) || (tens && n > 9)) return words;
    return ordinal((hundreds ? (hundreds.toLowerCase() === 'one' ? 100 : 200) : 0) + (tens ? TENS[tens.toLowerCase()] : 0) + n);
  });
}

// MiniSearch's default split (spaces and punctuation), except that IDs and ZIP
// codes stay whole: parcel 3995/125 must not match the house number in "125 3rd St".
const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

export function tokenize(text, field) {
  if (field === 'key' || field === 'zip') return [String(text).trim()];
  return joinOrdinals(String(text)).split(SPACE_OR_PUNCTUATION);
}

export function terms(text) {
  return tokenize(text || '').map(normalizeTerm).filter(Boolean);
}

// ---- addresses and queries ----------------------------------------------------

// 5500, 1234A, 655-675
const HOUSE_NUMBER = /^\d+[a-z]?(?:-\d+[a-z]?)?$/i;

// A house number, also spelled out ("One Post Street").
function isHouseNumber(word) {
  return HOUSE_NUMBER.test(normalizeTerm(word) ?? '');
}

// A building's directional is a single N, S, E or W right after the house
// number, with more words after it ("5500 S FIGUEROA ST"). It is indexed on
// its own, so the address text is "5500 FIGUEROA ST". Spelled-out words stay
// part of the street name (NORTH POINT ST, CENTURY PARK EAST, WEST BLVD).
export function splitDirectional(address) {
  const text = (address || '').trim();
  const parts = text.split(/\s+/);
  if (parts.length >= 3 && isHouseNumber(parts[0]) && /^[nsew]\.?$/i.test(parts[1])) {
    return { dir: parts[1][0].toLowerCase(), street: [parts[0], ...parts.slice(2)].join(' ') };
  }
  return { dir: null, street: text };
}

// The house number of an address or name as index words ("655-675" -> ["655", "675"]).
function houseWords(text) {
  const first = (text || '').trim().split(/\s+/)[0];
  return isHouseNumber(first) ? terms(first) : [];
}

function houseNumber(text) {
  return houseWords(text)[0] ?? null;
}

// A unit, with a letter after its number when there is one ("#1 D", "Apt 4B").
const UNIT = /(?:\b(?:suite|ste|unit|apt|apartment)\b\.?\s*#?|#)\s*([a-z0-9-]+(?:\s+[a-z]\b)?)/gi;
const PLACE_AT_END = /(?:^|\s)(los angeles|san francisco|ca|california|usa|united states)\.?$/i;
const CITIES = new Map([['los angeles', 'LA'], ['la', 'LA'], ['san francisco', 'SF'], ['sf', 'SF']]);

// A unit or a part as one word, so "#1 D", "Unit 1D" and "#01-D" are all "1d".
function unitWord(text) {
  return terms(text).map((w) => w.replace(/^0+(?=\d)/, '')).join('') || null;
}

// The part named after a dash once the street is given ("350 RHODE ISLAND - NORTH",
// "80 Pier- M&R Bldg"). A range typed with spaces ("336 - 344 Mason St") is not one.
function splitPart(text) {
  const m = /\s[-–—]|[-–—]\s/.exec(text);
  const before = m ? text.slice(0, m.index).trim() : '';
  const part = m ? text.slice(m.index + m[0].length).replace(/^[\s\-–—]+/, '').trim() : '';
  if (!part || /^\d/.test(part) || before.split(/\s+/).length < 2) return { street: text, part: null };
  return { street: before, part };
}

// What tells apart records at one street address: a unit ("3450 3RD ST #1 D")
// or a part after a dash ("350 RHODE ISLAND ST - SOUTH"), as one word.
function unitOf(address) {
  const { part } = splitPart(address.replace(UNIT, ' '));
  if (part) return unitWord(part);
  const unit = [...address.matchAll(UNIT)][0];
  return unit ? unitWord(unit[1]) : null;
}

// True when the text names a street, not just a house number and a direction.
function hasStreetWord(text) {
  return text.trim().split(/\s+/).some((w, i) => w
    && !(i === 0 && isHouseNumber(w)) && !DIRECTION_LETTERS.has(normalizeTerm(w) ?? ''));
}

// The city in a part after a comma: "Los Angeles", "San Francisco, CA 94133", "LA".
function cityOf(part) {
  const words = part.toLowerCase().replace(/[.]/g, '').replace(/\b\d{5}(?:-\d{4})?\b/g, ' ')
    .replace(/\b(?:ca|california|usa|us|united states)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return CITIES.get(words) ?? null;
}

// Turns a pasted full address into the words worth searching:
// "5500 S Figueroa St, Los Angeles, CA 90037" -> "5500 S Figueroa St 90037".
// Keeps the street address (the first part with more than a unit in it) plus a
// ZIP found after it, and drops city, state and country words and a ZIP from
// the end, but only while a street name is left ("555 California" stays as
// typed). The units (Suite 100, Apt 4B, #200, or a part after a dash) and the
// city (LA or SF) come back on their own.
export function cleanQuery(text) {
  const parts = String(text ?? '').split(',');
  const units = [];
  let zip = null;
  let city = null;
  const withoutUnit = (s) => s.replace(UNIT, (_, u) => {
    units.push(unitWord(u));
    return ' ';
  }).replace(/\s+/g, ' ').trim();
  // "Suite 100, 555 California St" and ",5500 S Figueroa St" start with an empty part.
  let i = 0;
  let s = '';
  while (i < parts.length && !(s = withoutUnit(parts[i]))) i++;
  for (const part of parts.slice(i + 1)) {
    const rest = withoutUnit(part);
    zip ??= /\b(\d{5})(?:-\d{4})?\b/.exec(rest)?.[1] ?? null;
    city ??= cityOf(rest);
  }
  for (;;) {
    const z = /\s(\d{5})(?:-\d{4})?$/.exec(s);
    const p = z ? null : PLACE_AT_END.exec(s);
    if (z) zip ??= z[1];
    else if (p && hasStreetWord(s.slice(0, p.index))) city ??= CITIES.get(p[1].toLowerCase()) ?? null;
    else break;
    s = s.slice(0, (z ?? p).index).trim();
  }
  const { street, part } = splitPart(s);
  if (part) units.push(unitWord(part));
  return { text: street, zip, units: [...new Set(units.filter(Boolean))], city };
}

// One reading of a query: the text searched, its words, and its house number.
// `houseWords` holds every part of a range ("336-344 Mason St" -> 336, 344).
// `typed` is the words before a pasted ZIP, the last of them maybe half typed.
function reading(parts, zip, dir, cleaned) {
  const text = [...parts, zip].filter(Boolean).join(' ');
  const house = houseWords(text);
  return {
    text, typed: parts, words: terms(text), house: house[0] ?? null, houseWords: house, dir, zip,
    units: cleaned.units, city: cleaned.city,
  };
}

// A query's directional is N/S/E/W or North/South/East/West right after the
// house number, with more words after it. It is taken out of the words searched
// and used to order the results instead (rankByDirection). A spelled-out word
// can also be the start of the street's name ("6400 West Blvd" is on WEST BLVD),
// so `alt` keeps that second reading, with the word left in. keepZip: false
// drops a pasted ZIP.
export function parseQuery(query, options) {
  return parseCleaned(cleanQuery(query), options);
}

function parseCleaned(cleaned, { keepZip = true } = {}) {
  const zip = keepZip ? cleaned.zip : null;
  const parts = cleaned.text.split(/\s+/).filter(Boolean);
  const dir = parts.length >= 3 && isHouseNumber(parts[0]) ? normalizeTerm(parts[1]) : null;
  if (DIRECTION_LETTERS.has(dir)) {
    const spelled = parts[1].replace(/\./g, '').length > 1;
    return {
      ...reading([parts[0], ...parts.slice(2)], zip, dir, cleaned),
      alt: spelled ? reading(parts, zip, null, cleaned) : null,
    };
  }
  return { ...reading(parts, zip, null, cleaned), alt: null };
}

// ---- index --------------------------------------------------------------------

// The words of an address or name, without the part after a comma or a unit
// number ("Pier 17, Suite 100" -> pier, 17). With `base`, also without a part
// after a dash ("350 RHODE ISLAND - NORTH" -> 350, rhode, island).
function fieldWords(text, { base = false } = {}) {
  const street = text.split(',')[0].replace(UNIT, ' ');
  return terms(base ? splitPart(street).street : street);
}

// The street name without the house number or ZIP (`skip`), and the street
// type at the end apart: "5500 FIGUEROA ST" -> {name: "figueroa", type: "st"}.
// Only the last word can be the type, so a street named for one keeps it
// ("5344 CIRCLE DR" -> "cir"), and "4028 Blvd" names no street.
function streetParts(words, skip = []) {
  const rest = words.filter((w) => !skip.includes(w));
  const type = STREET_TYPES.has(rest[rest.length - 1]) ? rest.pop() : null;
  return { name: rest.join(' '), type };
}

// Adds to a search doc, once: `dir` and `street` (the address without its
// directional), and the street's name, type and house number, used to find
// the nearest buildings on a street. `base` names the street address without
// a unit or a part after a dash, and `unit` is that unit or part, so records
// at one street address can be found together. Done in place, so the index
// and the lookup share the same objects.
function prepareDoc(d) {
  if (d.street !== undefined) return d;
  Object.assign(d, splitDirectional(d.address));
  const house = houseWords(d.street);
  const baseWords = fieldWords(d.street, { base: true });
  const { name, type } = streetParts(baseWords, house);
  return Object.assign(d, {
    streetName: name, streetType: type, houseInt: house.length ? Number.parseInt(house[0], 10) : null,
    baseWords, base: house.length && name ? `${d.city}|${house.join(' ')}|${d.dir ?? ''}|${name}` : null,
    unit: unitOf(d.address),
  });
}

// The index keeps a numbered street that SF writes with a leading zero ("03RD")
// as written too, so the list doesn't empty while someone types it that way
// ("1509-1519 03"). Searches use normalizeTerm alone.
function indexTerm(term) {
  const word = normalizeTerm(term);
  const asWritten = term.toLowerCase();
  return word && word !== asWritten && /^0\d/.test(asWritten) ? [word, asWritten] : word;
}

export function buildIndex(docs) {
  const index = new MiniSearch({
    idField: 'id',
    fields: ['address', 'name', 'key', 'zip', 'dir'],
    // The address is indexed without its directional, which has its own field.
    extractField: (doc, field) => (field === 'address' ? doc.street : doc[field]),
    storeFields: [],
    tokenize,
    processTerm: indexTerm,
    searchOptions: {
      processTerm: normalizeTerm,
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
  // Buildings with a house number, by street name, to find the nearest ones.
  const byStreet = new Map();
  // Records at one street address ("3450 3RD ST #1 D", "#2 A" and "#2 B").
  const byBase = new Map();
  for (const d of docs) {
    prepareDoc(d);
    byId.set(d.id, d);
    if (d.city === 'LA') laKeys.set(d.key, d);
    else sfKeys.set(d.key, d);
    const m = /^\s*(\d+)/.exec(d.address || '');
    if (m) houseNumbers.add(m[1]);
    streets[d.city]?.add(d.streetName);
    if (d.streetName && d.houseInt != null) {
      if (!byStreet.has(d.streetName)) byStreet.set(d.streetName, []);
      byStreet.get(d.streetName).push(d);
    }
    if (d.base) {
      if (!byBase.has(d.base)) byBase.set(d.base, []);
      byBase.get(d.base).push(d);
    }
  }
  return { byId, laKeys, sfKeys, houseNumbers, streets, byStreet, byBase };
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
// the query: the same house number (a range like 336-344 counts from its first
// number, and every part typed must be in it), the same street name word for
// word (the street type may be left off), any ZIP given matches, and no other
// directional. Only then may pressing Enter open the building without
// showing the list. So "Green" or "4028 Blvd" only list matches, and
// "90 Montgomery St" does not open 90 NEW MONTGOMERY ST. A unit or a city
// typed is checked by search().
export function isAddressMatch(parsed, doc, lookup) {
  if (!parsed.house) return false;
  if (parsed.dir && parsed.dir !== doc.dir) return false;
  const { name: street, type } = streetParts(parsed.words, [...(parsed.houseWords ?? [parsed.house]), parsed.zip]);
  if (!street) return false;
  // SF addresses have no directionals, so "2300 Pacific Ave" may mean SF's
  // Pacific Ave rather than LA's 2300 S PACIFIC AVE: list both cities instead,
  // unless the city was typed.
  if (!parsed.dir && doc.dir && !parsed.zip && !parsed.city
    && lookup?.streets?.[doc.city === 'LA' ? 'SF' : 'LA']?.has(street)) return false;
  return [prepareDoc(doc).street, doc.name].some((field) => {
    if (!field || houseNumber(field) !== parsed.house) return false;
    const house = houseWords(field);
    // With or without a part after a dash: "350 Rhode Island" is also 350 RHODE ISLAND - NORTH.
    return [fieldWords(field), fieldWords(field, { base: true })].some((words) => {
      const own = streetParts(words, house);
      const allowed = new Set(doc.zip ? [...words, doc.zip] : words);
      // A street type that was typed must be the building's own. "St" can also
      // be Saint, so "553 S St Andrews St" is not 553 S ST ANDREWS PL.
      return parsed.words.every((w) => allowed.has(w)) && own.name === street
        && (!type || !own.type || own.type === type);
    });
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
// For an address, the prefix and typo pass leaves out the building ID, so a
// house number never matches the start of an ID ("4028 West Blvd" is not LA
// building 402817883111). A lone number still does ("4761028").
const ADDRESS_FIELDS = { fields: ['address', 'name', 'zip', 'dir'] };

// SF building names often leave off the street type: the building named
// "300 Grant" is at 300 Grant Ave. So an address also searches the names
// without its street type. These hits are listed, never opened on Enter.
function namesWithoutType(parsed, index) {
  const words = parsed.words.filter((w) => w !== parsed.zip);
  if (!parsed.house || words.length < 3 || !STREET_TYPES.has(words[words.length - 1])) return [];
  return index.search(words.slice(0, -1).join(' '), { ...EXACT_WORDS, fields: ['name'] });
}

// The last word typed, also searched as typed: "Av" and "Lane" are read as AVE
// and LN, but may be the start of AVALON or LANEWOOD.
function lastWordAsTyped(parsed, index, options) {
  const words = [...parsed.typed];
  const last = words.pop() ?? '';
  const asTyped = (term) => term.toLowerCase().replace(DROPPED, '') || null;
  if (!asTyped(last) || normalizeTerm(last) === asTyped(last)) return [];
  const rest = [...words, parsed.zip].filter(Boolean).join(' ');
  const queries = [{ combineWith: 'AND', queries: [last], processTerm: asTyped }];
  return index.search({ combineWith: 'AND', queries: rest ? [rest, ...queries] : queries }, options);
}

// Whole-word matches first, then prefix and typo matches, so "300 Grant" lists
// the SF building named "300 Grant" above 300 S GRAND AVE. asTyped: the last
// word is what was typed, not a completion.
function runSearch(parsed, index, lookup, { asTyped = false } = {}) {
  if (!parsed.text) return { docs: [], exactIds: new Set() };
  // "6400 West Blvd": also try "West" as part of the street name (WEST BLVD).
  const asStreet = parsed.alt ? index.search(parsed.alt.text, EXACT_WORDS) : [];
  const exactPasses = [...asStreet, ...index.search(parsed.text, EXACT_WORDS)];
  const exactIds = new Set(exactPasses.map((r) => r.id));
  const isAddress = parsed.house && parsed.words.length > parsed.houseWords.length;
  const fields = isAddress ? ADDRESS_FIELDS : {};
  const seen = new Set();
  const docs = [];
  for (const r of [...exactPasses, ...namesWithoutType(parsed, index), ...index.search(parsed.text, fields),
    ...(asTyped ? lastWordAsTyped(parsed, index, fields) : [])]) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    docs.push(lookup.byId.get(r.id));
  }
  return { docs: rankByDirection(docs, parsed.dir, new Set(asStreet.map((r) => r.id))), exactIds };
}

// The closest matches for an address the data doesn't have: buildings on the
// same street, nearest house number first ("4028 West Blvd" -> 4026 and 4037
// WEST BLVD). A street type or directional in the query must not disagree.
export function neighbors(readings, lookup, count = 5) {
  const scored = [];
  for (const p of readings) {
    const { name, type } = streetParts(p.words, [...p.houseWords, p.zip]);
    if (!p.house || !name) continue;
    const house = Number.parseInt(p.house, 10);
    for (const d of lookup.byStreet.get(name) ?? []) {
      if ((type && d.streetType && d.streetType !== type) || (p.dir && d.dir && d.dir !== p.dir)) continue;
      // The query's own side of the street first, then buildings with no directional.
      scored.push({ d, side: p.dir && d.dir !== p.dir ? 1 : 0, gap: Math.abs(d.houseInt - house) });
    }
  }
  scored.sort((a, b) => a.side - b.side || a.gap - b.gap);
  return [...new Set(scored.map((s) => s.d))].slice(0, count);
}

// The text with its last word swapped for each street type, ordinal or number
// that word could be the start of: "6400 Hollywood Bo" -> "6400 Hollywood
// boulevard", "8888 W T" -> "8888 W third". The whole word goes in, so
// "Twenty-Thi" can become "Twenty-third" (23rd).
function completions(text) {
  let cut = text.length;
  while (cut > 0 && !/[\s-]/.test(text[cut - 1])) cut--;
  const before = text.slice(0, cut);
  const last = text.slice(cut).toLowerCase().replace(DROPPED, '');
  if (!last || /\d/.test(last)) return [];
  const seen = new Set([normalizeTerm(last)]);
  const texts = [];
  for (const [word, short] of WORD_MAP) {
    if (word.length > last.length && word.startsWith(last) && !seen.has(short)) {
      seen.add(short);
      texts.push(`${before}${word}`);
    }
  }
  return texts;
}

// Returns {exact, hits, target, addressMatches, bothCities, city}. target is the
// building Enter should open, or null when the list should stay up: an ID or
// parcel number, or an address that matches exactly one building word for word
// (in the city typed, if one was). Exact address matches are listed first; with
// none, the nearest buildings on the same street are listed last. city is the
// city typed (LA or SF), or null.
export function search(query, index, lookup, limit = 25) {
  const exact = exactMatch(query, lookup);
  const cleaned = cleanQuery(query);
  let parsed = parseCleaned(cleaned);
  let found = runSearch(parsed, index, lookup, { asTyped: true });
  // Set when the words searched are not the ones typed; Enter then never opens a building.
  let guessed = false;
  if (!found.docs.length && parsed.zip) {
    // The city's ZIP can differ from the one pasted; try again without it.
    parsed = parseCleaned(cleaned, { keepZip: false });
    found = runSearch(parsed, index, lookup, { asTyped: true });
    guessed = true;
  }
  // "1430 E", "6310 Wes" or "900 M" is a house number and one letter, with no
  // street type: a direction or a street name still being typed.
  const typedStreet = streetParts(parsed.words, [...parsed.houseWords, parsed.zip]);
  if (!typedStreet.type && typedStreet.name.length === 1) guessed = true;
  // A street type, ordinal or number still being typed ("Hollywood Bo", "250 Fo",
  // "8888 W T") may match nothing yet, or other buildings, so try the words it
  // may become. What they find is listed after what the words typed find, so
  // there is no need once those fill the list.
  const tries = found.docs.length >= limit ? [] : completions(cleaned.text).map((text) => {
    const p = parseCleaned({ ...cleaned, text, zip: null });
    return { p, f: runSearch(p, index, lookup) };
  });
  // A guess whose street neighbors are listed too ("4028 West Bo" -> WEST BLVD).
  let nearGuess = null;
  if (!found.docs.length) {
    const pick = tries.find((t) => t.f.docs.length);
    if (pick) {
      ({ p: parsed, f: found } = pick);
      guessed = true;
    } else {
      // Still nothing: the last word may be a whole street name ("9999 Park"),
      // so neighbors come from what was typed and from the first guess.
      nearGuess = tries[0]?.p ?? null;
    }
  }
  const listed = new Set(found.docs);
  const guesses = [];
  for (const d of tries.flatMap((t) => t.f.docs)) {
    if (!listed.has(d)) guesses.push(d);
    listed.add(d);
  }
  // Either reading of "6400 West Blvd" can match: 6400 W ... BLVD or 6400 WEST BLVD.
  const readings = [parsed, parsed.alt].filter(Boolean);
  const exactHits = found.docs.filter((d) => found.exactIds.has(d.id));
  const strict = exactHits.filter((d) => readings.some((p) => isAddressMatch(p, d, lookup)));
  // "644 Broadway" is SF's 644 BROADWAY, and may be LA's 644 S BROADWAY with the
  // directional left off. isAddressMatch sets the LA record aside (see "2300
  // Pacific Ave"); add it back (no lookup: no cross-city rule) so Enter lists
  // both. The same goes for 1461 W FRANCISCO ST next to 1461 FRANCISCO ST.
  const atAddress = new Set(strict.length
    ? exactHits.filter((d) => strict.includes(d) || readings.some((p) => isAddressMatch(p, d, null))) : []);
  // Records at one street address go together: 350 RHODE ISLAND ST - SOUTH and
  // 350 RHODE ISLAND - NORTH, or 3450 3RD ST #1 D, #2 A and #2 B. Some lack a
  // word typed (NORTH has no ST), so they come from the lookup, unless more than
  // the street address was typed ("350 Rhode Island North").
  for (const d of [...atAddress]) {
    if (!readings.some((p) => p.words.every((w) => d.baseWords.includes(w) || w === p.zip))) continue;
    for (const s of lookup.byBase.get(d.base) ?? []) {
      if ((!s.streetType || !d.streetType || s.streetType === d.streetType) && (!parsed.zip || s.zip === parsed.zip)) {
        atAddress.add(s);
      }
    }
  }
  // A unit typed must be the record's own when it has one ("3450 3rd St #2 D"
  // is none of #1 D, #2 A and #2 B). A record without a unit fits any unit only
  // when no record at its street address has one: SF lists sf:0690/017 and
  // sf:0690/018 (unit #1) at one address, so "#2" there is neither. A city typed
  // must be the record's ("1 Market St, Los Angeles" is not SF's 1 MARKET ST).
  const unitFits = (d) => !parsed.units.length || parsed.units.includes(d.unit)
    || (!d.unit && !(lookup.byBase.get(d.base) ?? []).some((s) => s.unit));
  const matches = [...atAddress]
    .filter((d) => unitFits(d) && (!parsed.city || d.city === parsed.city))
    // Of two records at "22122 VICTORY BLVD" and "22122 W VICTORY BLVD", list the one typed first.
    .sort((a, b) => (a.dir === parsed.dir ? 0 : 1) - (b.dir === parsed.dir ? 0 : 1));
  const others = [...found.docs, ...guesses].filter((d) => !matches.includes(d));
  const nearReadings = [...readings, nearGuess, nearGuess?.alt].filter(Boolean);
  const near = matches.length ? [] : neighbors(nearReadings, lookup).filter((d) => !listed.has(d));
  // The neighbors keep their places even when the other matches fill the list.
  let hits = [...matches, ...others.slice(0, Math.max(0, limit - matches.length - near.length)), ...near].slice(0, limit);
  if (exact) hits = [exact.doc, ...hits.filter((d) => d.id !== exact.doc.id)].slice(0, limit);
  let target = null;
  if (exact?.direct) target = exact.doc;
  else if (!exact && !guessed && matches.length === 1) target = matches[0];
  return {
    exact, hits, target, addressMatches: matches.length, bothCities: new Set(matches.map((d) => d.city)).size > 1,
    city: parsed.city, parsed,
  };
}

// Says what to try next, never that the building isn't covered: the words may
// just be spelled differently from the city's data.
const NO_MATCHES = 'Nothing matched all of those words. Try just the street number and name (for example 5500 S Figueroa), an LA building ID, or an SF parcel number.';
const CITY_NAMES = { LA: 'Los Angeles', SF: 'San Francisco' };

// The line above the results for a search() result. submitted: Enter was
// pressed and did not open a building.
export function searchStatus(result, submitted) {
  const { exact, hits, addressMatches } = result;
  if (!hits.length) return NO_MATCHES;
  if (submitted) {
    // Enter only opens a building on an exact match (search().target), so
    // say why the list is still showing.
    if (exact && !exact.direct) return `LA building ID ${exact.doc.key} is listed first. Other buildings have ${exact.doc.key} as a house number.`;
    if (result.bothCities) return 'Both LA and SF list a building at that address. Pick one:';
    if (addressMatches > 1) return `${addressMatches} records have that address. Pick one:`;
    // "1 Market St, Los Angeles": SF lists 1 MARKET ST, LA does not.
    if (result.city && !addressMatches) return `No exact match in ${CITY_NAMES[result.city]}. Closest matches:`;
    // "Single", because the city may list the address written in a way that
    // search can't match exactly ("1234 1240, 1250,... W. WILSHIRE BLVD").
    return 'No single exact match for that address. Closest matches:';
  }
  return `${hits.length === 25 ? 'Top 25' : hits.length} match${hits.length === 1 ? '' : 'es'}`;
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
    // Short enough for the closed select at 320px.
    const note = b.sf && b.owned ? 'SF, city-owned' : b.sf ? 'SF only' : b.owned ? 'city-owned' : null;
    return [band, note ? `${band} (${note})` : band];
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
// last_filed_by_note is "withheld" where the city's value may name a person,
// so an empty last_filed_by there doesn't read as "no entity listed".
export const CSV_COLUMNS = [
  'id', 'city', 'address', 'size_band', 'segment', 'status_raw', 'year', 'last_filed_by', 'audit_status',
  'as_of', 'source_url', 'outreach_line', 'priority', 'history', 'last_filed_year', 'last_filed_by_note',
  'building_name', 'same_address_others', 'same_address_complied',
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
    last_filed_by_note: r.last_filed_by_note ?? '',
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
