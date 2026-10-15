import {
  PRIORITY_LABELS, SEGMENT_LABELS, WITHHELD_NOTE, buildingUrl, formatInt, rawStatusTone, segmentRule,
} from './core.js';
import { asOfLine, copyText, external, h, loadBuilding, loadMeta, renderFooter, showError } from './ui.js';

const main = document.getElementById('main');

function fact(label, value) {
  if (value == null || value === '') return null;
  return h('div', { class: 'fact' }, h('dt', {}, label), h('dd', {}, value));
}

function statusChip(raw) {
  return h('span', { class: `status-chip tone-${rawStatusTone(raw)}` }, raw);
}

function yearWord(city) {
  return city === 'LA' ? 'Program year' : 'Benchmark year';
}

function entity(f) {
  if (f.filed_by_note === 'withheld') return h('span', { class: 'muted', title: WITHHELD_NOTE }, 'name not shown');
  return f.filed_by ?? h('span', { class: 'muted' }, 'none listed');
}

// Each cell holds one wrapper: on phones a cell is a two-column grid (label,
// value), so a second loose child would land in the label column.
function cell(label, ...children) {
  return h('td', { 'data-label': label }, h('div', {}, ...children));
}

function historyTable(b) {
  const la = b.city === 'LA';
  const head = h('tr', {},
    h('th', { scope: 'col' }, 'Year'),
    h('th', { scope: 'col' }, 'Status (city label)'),
    la ? h('th', { scope: 'col' }, 'Entity responsible for benchmark') : null,
    h('th', { scope: 'col' }, 'ENERGY STAR score'),
    h('th', { scope: 'col' }, 'Site EUI (kBtu/ft²)'),
    h('th', { scope: 'col' }, 'Source record'));
  const body = b.filings.map((f) => h('tr', {},
    cell('Year', String(f.year)),
    cell('Status', statusChip(f.status_raw),
      f.reason_for_exemption ? h('div', { class: 'muted small' }, `Reason: ${f.reason_for_exemption}`) : null),
    la ? cell('Entity responsible', entity(f)) : null,
    cell('ENERGY STAR', f.energy_star_score != null ? String(f.energy_star_score) : '—'),
    cell('Site EUI', f.site_eui != null ? String(f.site_eui) : '—'),
    cell('Source', external(f.source_url, `${b.city === 'LA' ? 'LADBS' : 'DataSF'} record ↗`))));
  const withheld = b.filings.some((f) => f.filed_by_note === 'withheld');
  return h('div', { class: 'table-wrap' },
    h('table', { class: 'history' },
      h('caption', {}, 'Every year on file, newest first. Labels are the city\'s own, word for word.',
        withheld ? ` "Name not shown": ${WITHHELD_NOTE}` : null),
      h('thead', {}, head), h('tbody', {}, body)));
}

function classification(b) {
  const items = [];
  const reportFiling = b.filings.find((f) => f.year === b.report_year);
  items.push(h('div', { class: 'status-block' },
    h('p', { class: 'status-year' }, `${yearWord(b.city)} ${b.report_year}`),
    reportFiling ? statusChip(reportFiling.status_raw)
      : h('span', { class: 'status-chip tone-neutral' }, `Not listed for ${b.report_year}`),
    reportFiling ? h('p', { class: 'muted small' }, external(reportFiling.source_url, 'Source record ↗')) : null));

  if (b.segment) {
    items.push(h('div', { class: 'segment-block' },
      h('p', { class: 'segment-name' }, SEGMENT_LABELS[b.segment] ?? b.segment,
        b.city === 'SF' && b.history ? h('span', { class: 'muted' }, ` · ${SEGMENT_LABELS[b.history]}`) : null),
      h('p', { class: 'muted small' }, segmentRule(b.segment, b.city, b.report_year)),
      b.city === 'SF' && b.history ? h('p', { class: 'muted small' }, `History: ${segmentRule(b.history, b.city, b.report_year)}`) : null,
      h('p', { class: `priority priority-${b.priority}` }, PRIORITY_LABELS[b.priority] ?? '')));
  }
  return h('div', { class: 'classification' }, items);
}

function flags(b) {
  const list = [];
  if (b.city_owned) {
    list.push(h('li', { class: 'flag flag-owned' },
      h('strong', {}, 'City-owned. '),
      b.city === 'LA'
        ? `LADBS lists its size band as "${b.size_band_raw}". City-owned buildings are kept out of the prospect list.`
        : `Our guess from SF's data (${b.city_owned_basis}); SF publishes no owner field. Kept out of the prospect list.`));
  }
  if (b.city === 'LA' && b.segment && b.data_on_file != null) {
    list.push(h('li', { class: 'flag' },
      h('strong', {}, b.data_on_file ? 'Benchmark data on file. ' : 'No benchmark data on file. '),
      b.data_on_file
        ? `LADBS publishes benchmark data for this building's ${b.report_year} row even though it is listed as NOT COMPLIED.`
        : `LADBS publishes no benchmark data for this building's ${b.report_year} row.`));
  }
  if (b.city === 'SF' && b.audit) {
    const a = b.audit;
    list.push(h('li', { class: `flag${b.audit_overdue ? ' flag-bad' : ''}` },
      h('strong', {}, 'Energy audit: '),
      a.status_raw ? `'${a.status_raw}'` : 'no status listed',
      a.due_date ? ` · due ${a.due_date}` : '',
      '. This is a separate obligation from the annual benchmark.'));
  }
  if (b.same_address) {
    // Other report-year records at the same address, same city.
    const s = b.same_address;
    const label = b.city === 'LA' ? `COMPLIED for ${b.report_year}` : `'${b.report_year} - Complied'`;
    list.push(h('li', { class: 'flag' },
      h('strong', {}, 'Same address. '),
      `${formatInt(s.others)} other record${s.others === 1 ? '' : 's'} at this address in the city's data (${formatInt(s.complied)} listed as ${label}). Check which one the owner means: `,
      s.ids.flatMap((id, i) => [i ? ', ' : null, h('a', { href: buildingUrl(id) }, `${b.city === 'LA' ? 'ID' : 'parcel'} ${id.slice(3)}`)]),
      '.'));
  }
  return list.length ? h('ul', { class: 'flags' }, list) : null;
}

