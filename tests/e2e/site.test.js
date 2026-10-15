// End-to-end checks in a real Chrome, at phone and desktop widths.
//   npm run e2e        (needs Node 22+, Chrome, and a built site/data)
// Set CHROME_PATH if Chrome is not in the usual place.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

import { DEFAULT_FILTERS, filterProspects } from '../../site/js/core.js';
import { parseCsv } from '../js/csv.js';

const SITE = fileURLToPath(new URL('../../site/', import.meta.url));
const CHROME = process.env.CHROME_PATH || [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].find((p) => existsSync(p));

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.txt': 'text/plain', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

let server, browser, base;
const consoleErrors = [];

before(async () => {
  server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(SITE, path));
    if (!file.startsWith(SITE)) { res.writeHead(403).end(); return; }
    if (path.endsWith('/')) file = join(file, 'index.html');
    if (!existsSync(file)) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] });
});

after(async () => {
  await browser?.close();
  server?.close();
});

const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESKTOP = { width: 1280, height: 900 };

async function open(viewport, path) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${path}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${path}: ${e.message}`));
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  return page;
}

// Neither the page nor any table box may scroll sideways. A table box has
// overflow-x: auto, so a too-wide table hides inside it unless checked too.
async function noSidewaysScroll(page, where = page.url()) {
  const { doc, wraps } = await page.evaluate(() => ({
    doc: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    wraps: [...document.querySelectorAll('.table-wrap')].map((w) => [w.scrollWidth, w.clientWidth]),
  }));
  assert.ok(doc[0] <= doc[1] + 1, `${where}: page is ${doc[0]}px wide in a ${doc[1]}px window`);
  wraps.forEach(([scroll, client], i) => {
    assert.ok(scroll <= client + 1, `${where}: table ${i + 1} is ${scroll}px wide in a ${client}px box`);
  });
}

// For pages that are meant to fail (a blocked data file, no JavaScript): their
// "Failed to load resource" messages stay out of consoleErrors.
async function openQuiet(viewport, path, { block = null, javascript = true } = {}) {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  await page.setJavaScriptEnabled(javascript);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  if (block) {
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().includes(block) ? req.abort() : req.continue()));
  }
  await page.goto(base + path, { waitUntil: 'networkidle0' });
  return { page, errors };
}

async function searchFor(page, text) {
  await page.waitForSelector('body[data-search-ready="true"]');
  await page.click('#q', { clickCount: 3 });
  await page.type('#q', text);
  await page.waitForFunction(() => document.querySelectorAll('#results li').length > 0, { timeout: 5000 });
  return page.$$eval('#results li', (lis) => lis.map((li) => li.textContent));
}

// Clears the search box and types a new query (a triple-click does not
// reliably select all the text in a search input).
async function retype(page, text) {
  await page.$eval('#q', (input) => { input.value = ''; });
  await page.type('#q', text);
}

async function buildingId(page) {
  await page.waitForSelector('body[data-building-id]');
  return page.$eval('body', (b) => b.dataset.buildingId);
}

for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${name}: "5500 S Figueroa" opens LA 476102819647 with every year`, { skip: !CHROME && 'no Chrome' }, async () => {
    const page = await open(viewport, '');
    await noSidewaysScroll(page);
    const results = await searchFor(page, '5500 S Figueroa');
    assert.match(results[0], /5500 S FIGUEROA ST/);
    await Promise.all([page.waitForNavigation(), page.click('#results li a')]);
    assert.equal(await buildingId(page), 'la:476102819647');
    const years = await page.$$eval('table.history tbody tr td:first-child', (tds) => tds.map((td) => td.textContent));
    // Newest first. A later program year may appear above 2025 once LADBS publishes it.
    assert.deepEqual(years.slice(-8), ['2025', '2024', '2023', '2022', '2021', '2020', '2019', '2018']);
    const links = await page.$$eval('table.history a', (as) => as.map((a) => a.href));
    assert.equal(links.length, years.length);
    assert.ok(links.every((href) => href.startsWith('https://data.lacity.org/resource/9yda-i4ya.json?building_id=476102819647&program_year=')));
    const text = await page.$eval('main', (m) => m.textContent);
    assert.match(text, /data as of October|data as of [A-Z][a-z]+ \d+, \d{4}/);
    assert.doesNotMatch(text, /not filed|didn't file|did not file/i);
    await noSidewaysScroll(page);
    await page.close();
  });

  test(`${name}: "211 Jefferson" finds SF 0012/001 at 2739 TAYLOR ST`, { skip: !CHROME && 'no Chrome' }, async () => {
    const page = await open(viewport, '');
    const results = await searchFor(page, '211 Jefferson');
    const i = results.findIndex((t) => t.includes('2739 TAYLOR ST'));
    assert.ok(i >= 0, results.join(' | '));
    assert.match(results[i], /211 Jefferson St/);
    assert.match(results[i], /0012\/001/);
    await Promise.all([page.waitForNavigation(), page.click(`#results li:nth-child(${i + 1}) a`)]);
    assert.equal(await buildingId(page), 'sf:0012/001');
    await noSidewaysScroll(page);
    await page.close();
  });

  test(`${name}: a building ID or parcel number goes straight to its page`, { skip: !CHROME && 'no Chrome' }, async () => {
    for (const [query, id] of [['476102819647', 'la:476102819647'], ['0012/001', 'sf:0012/001']]) {
      const page = await open(viewport, '');
      await page.waitForSelector('body[data-search-ready="true"]');
      await page.type('#q', query);
      await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
      assert.equal(await buildingId(page), id, query);
      await page.close();
    }
  });
}

