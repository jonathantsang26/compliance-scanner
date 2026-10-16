import {
  DEFAULT_FILTERS, PRIORITY_LABELS, SEGMENT_LABELS, WITHHELD_NOTE, bandOptions, buildingUrl, csvFilename, filterProspects,
  filtersFromParams, filtersToParams, formatInt, rawStatusTone, toCsv,
} from './core.js';
import { asOfLine, copyText, external, h, loadMeta, loadProspects, renderFooter, showError } from './ui.js';

const PAGE = 100;
const els = {
  form: document.getElementById('filters'),
  count: document.getElementById('count'),
  notices: document.getElementById('notices'),
  asof: document.getElementById('asof'),
  table: document.getElementById('prospect-rows'),
  more: document.getElementById('more'),
  download: document.getElementById('download'),
};

let meta;
let all = [];
let current = [];
let shown = 0;
let filters = { ...DEFAULT_FILTERS };

function option(value, label) {
  return h('option', { value }, label);
}

function buildFilterControls() {
  const select = (name, label, options) => h('label', {}, label,
    h('select', { name }, options.map(([v, l]) => option(v, l))));
  els.form.replaceChildren(
    select('city', 'City', [['all', 'Both cities'], ['LA', 'Los Angeles'], ['SF', 'San Francisco']]),
    select('segment', 'Segment', [['all', 'All segments'],
      ...['lapsed', 'chronic', 'other', 'did_not_report', 'insufficient_data'].map((s) => [s, SEGMENT_LABELS[s]])]),
    select('history', 'History (2023 to 2025)', [['all', 'Any history'], ['lapsed', 'Lapsed'], ['other', 'Other non-compliant'], ['chronic', 'Chronic']]),
    select('band', 'Size band', [['all', 'All sizes'], ...bandOptions(all)]),
    select('dataOnFile', 'LA: data on file', [['any', 'Any'], ['yes', 'Yes (LA only)'], ['no', 'No (LA only)']]),
    select('auditOverdue', 'SF: audit overdue', [['any', 'Any'], ['yes', 'Yes (SF only)'], ['no', 'No (SF only)']]),
    h('div', { class: 'checks' },
      h('label', {}, h('input', { type: 'checkbox', name: 'cityOwned' }), 'Show city-owned buildings')),
  );
  syncControls();
  els.form.addEventListener('change', () => {
    const data = new FormData(els.form);
    filters = {
      ...DEFAULT_FILTERS,
      ...Object.fromEntries([...data.entries()].filter(([k]) => k !== 'cityOwned')),
      cityOwned: data.get('cityOwned') === 'on',
    };
    const params = filtersToParams(filters).toString();
    window.history.replaceState(null, '', params ? `?${params}` : window.location.pathname);
    apply();
  });
}

function syncControls() {
  for (const [key, value] of Object.entries(filters)) {
    const el = els.form.elements.namedItem(key);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = Boolean(value);
    else el.value = value;
  }
}

function filedOrAudit(r) {
  if (r.city === 'LA') {
    if (!r.last_filed_by && !r.last_filed_year) return h('span', { class: 'muted' }, 'No COMPLIED year on file');
    const name = r.last_filed_by_note === 'withheld'
      ? h('span', { class: 'muted', title: WITHHELD_NOTE }, 'Name not shown')
      : (r.last_filed_by ?? 'No entity listed');
    return h('span', {}, name, h('span', { class: 'muted' }, ` (COMPLIED ${r.last_filed_year})`));
  }
  if (!r.audit_status) return h('span', { class: 'muted' }, 'No audit status listed');
  return h('span', {}, `Audit: '${r.audit_status}'`, r.audit_due ? h('span', { class: 'muted' }, ` · due ${r.audit_due}`) : null);
}

function outreachCell(r) {
  if (!r.outreach_line) {
    let why = '—';
    if (r.city_owned) why = 'City-owned: kept out of outreach';
    else if (r.city === 'LA') why = 'Held for founder sign-off';
    return h('span', { class: 'muted small' }, why);
  }
  const button = h('button', { type: 'button', class: 'secondary', onclick: () => copyText(r.outreach_line, button) }, 'Copy line');
  return h('div', { class: 'line-cell' }, h('p', { class: 'small', style: 'margin:0 0 6px' }, r.outreach_line), button);
}

