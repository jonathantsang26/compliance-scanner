// Browser helpers shared by the pages: data loading, a tiny DOM builder,
// the footer and the as-of line.

import { shardOf } from './core.js';

// ---- DOM ---------------------------------------------------------------------
// All city data goes in as text (never as HTML), so a stray "<" in an
// address can't turn into markup.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'text') el.textContent = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

export function external(href, text) {
  return h('a', { href, target: '_blank', rel: 'noopener noreferrer' }, text);
}

// ---- data --------------------------------------------------------------------

let metaPromise;
export function loadMeta() {
  // Always revalidate meta.json; it carries the build stamp the other files use.
  metaPromise ??= fetch('data/meta.json', { cache: 'no-cache' }).then((r) => {
    if (!r.ok) throw new Error(`meta.json: HTTP ${r.status}`);
    return r.json();
  });
  return metaPromise;
}

async function loadVersioned(path) {
  const meta = await loadMeta();
  const r = await fetch(`data/${path}?v=${encodeURIComponent(meta.built_at)}`);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return r.json();
}

export const loadSearchDocs = () => loadVersioned('search.json');
export const loadProspects = () => loadVersioned('prospects.json');

export async function loadBuilding(id) {
  const meta = await loadMeta();
  const shard = await loadVersioned(`b/${shardOf(id, meta.shard_count)}.json`);
  return shard[id] ?? null;
}

// ---- shared page parts ---------------------------------------------------------

// "LADBS data as of October 11, 2026 · checked October 15, 2026, 12:43 PM PT".
// checked_label is when a nightly run last confirmed the data.
export function asOfLine(cityMeta) {
  return h('span', { class: 'asof' },
    `${cityMeta.agency} data as of ${cityMeta.as_of_label}`,
    h('span', { class: 'muted' }, ` · checked ${cityMeta.checked_label ?? cityMeta.fetched_label}`));
}

// The independence line is plain HTML in each page's <footer>, so it shows
// even when the data or the scripts fail. This only adds the sources line,
// and adds nothing when meta.json did not load.
export function renderFooter(meta) {
  const wrap = document.querySelector('#footer .wrap');
  const la = meta?.cities?.LA;
  const sf = meta?.cities?.SF;
  if (!wrap || !la || !sf) return;
  wrap.querySelector('.sources')?.remove();
  wrap.append(h('p', { class: 'muted sources' },
    'Sources: ', external(la.dataset_url, `${la.dataset_name} (City of Los Angeles open data, ${la.agency})`),
    ', as of ', la.as_of_label, '; ',
    external(sf.dataset_url, `${sf.dataset_name} (DataSF, ${sf.agency})`), ', as of ', sf.as_of_label, '.'));
}

export function showError(container, message) {
  container.replaceChildren(h('div', { class: 'error', role: 'alert' }, message));
}

// One visually hidden live region for every page, so screen readers hear
// "Copied" without the button losing its name.
let liveRegion;
export function announce(message) {
  if (!liveRegion) {
    liveRegion = h('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    document.body.append(liveRegion);
  }
  liveRegion.textContent = '';
  // A short wait, so the same message read twice in a row is still announced.
  setTimeout(() => { liveRegion.textContent = message; }, 50);
}

const resetTimers = new WeakMap();

export async function copyText(text, button) {
  button.dataset.label ??= button.textContent;
  const done = (label) => {
    clearTimeout(resetTimers.get(button));
    button.textContent = label;
    announce(label);
    resetTimers.set(button, setTimeout(() => { button.textContent = button.dataset.label; }, 1600));
  };
  try {
    await navigator.clipboard.writeText(text);
    done('Copied');
  } catch {
    // Fallback for browsers that block the clipboard API. Selecting the
    // hidden textarea moves focus, so it goes back to the button after.
    const area = h('textarea', { 'aria-hidden': 'true', readonly: true, tabindex: '-1', style: 'position:fixed;top:0;left:0;opacity:0' });
    area.value = text;
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    area.remove();
    button.focus({ preventScroll: true });
    done(ok ? 'Copied' : 'Copy failed');
  }
}
