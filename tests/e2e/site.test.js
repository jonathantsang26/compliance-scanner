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

// A phone up to 640px, a plain browser window above.
function viewportAt(width) {
  return width <= 640 ? { width, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { width, height: 900 };
}

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
    // Without JavaScript the page says so, instead of "Loading…" forever.
    const text = await noJs.page.evaluate(() => document.body.innerText);
    assert.match(text, /needs JavaScript/, `${path} without JavaScript`);
    assert.doesNotMatch(text, /Loading/, `${path} without JavaScript`);
    await noJs.page.close();
  }
});

test('every page leaves space under the header and above the footer', { skip: !CHROME && 'no Chrome' }, async () => {
  for (const [path, ready] of PAGES) {
    const page = await open(DESKTOP, path);
    await page.waitForSelector(ready);
    const m = await page.evaluate(() => {
      const main = document.querySelector('main');
      const style = getComputedStyle(main);
      const header = document.querySelector('.site-header').getBoundingClientRect();
      return { top: style.paddingTop, bottom: style.paddingBottom, gap: main.firstElementChild.getBoundingClientRect().top - header.bottom };
    });
    assert.equal(m.top, '24px', path);
    assert.equal(m.bottom, '48px', path);
    assert.ok(m.gap >= 24, `${path}: the content starts ${m.gap}px under the header`);
    await page.close();
  }
});

// The hint is the search box's only visible label, so it must fit whole on a small phone.
test('320px: the search box hint is not cut off', { skip: !CHROME && 'no Chrome' }, async () => {
  const page = await open(viewportAt(320), '');
  const m = await page.evaluate(() => {
    const q = document.getElementById('q');
    const style = getComputedStyle(q);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    return {
      need: ctx.measureText(q.placeholder).width,
      room: q.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
      label: document.querySelector('label[for="q"]').textContent,
    };
  });
  assert.ok(m.need <= m.room, `the hint needs ${Math.round(m.need)}px and the box has ${m.room}px`);
  // Screen readers still hear the full description.
  assert.match(m.label, /building name/);
  await page.close();
});

test('Enter pressed before the building list loads keeps its message', { skip: !CHROME && 'no Chrome' }, async () => {
  const page = await browser.newPage();
  await page.setViewport(PHONE);
  await page.setRequestInterception(true);
  page.on('request', (req) => (req.url().includes('data/search.json')
    ? setTimeout(() => req.continue(), 1500) : req.continue()));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.type('#q', '4028 West Blvd');
  await page.keyboard.press('Enter');
  await page.waitForSelector('body[data-search-ready="true"]', { timeout: 10000 });
  await page.waitForFunction(() => /No (single )?exact match for that address/.test(document.getElementById('search-status').textContent));
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.match(await page.$eval('#search-status', (s) => s.textContent), /No (single )?exact match for that address/);
  await page.close();
});