function lastFiled(b) {
  if (b.city !== 'LA') return null;
  let value;
  if (b.last_filed_by_note === 'withheld') {
    value = h('span', { title: WITHHELD_NOTE }, `Name not shown (COMPLIED, program year ${b.last_filed_year})`);
  } else if (b.last_filed_by) {
    value = `${b.last_filed_by} (COMPLIED, program year ${b.last_filed_year})`;
  } else {
    value = b.last_filed_year ? `COMPLIED in program year ${b.last_filed_year}; no entity listed` : 'No COMPLIED year on file';
  }
  return fact('Last filed by', value);
}

function outreach(b, meta) {
  if (!b.outreach) return null;
  const o = b.outreach;
  // LADBS's open data runs a few days behind its live status page (DRIFT.md item 16).
  const liveCheck = b.city === 'LA' && meta.flags.la_live_status_url
    ? h('p', { class: 'muted small' }, 'Before sending, check this building on ',
      external(meta.flags.la_live_status_url, 'LADBS\'s live status page ↗'), '. It can be a few days ahead of the open data.')
    : null;
  if (!o.line) {
    return h('section', { class: 'outreach' },
      h('h2', {}, 'Outreach line'),
      h('p', { class: 'muted' }, o.held_reason),
      liveCheck);
  }
  const button = h('button', { type: 'button', class: 'copy', onclick: () => copyText(o.line, button) }, 'Copy line');
  return h('section', { class: 'outreach' },
    h('h2', {}, 'Outreach line'),
    h('blockquote', { class: 'outreach-line' }, o.line),
    h('div', { class: 'outreach-actions' }, button,
      h('span', { class: 'muted small' }, 'Source: ', external(o.source_url, 'record ↗'))),
    liveCheck);
}

function render(b, meta) {
  const city = meta.cities[b.city];
  document.title = `${b.address} · Compliance-Risk Scanner`;
  const idLabel = b.city === 'LA' ? 'LA building ID' : 'SF parcel';
  const sameName = b.alt_name && b.alt_name.trim().toLowerCase() === b.address.trim().toLowerCase();
  // replaceChildren would print a null as the text "null", so drop them first.
  main.replaceChildren(...[
    h('p', { class: 'crumbs' }, h('a', { href: './' }, '← Search')),
    h('header', { class: 'building-head' },
      h('p', { class: 'eyebrow' }, h('span', { class: 'city-chip', 'data-city': b.city }, b.city), ` ${city.city_name}`),
      h('h1', {}, b.address),
      b.alt_name && !sameName ? h('p', { class: 'alt-name' }, `Building name: ${b.alt_name}`) : null,
      h('p', { class: 'asof-line' }, asOfLine(city))),
    classification(b),
    flags(b),
    h('dl', { class: 'facts' },
      fact(idLabel, b.source_key),
      fact('Size band', b.size_band),
      fact('Floor area (sq ft)', b.floor_area_sqft != null ? formatInt(b.floor_area_sqft) : null),
      fact('Property type', b.property_type),
      fact('Year built', b.year_built != null ? String(b.year_built) : null),
      fact('ZIP', b.postal_code),
      lastFiled(b),
      b.city === 'LA' ? fact('AIN (last 3 digits only)', b.parcel) : null,
      b.pim_link ? fact('SF Planning map', external(b.pim_link, 'Property Information Map ↗')) : null),
    outreach(b, meta),
    h('section', {}, h('h2', {}, 'Status by year'), historyTable(b)),
    h('p', { class: 'muted small' },
      `Data: ${city.dataset_name} (`, external(city.dataset_url, city.dataset_url.replace('https://', '')),
      `). ${city.agency} last updated these rows on ${city.as_of_label}. This site downloaded them ${city.fetched_label}`,
      city.checked_label ? ` and last checked them ${city.checked_label}.` : '.'),
  ].filter(Boolean));
  document.body.dataset.buildingId = b.id;
}

async function init() {
  const id = new URLSearchParams(window.location.search).get('id');
  let meta;
  try {
    meta = await loadMeta();
  } catch (err) {
    showError(main, `Could not load the data (${err.message}).`);
    renderFooter(null);
    return;
  }
  renderFooter(meta);
  if (!id) {
    showError(main, 'No building given. Go back to the search.');
    return;
  }
  try {
    const b = await loadBuilding(id);
    if (!b) {
      showError(main, `No covered building has the ID "${id}".`);
      return;
    }
    render(b, meta);
  } catch (err) {
    showError(main, `Could not load this building (${err.message}).`);
  }
}

init();
