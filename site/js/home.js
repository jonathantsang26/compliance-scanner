import {
  buildIndex, buildingUrl, exactMatch, formatInt, makeLookup, rawStatusTone, search, searchStatus,
} from './core.js';
import { asOfLine, external, h, loadMeta, loadSearchDocs, renderFooter, showError } from './ui.js';

const form = document.getElementById('search-form');
const input = document.getElementById('q');
const results = document.getElementById('results');
const status = document.getElementById('search-status');

let ready = null; // Promise of {index, lookup}; rejects if the data can't load

function headline(meta) {
  const la = meta.cities.LA;
  const sf = meta.cities.SF;
  // The city's own note on what its report year covers, when there is one.
  const yearNote = (c) => (c.year_note
    ? h('p', { class: 'stat-detail' }, c.year_note, c.year_note_url ? [' ', external(c.year_note_url, 'Source ↗')] : null)
    : null);
  const card = (city, number, text, detail) => h('article', { class: 'stat-card', 'data-city': city },
    h('p', { class: 'stat-city' }, city === 'LA' ? 'Los Angeles' : 'San Francisco'),
    h('p', { class: 'stat-number' }, formatInt(number)),
    h('p', { class: 'stat-text' }, text),
    detail,
    yearNote(city === 'LA' ? la : sf),
    h('p', { class: 'stat-asof' }, asOfLine(city === 'LA' ? la : sf)));
  document.getElementById('headline').replaceChildren(
    card('LA', la.headline.not_complied,
      `LA buildings marked NOT COMPLIED for program year ${la.report_year}`,
      h('p', { class: 'stat-detail' },
        `of ${formatInt(la.buildings_in_report_year)} buildings LADBS lists for ${la.report_year}`)),
    card('SF', sf.headline.violations,
      `SF buildings in benchmark violation for ${sf.report_year} (${formatInt(sf.headline.did_not_report)} did not report, ${formatInt(sf.headline.insufficient_data)} insufficient data)`,
      h('p', { class: 'stat-detail' },
        `City labels: '${sf.headline_labels.did_not_report}' (${formatInt(sf.headline.did_not_report)}), '${sf.headline_labels.insufficient_data}' (${formatInt(sf.headline.insufficient_data)})`)),
  );
}

function resultItem(doc) {
  const idLine = doc.city === 'LA' ? `Building ID ${doc.key}` : `Parcel ${doc.key}`;
  return h('li', {},
    h('a', { href: buildingUrl(doc.id), class: 'result' },
      h('span', { class: 'result-main' },
        h('span', { class: 'city-chip', 'data-city': doc.city }, doc.city),
        h('span', { class: 'result-addr' }, doc.address)),
      doc.name ? h('span', { class: 'result-sub' }, `Building name: ${doc.name}`) : null,
      h('span', { class: 'result-sub' }, [idLine, doc.zip].filter(Boolean).join(' · ')),
      h('span', { class: `status-chip tone-${rawStatusTone(doc.status)}` }, `${doc.status} · ${doc.year}`)));
}

async function run(query, { navigate = false } = {}) {
  const q = query.trim();
  if (!q) {
    results.replaceChildren();
    status.textContent = '';
    return;
  }
  if (!ready) return;
  status.textContent = 'Loading the building list…';
  let index;
  let lookup;
  try {
    ({ index, lookup } = await ready);
  } catch (err) {
    results.replaceChildren();
    showError(status, `Search is unavailable (${err.message}).`);
    return;
  }
  const result = search(q, index, lookup);
  if (navigate && result.target) {
    window.location.assign(buildingUrl(result.target.id));
    return;
  }
  results.replaceChildren(...result.hits.map(resultItem));
  status.textContent = searchStatus(result, navigate);
}

let timer;
let userSearched = false; // typed or pressed Enter, possibly before the data loaded
input.addEventListener('input', () => {
  userSearched = true;
  clearTimeout(timer);
  timer = setTimeout(() => run(input.value), 120);
});
form.addEventListener('submit', (e) => {
  e.preventDefault();
  userSearched = true;
  clearTimeout(timer);
  run(input.value, { navigate: true });
});

async function init() {
  // ?q=... runs a search on load; an exact ID or parcel jumps straight to the building.
  const q = new URLSearchParams(window.location.search).get('q');
  if (q) input.value = q;
  ready = loadSearchDocs().then((docs) => ({ index: buildIndex(docs), lookup: makeLookup(docs) }));
  ready.then(({ lookup }) => {
    document.body.dataset.searchReady = 'true';
    const exact = q ? exactMatch(q, lookup) : null;
    if (exact?.direct) window.location.replace(buildingUrl(exact.doc.id));
    // A ?q= search runs now, unless the person already searched: that search is
    // waiting for the same data, and its message ("No single exact match…") must stay.
    else if (input.value.trim() && !userSearched) run(input.value);
  }, (err) => showError(status, `Search is unavailable (${err.message}).`));

  try {
    const meta = await loadMeta();
    headline(meta);
    renderFooter(meta);
  } catch (err) {
    showError(document.getElementById('headline'), `Could not load the data (${err.message}).`);
    renderFooter(null);
  }
}

init();
