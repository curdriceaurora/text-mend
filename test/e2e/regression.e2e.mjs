// Chrome-based regression: loads the REAL packed extension into system Chrome and drives
// the V1.5 reader-view pipeline end-to-end (extraction → repair → render) through the
// actual packaged files. Proves the extension loads, the MV3 service worker runs, session
// storage works, and the reader page renders a correctly repaired article in a real browser.
//
// The in-page normalize/undo flow is intentionally NOT driven here: it is gated on a user
// gesture (toolbar click) granting activeTab, which headless puppeteer can't synthesize for
// an MV3 action popup. That path is covered by the jsdom integration suite (dom-normalize).
//
// Run: npm run test:e2e   (requires Google Chrome installed)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHROME =
  process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

let browser;
let worker;
let extId;
let stageDir;

// Chrome 138+ removed the --load-extension switch; it loads unpacked extensions over the
// debugging pipe (enableExtensions + installExtension). Chrome also rejects any directory
// containing "_"-prefixed names, so we stage a clean copy of only the extension assets
// (no node_modules / test files) rather than loading the project root.
function stageExtension() {
  const dir = mkdtempSync(join(tmpdir(), 'rtn-ext-'));
  cpSync(join(ROOT, 'manifest.json'), join(dir, 'manifest.json'));
  cpSync(join(ROOT, 'src'), join(dir, 'src'), { recursive: true });
  cpSync(join(ROOT, 'icons'), join(dir, 'icons'), { recursive: true });
  return dir;
}

before(async () => {
  stageDir = stageExtension();
  browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    enableExtensions: true,
    args: ['--no-sandbox', '--no-first-run'],
  });
  extId = await browser.installExtension(stageDir);
  // The service worker registers on install (onInstalled creates the context menus).
  const target = await browser.waitForTarget(
    (t) => t.type() === 'service_worker' && t.url().includes(extId),
    { timeout: 15000 },
  );
  worker = await target.worker();
});

after(async () => {
  await browser?.close();
  if (stageDir) rmSync(stageDir, { recursive: true, force: true });
});

test('extension loads and the MV3 service worker is alive', async () => {
  assert.ok(extId && extId.length > 10, 'extension id resolved');
  const pong = await worker.evaluate(() => typeof chrome?.runtime?.id === 'string');
  assert.equal(pong, true);
});

test('reader view renders a fully repaired article in real Chrome', async () => {
  const html = readFileSync(new URL('../../fixtures/v15-news.html', import.meta.url), 'utf8');
  const key = 'reader-e2e-1';

  // Seed the source HTML the way background.openReader would, from the SW context.
  await worker.evaluate(
    async (k, h) => chrome.storage.session.set({ [k]: { html: h, url: 'https://example.test/a' } }),
    key,
    html,
  );

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/extension/reader.html?key=${key}`, {
    waitUntil: 'load',
  });
  await page.waitForSelector('main h1', { timeout: 10000 });

  const out = await page.evaluate(() => ({
    title: document.querySelector('main h1')?.textContent ?? '',
    body: document.querySelector('main')?.textContent ?? '',
    marks: document.querySelectorAll('mark.repaired').length,
    readtime: document.getElementById('readtime')?.textContent ?? '',
  }));

  // Repairs applied in the owned surface:
  assert.match(out.body, /We will solve the problem\./, 'reversed paragraph repaired');
  assert.equal(
    (out.body.match(/We will solve the problem\./g) || []).length >= 2,
    true,
    'both the plain and link-spanning reversed paragraphs repaired',
  );
  assert.match(out.body, /It’s a problem we will solve/, 'mojibake repaired');
  assert.match(out.body, /county said no fix is imminent/, 'zero-width characters stripped');

  // Clean content preserved:
  assert.match(out.title, /Turtle light fight still burns bright/);
  assert.match(out.body, /Wildlife experts say the nighttime glow/);

  // Boilerplate / chrome excluded by container scoring:
  assert.doesNotMatch(out.body, /Home.*World.*Sports/, 'nav excluded');
  assert.doesNotMatch(out.body, /Related stories/, 'related-stories excluded');
  assert.doesNotMatch(out.body, /Advertisement/, 'ad marker excluded');
  assert.doesNotMatch(out.body, /All rights reserved/, 'footer excluded');
  assert.doesNotMatch(out.body, /reverse\("dna"\)/, 'code block excluded');

  // Photo credit stripped, reading time shown, repairs marked:
  assert.doesNotMatch(out.body, /AP Photo/, 'photo credit stripped');
  assert.match(out.readtime, /\d+ min read/);
  assert.ok(out.marks >= 3, `repair marks present (got ${out.marks})`);

  await page.close();
});

test('reader view does not canonicalize punctuation in the rendered surface', async () => {
  const key = 'reader-e2e-2';
  const html = `<article><h1>Punct</h1><p>The county said -- and we agree -- this is happening now... really, and the experts confirm it today.</p></article>`;
  await worker.evaluate(
    async (k, h) => chrome.storage.session.set({ [k]: { html: h, url: 'https://example.test/b' } }),
    key,
    html,
  );
  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/extension/reader.html?key=${key}`, { waitUntil: 'load' });
  await page.waitForSelector('main p', { timeout: 10000 });
  const body = await page.$eval('main', (el) => el.textContent);
  assert.match(body, /--/, 'double dash preserved in reader (canonicalization is export-only)');
  assert.match(body, /\.\.\./, 'triple dot preserved in reader');
  await page.close();
});