const INDEPENDENT = 'Independent project. Not affiliated with, endorsed by, or operated by LADBS or SF Environment.';
const PAGES = [
  ['', 'body[data-search-ready="true"]'],
  ['building.html?id=la%3A476102819647', 'body[data-building-id]'],
  ['building.html?id=sf%3A0012%2F001', 'body[data-building-id]'],
  ['prospects.html', 'body[data-prospects-ready="true"]'],
];

async function footerText(page) {
  return page.$eval('#footer', (f) => f.textContent.replace(/\s+/g, ' '));
}

test('footer says the site is independent of both agencies', { skip: !CHROME && 'no Chrome' }, async () => {
  for (const [path, ready] of PAGES) {
    const page = await open(PHONE, path);
    await page.waitForSelector(ready);
    const footer = await footerText(page);
    assert.ok(footer.includes(INDEPENDENT), path);
    assert.match(footer, /Sources: .*as of .*as of/, `${path} lists both sources once the data loads`);
    await page.close();
  }
});

test('the independence line shows even when meta.json fails or JavaScript is off', { skip: !CHROME && 'no Chrome' }, async () => {
  for (const [path] of PAGES) {
    const failed = await openQuiet(PHONE, path, { block: 'data/meta.json' });
    await failed.page.waitForSelector('.error');
    assert.ok((await footerText(failed.page)).includes(INDEPENDENT), `${path} with meta.json blocked`);
    assert.deepEqual(failed.errors, [], `${path} with meta.json blocked`);
    await failed.page.close();

    const noJs = await openQuiet(PHONE, path, { javascript: false });
    assert.ok((await footerText(noJs.page)).includes(INDEPENDENT), `${path} without JavaScript`);
    await noJs.page.close();
  }
});

test('search shows an error, not "Loading", when search.json fails', { skip: !CHROME && 'no Chrome' }, async () => {
  const { page, errors } = await openQuiet(PHONE, '', { block: 'data/search.json' });
  await page.waitForSelector('#search-status .error');
  await page.type('#q', '5500 S Figueroa');
  await page.waitForFunction(() => /Search is unavailable/.test(document.getElementById('search-status').textContent)
    && !/Loading/.test(document.getElementById('search-status').textContent), { timeout: 5000 });
  assert.ok((await footerText(page)).includes(INDEPENDENT));
  assert.deepEqual(errors, []);
  await page.close();
});