test('a city-owned LA building gets no "before sending" note', { skip: !CHROME && 'no Chrome' }, async () => {
  const owned = await open(PHONE, 'building.html?id=la%3A480754838193');
  await owned.waitForSelector('body[data-building-id]');
  const text = await owned.$eval('.outreach', (s) => s.textContent);
  assert.match(text, /City-owned building: kept out of outreach\./);
  assert.doesNotMatch(text, /Before sending/);
  // A private LA building whose line is held still gets the note.
  const held = await open(PHONE, 'building.html?id=la%3A476102819647');
  await held.waitForSelector('body[data-building-id]');
  assert.match(await held.$eval('.outreach', (s) => s.textContent), /Before sending, check this building/);
  await owned.close();
  await held.close();
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
      await page.waitForFunction(() => /No (single )?exact match for that address/.test(document.getElementById('search-status').textContent));
      assert.equal(new URL(page.url()).pathname, '/', query);
      assert.ok((await page.$$eval('#results li', (lis) => lis.length)) > 0, `${query} lists the closest matches`);
    }
    // An address in both cities' data lists both: SF's 644 BROADWAY and LA's 644 S BROADWAY.
    await retype(page, '644 Broadway');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Both LA and SF list a building at that address/.test(document.getElementById('search-status').textContent));
    assert.equal(new URL(page.url()).pathname, '/', '644 Broadway');
    const both = await page.$$eval('#results li', (lis) => lis.slice(0, 2).map((li) => li.textContent).join(' | '));
    assert.match(both, /644 BROADWAY/);
    assert.match(both, /644 S BROADWAY/);
    // The closest matches include the nearest buildings on the same street.
    await retype(page, '4028 West Blvd');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /4026 WEST BLVD/.test(document.getElementById('results').textContent));
    assert.doesNotMatch(await page.$eval('#results', (r) => r.textContent), /18019 VENTURA BLVD/);
    // No matches at all: say what to try, not that the building isn't covered.
    await retype(page, 'zzqx vvwk');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Nothing matched all of those words/.test(document.getElementById('search-status').textContent));
    assert.doesNotMatch(await page.$eval('#search-status', (s) => s.textContent), /not covered|No covered building/i);
    await page.close();
  });

  test(`${name}: Enter on an exact address opens that building`, { skip: !CHROME && 'no Chrome' }, async () => {
    for (const [query, id] of [
      ['5500 S Figueroa St', 'la:476102819647'], ['2739 Taylor St, San Francisco, CA 94133', 'sf:0012/001'],
      // A street named with a direction word, a house-number range, a street named for a street type.
      ['6400 West Blvd', 'la:460154815801'], ['336-344 Mason Street', 'sf:0315/019'], ['5344 Circle Dr', 'la:426287883657'],
    ]) {
      const page = await open(viewport, '');
      await page.waitForSelector('body[data-search-ready="true"]');
      await page.type('#q', query);
      await Promise.all([page.waitForNavigation(), page.keyboard.press('Enter')]);
      assert.equal(await buildingId(page), id, query);
      await page.close();
    }
  });
}

test('half-typed words keep the building in the list', { skip: !CHROME && 'no Chrome' }, async () => {
  const page = await open(PHONE, '');
  await page.waitForSelector('body[data-search-ready="true"]');
  for (const [query, address] of [
    ['5500 So', '5500 S FIGUEROA ST'], ['1801 Century Park Ea', '1801 CENTURY PARK EAST'], ['6400 Hollywood Bo', '6400 HOLLYWOOD BLVD'],
  ]) {
    await retype(page, query);
    await page.waitForFunction((a) => document.getElementById('results').textContent.includes(a), { timeout: 5000 }, address);
    assert.doesNotMatch(await page.$eval('#search-status', (s) => s.textContent), /Nothing matched/, query);
  }
  await page.close();
});

// The filters start folded on phones and the other checks run at 1280px, so
// open the panel and pick the longest size-band label at widths in between.
test('the filters stay inside their panel at every width', { skip: !CHROME && 'no Chrome' }, async () => {
  for (const width of [320, 414, 420, 500, 580, 700, 790, 900, 1024, 1280]) {
    const page = await open(viewportAt(width), 'prospects.html');
    await page.waitForSelector('body[data-prospects-ready="true"]');
    await page.$eval('#filter-panel', (d) => { d.open = true; });
    const longest = await page.$$eval('select[name="band"] option', (os) => os.reduce((a, o) => (o.text.length > a.text.length ? o : a)).value);
    await page.select('select[name="band"]', longest);
    const { boxes, panel } = await page.evaluate(() => {
      const form = document.getElementById('filters');
      const style = getComputedStyle(form);
      const f = form.getBoundingClientRect();
      return {
        panel: { left: f.left + parseFloat(style.paddingLeft), right: f.right - parseFloat(style.paddingRight) },
        boxes: [...form.querySelectorAll('select')].map((s) => {
          const r = s.getBoundingClientRect();
          const l = s.closest('label').getBoundingClientRect();
          return { name: s.name, left: r.left, right: r.right, top: r.top, bottom: r.bottom, colLeft: l.left, colRight: l.right };
        }),
      };
    });
    for (const b of boxes) {
      assert.ok(b.left >= b.colLeft - 1 && b.right <= b.colRight + 1, `${width}px: the ${b.name} select spills out of its column`);
      assert.ok(b.left >= panel.left - 1 && b.right <= panel.right + 1, `${width}px: the ${b.name} select passes the panel's edge`);
      for (const o of boxes) {
        const overlap = o !== b && b.left < o.right - 1 && o.left < b.right - 1 && b.top < o.bottom - 1 && o.top < b.bottom - 1;
        assert.ok(!overlap, `${width}px: the ${b.name} select covers the ${o.name} select`);
      }
    }
    // Neither the page nor the prospect table, which is cards up to 1040px.
    await noSidewaysScroll(page, `${width}px prospects`);
    await page.close();
  }
});