// One wrapper per cell: on phones each cell is a two-column grid (label, value),
// so several loose children would spill into the label column.
function cell(label, ...children) {
  return h('td', { 'data-label': label }, h('div', {}, ...children));
}

function row(r) {
  const flags = [
    r.city === 'LA' && r.data_on_file ? 'data on file' : null,
    r.city === 'SF' && r.audit_overdue ? 'audit overdue' : null,
    r.city_owned ? 'city-owned' : null,
  ].filter(Boolean).join(' · ');
  return h('tr', {},
    h('td', { 'data-label': 'Priority', title: PRIORITY_LABELS[r.priority] ?? r.priority }, r.priority === 'excluded' ? 'Excluded' : r.priority),
    cell('Building',
      h('a', { href: buildingUrl(r.id) }, r.address),
      h('div', { class: 'muted small' },
        h('span', { class: 'city-chip', 'data-city': r.city }, r.city), ' ',
        r.city === 'LA' ? `ID ${r.id.slice(3)}` : `Parcel ${r.id.slice(3)}`,
        r.name ? ` · ${r.name}` : ''),
      flags ? h('div', { class: 'small' }, flags) : null,
      r.same_address_others > 0
        ? h('div', { class: 'muted small' },
          `shares address with ${formatInt(r.same_address_others)} other record${r.same_address_others === 1 ? '' : 's'}`)
        : null),
    cell('Size band', r.size_band),
    cell('Segment', SEGMENT_LABELS[r.segment],
      r.city === 'SF' ? h('div', { class: 'muted small' }, SEGMENT_LABELS[r.history]) : null),
    cell('City label',
      h('span', { class: `status-chip tone-${rawStatusTone(r.status_raw)}` }, r.status_raw),
      h('div', { class: 'small' }, external(r.source_url, `${r.year} record ↗`))),
    cell('Last filed by / audit', filedOrAudit(r)),
    // "wide": on phones the label sits above the line, which gets the full card width.
    h('td', { 'data-label': 'Outreach line', class: 'wide' }, h('div', {}, outreachCell(r))));
}

function renderMore() {
  const next = current.slice(shown, shown + PAGE);
  els.table.append(...next.map(row));
  shown += next.length;
  els.more.hidden = shown >= current.length;
  els.more.textContent = `Show ${formatInt(Math.min(PAGE, current.length - shown))} more`;
}

function apply() {
  current = filterProspects(all, filters);
  shown = 0;
  els.table.replaceChildren();
  renderMore();
  els.count.textContent = `${formatInt(current.length)} building${current.length === 1 ? '' : 's'}`;
  els.count.dataset.count = String(current.length);
  els.download.textContent = `Download CSV (${formatInt(current.length)} rows)`;
  els.download.disabled = current.length === 0;
}

function notices() {
  const list = [];
  if (!meta.flags.la_outreach_approved) {
    list.push(h('p', { class: 'notice' }, meta.flags.la_held_reason,
      ' LA rows export with an empty outreach_line until then.'));
  }
  if (meta.flags.la_live_status_url) {
    list.push(h('p', { class: 'notice' },
      'LADBS\'s live status page can be a few days ahead of its open data. Check each LA building there before sending a line: ',
      external(meta.flags.la_live_status_url, 'LADBS live status ↗')));
  }
  if (!meta.flags.sf_due_date_confirmed) {
    list.push(h('p', { class: 'notice' },
      'SF lines leave out the due-date sentence until a source confirms it.'));
  }
  els.notices.replaceChildren(...list);
}

function download() {
  const csv = toCsv(current, meta);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: csvFilename(meta) });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  document.body.dataset.lastCsvRows = String(current.length);
}

async function init() {
  try {
    meta = await loadMeta();
    renderFooter(meta);
    els.asof.replaceChildren(asOfLine(meta.cities.LA), h('br'), asOfLine(meta.cities.SF));
    all = await loadProspects();
  } catch (err) {
    showError(document.getElementById('main'), `Could not load the prospect list (${err.message}).`);
    renderFooter(meta);
    return;
  }
  filters = filtersFromParams(new URLSearchParams(window.location.search));
  // On a phone the filters start folded, so the list is on the first screen.
  if (window.matchMedia('(max-width: 640px)').matches) document.getElementById('filter-panel').open = false;
  notices();
  buildFilterControls();
  els.more.addEventListener('click', renderMore);
  els.download.addEventListener('click', download);
  apply();
  document.body.dataset.prospectsReady = 'true';
}

init();