for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${name}: Enter on an address that is not covered stays on the list`, { skip: !CHROME && 'no Chrome' }, async () => {
    const page = await open(viewport, '');
    await page.waitForSelector('body[data-search-ready="true"]');
    for (const query of ['4028 West Blvd', '1411 S Highland Ave', '141 N Highland Ave', '55 Market St']) {
      await retype(page, query);
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => /No exact match for that address/.test(document.getElementById('search-status').textContent));
      assert.equal(new URL(page.url()).pathname, '/', query);
      assert.ok((await page.$$eval('#results li', (lis) => lis.length)) > 0, `${query} lists the closest matches`);
    }
    // No matches at all: say what to try, not that the building isn't covered.
    await retype(page, 'zzqx vvwk');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Nothing matched all of those words/.test(document.getElementById('search-status').textContent));
    assert.doesNotMatch(await page.$eval('#search-status', (s) => s.textContent), /not covered|No covered building/i);
    await page.close();
  });

  test(`${name}: Enter on an exact address opens that building`, { skip: !CHROME && 'no Chrome' }, async () => {
    for (const [query, id] of [['5500 S Figueroa St', 'la:476102819647'], ['2739 Taylor St, San Francisco, CA 94133', 'sf:0012/001']]) {
      const page = await open(viewport, '');
      await page.waitForSelector('body[data-search-ready="true"]');
      await page.type('#q', query);
      await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
      assert.equal(await buildingId(page), id, query);
      await page.close();
    }
  });
}

for (const width of [320, 360, 390]) {
  test(`${width}px: no page or table scrolls sideways`, { skip: !CHROME && 'no Chrome' }, async () => {
    for (const [path, ready] of PAGES) {
      const page = await open({ width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, path);
      await page.waitForSelector(ready);
      if (path === '') await searchFor(page, '5500 S Figueroa');
      await noSidewaysScroll(page, `${width}px ${path || 'index'}`);
      await page.close();
    }
  });
}

const prospects = existsSync(join(SITE, 'data/prospects.json'))
  ? JSON.parse(readFileSync(join(SITE, 'data/prospects.json'), 'utf8')) : [];

async function downloadCsv(page) {
  const dir = mkdtempSync(join(tmpdir(), 'scanner-csv-'));
  const session = await browser.target().createCDPSession();
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir });
  await page.click('#download');
  for (let i = 0; i < 100; i++) {
    const done = readdirSync(dir).find((f) => f.endsWith('.csv'));
    if (done) return parseCsv(readFileSync(join(dir, done), 'utf8'));
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('CSV download did not appear');
}

async function shownCount(page) {
  return Number(await page.$eval('#count', (el) => el.dataset.count));
}

for (const [name, viewport] of [['phone', PHONE], ['desktop', DESKTOP]]) {
  test(`${name}: prospect list hides city-owned, and the CSV matches the on-screen count`, { skip: !CHROME && 'no Chrome' }, async () => {
    const page = await open(viewport, 'prospects.html');
    await page.waitForSelector('body[data-prospects-ready="true"]');
    await noSidewaysScroll(page);

    const expected = filterProspects(prospects, DEFAULT_FILTERS);
    assert.equal(await shownCount(page), expected.length);
    assert.equal(expected.filter((r) => r.city_owned).length, 0);
    const firstIds = await page.$$eval('#prospect-rows tr td:nth-child(2) a', (as) => as.map((a) => new URL(a.href).searchParams.get('id')));
    assert.deepEqual(firstIds, expected.slice(0, 100).map((r) => r.id));

    let csv = await downloadCsv(page);
    assert.equal(csv.records.length, await shownCount(page));
    for (const r of csv.records) {
      assert.ok(r.as_of, `${r.id} has no as_of`);
      assert.ok(r.source_url.startsWith('https://'), `${r.id} has no source_url`);
    }

    await page.select('select[name="city"]', 'SF');
    await page.select('select[name="auditOverdue"]', 'yes');
    const sfOverdue = filterProspects(prospects, { ...DEFAULT_FILTERS, city: 'SF', auditOverdue: 'yes' });
    assert.equal(await shownCount(page), sfOverdue.length);
    assert.match(page.url(), /city=SF/);
    csv = await downloadCsv(page);
    assert.equal(csv.records.length, sfOverdue.length);
    assert.ok(csv.records.every((r) => r.city === 'SF' && r.audit_status === 'Did Not Comply'));
    await noSidewaysScroll(page);
    await page.close();
  });
}

test('no page shows "not filed" wording, penalty language or dollar amounts', { skip: !CHROME && 'no Chrome' }, async () => {
  const forbidden = /not filed|didn'?t file|did not file|penalt|\bfines?\b|\$\s?\d/i;
  // The footer line is plain HTML now, so wait for each page's own ready mark
  // before reading the text the scripts put in.
  for (const [path, ready] of [...PAGES, ['building.html?id=la%3A442871910523', 'body[data-building-id]']]) {
    const page = await open(DESKTOP, path);
    await page.waitForSelector(ready);
    const text = await page.evaluate(() => document.body.innerText);
    assert.doesNotMatch(text, forbidden, path);
    await page.close();
  }
});

test('no console errors on any page', { skip: !CHROME && 'no Chrome' }, () => {
  assert.deepEqual(consoleErrors, []);
});