test('320px: the outreach line gets the full card width', { skip: !CHROME && 'no Chrome' }, async () => {
  const page = await open({ width: 320, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, 'prospects.html?city=SF');
  await page.waitForSelector('body[data-prospects-ready="true"]');
  const { line, card } = await page.$eval('#prospect-rows td.wide .line-cell', (el) => {
    const td = el.closest('td');
    const style = getComputedStyle(td);
    return { line: el.getBoundingClientRect().width, card: td.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) };
  });
  assert.ok(line >= card - 1, `the outreach line is ${line}px wide in a ${card}px card`);
  await page.close();
});

test('"Show more" goes away once every row is shown', { skip: !CHROME && 'no Chrome' }, async () => {
  const page = await open(DESKTOP, 'prospects.html?city=SF&segment=insufficient_data');
  await page.waitForSelector('body[data-prospects-ready="true"]');
  assert.ok((await shownCount(page)) < 100);
  assert.equal(await page.$eval('#more', (b) => getComputedStyle(b).display), 'none');
  await page.close();
});

// Every row of the prospect list, so a long name anywhere in the data counts.
async function showAllRows(page) {
  await page.evaluate(() => {
    const more = document.getElementById('more');
    while (!more.hidden) more.click();
  });
}

// Phones, the widths in between (the prospect table is cards up to 1040px, the
// history table up to 700px), and desktop. The prospect list with city-owned
// buildings shown is checked with every row on screen.
for (const width of [320, 360, 390, 641, 701, 768, 900, 1024, 1280]) {
  test(`${width}px: no page or table scrolls sideways`, { skip: !CHROME && 'no Chrome' }, async () => {
    for (const [path, ready] of [...PAGES, ['prospects.html?cityOwned=1', 'body[data-prospects-ready="true"]']]) {
      const page = await open(viewportAt(width), path);
      await page.waitForSelector(ready);
      if (path === '') await searchFor(page, '5500 S Figueroa');
      if (path.includes('cityOwned')) await showAllRows(page);
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
    assert.ok(csv.header.includes('last_filed_by_note'), 'the CSV marks withheld names');
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

// A size band that only city-owned buildings have (LA lists private buildings from 20,000 sqft).
const ownedOnlyBand = [...new Set(prospects.map((r) => r.size_band))]
  .find((band) => prospects.filter((r) => r.size_band === band).every((r) => r.city_owned));

test('a size band with only city-owned buildings says why the list is empty', {
  skip: (!CHROME && 'no Chrome') || (!ownedOnlyBand && 'no city-owned-only size band in the data'),
}, async () => {
  const page = await open(DESKTOP, `prospects.html?band=${encodeURIComponent(ownedOnlyBand)}`);
  await page.waitForSelector('body[data-prospects-ready="true"]');
  const owned = filterProspects(prospects, { ...DEFAULT_FILTERS, band: ownedOnlyBand, cityOwned: true }).length;
  assert.equal(await shownCount(page), 0);
  const note = await page.$eval('#owned-note', (p) => p.textContent);
  assert.match(note, new RegExp(`^${owned.toLocaleString('en-US')} city-owned buildings? match`));
  assert.match(note, /tick "Show city-owned buildings"/);
  // A disabled button looks disabled.
  const button = () => page.$eval('#download', (b) => ({ disabled: b.disabled, opacity: getComputedStyle(b).opacity, cursor: getComputedStyle(b).cursor }));
  const off = await button();
  assert.ok(off.disabled && Number(off.opacity) < 1 && off.cursor === 'not-allowed', JSON.stringify(off));
  // Ticking the box lists them; the note goes and the button comes back.
  await page.click('input[name="cityOwned"]');
  assert.equal(await shownCount(page), owned);
  assert.equal(await page.$eval('#owned-note', (p) => p.textContent), '');
  assert.deepEqual(await button(), { disabled: false, opacity: '1', cursor: 'pointer' });
  await page.close();
});

// The longest size-band label, note included, fits in the closed select (Chrome's arrow takes 20px).
for (const width of [320, 390, 900, 1280]) {
  test(`${width}px: the chosen size band is not cut off in the closed select`, {
    skip: !CHROME && 'no Chrome',
  }, async () => {
    const page = await open(viewportAt(width), 'prospects.html');
    await page.waitForSelector('body[data-prospects-ready="true"]');
    await page.$eval('#filter-panel', (d) => { d.open = true; });
    const longest = await page.$$eval('select[name="band"] option', (os) => os.reduce((a, o) => (o.text.length > a.text.length ? o : a)).value);
    await page.select('select[name="band"]', longest);
    const m = await page.$eval('select[name="band"]', (s) => {
      const style = getComputedStyle(s);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      return {
        text: s.selectedOptions[0].text,
        need: ctx.measureText(s.selectedOptions[0].text).width,
        room: s.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - 20,
      };
    });
    assert.ok(m.need <= m.room, `"${m.text}" needs ${Math.round(m.need)}px; the select has ${Math.round(m.room)}px`);
    await page.close();
  });
}

// After a roll-forward the page names the new years with no edit: here meta.json
// is served with other report years.
test('the prospect page takes its years from meta.json', { skip: !CHROME && 'no Chrome' }, async () => {
  const meta = JSON.parse(readFileSync(join(SITE, 'data/meta.json'), 'utf8'));
  for (const [la, sf, lede, history] of [
    [2026, 2026, /out of compliance for 2026\./, 'History (2024 to 2026)'],
    [2026, 2025, /out of compliance for 2026 \(LA\) and 2025 \(SF\)\./, 'History (2023 to 2026)'],
  ]) {
    const body = JSON.stringify({ ...meta, cities: { LA: { ...meta.cities.LA, report_year: la }, SF: { ...meta.cities.SF, report_year: sf } } });
    const page = await browser.newPage();
    await page.setViewport(DESKTOP);
    await page.setRequestInterception(true);
    page.on('request', (req) => (req.url().includes('data/meta.json')
      ? req.respond({ status: 200, contentType: 'application/json', body }) : req.continue()));
    await page.goto(`${base}prospects.html`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('body[data-prospects-ready="true"]');
    const text = await page.$eval('#lede', (p) => p.textContent);
    assert.match(text, lede);
    assert.match(text, /COMPLIED for 2025 but NOT COMPLIED for 2026 \(lapsed\)/);
    assert.equal(await page.$eval('select[name="history"]', (s) => s.parentElement.firstChild.textContent), history);
    await page.close();
  }
  // Without JavaScript the page names no year, so it can't go stale.
  const noJs = await openQuiet(DESKTOP, 'prospects.html', { javascript: false });
  assert.doesNotMatch(await noJs.page.$eval('#lede', (p) => p.textContent), /\b20\d\d\b/);
  await noJs.page.close();
});

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
