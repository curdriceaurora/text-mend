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
import { keyFor, normalizeForKey, makeOverride, makeSuppress } from '../../src/core/corrections.js';

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

test('correction memory replays an override + suppress from real storage.local and bumps lastUsedAt', async () => {
  const overrideOrig = 'eW lliw evlos eht melborp.'; // detector would repair → "We will solve the problem."
  const suppressOrig = '.melborp eht evlos lliw eW'; // detector would repair too
  const k1 = keyFor(overrideOrig);
  const k2 = keyFor(suppressOrig);

  // Seed real storage.local the way the capture UI would (prefixed keys, old lastUsedAt=1).
  await worker.evaluate(
    async (rows) => chrome.storage.local.set(rows),
    {
      [`corr:v1:${k1}`]: makeOverride(normalizeForKey(overrideOrig), 'OVERRIDDEN TEXT HERE', 1),
      [`corr:v1:${k2}`]: makeSuppress(normalizeForKey(suppressOrig), 1),
    },
  );

  const key = 'reader-e2e-3';
  const html = `<article><h1>Memory</h1><p>${overrideOrig}</p><p>${suppressOrig}</p></article>`;
  await worker.evaluate(
    async (kk, h) => chrome.storage.session.set({ [kk]: { html: h, url: 'https://example.test/c' } }),
    key,
    html,
  );

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/extension/reader.html?key=${key}`, { waitUntil: 'load' });
  await page.waitForSelector('main p', { timeout: 10000 });
  const body = await page.$eval('main', (el) => el.textContent);

  assert.match(body, /OVERRIDDEN TEXT HERE/, 'override replay rendered');
  assert.ok(body.includes(suppressOrig), 'suppressed paragraph left at original (reversed)');
  assert.doesNotMatch(body, /We will solve the problem\./, 'neither paragraph auto-repaired');

  // lastUsedAt bumped after replay (best-effort write; poll briefly).
  let bumped = false;
  for (let i = 0; i < 20 && !bumped; i++) {
    const rec = await worker.evaluate(async (kk) => (await chrome.storage.local.get(kk))[kk], `corr:v1:${k1}`);
    if (rec && rec.lastUsedAt > 1) bumped = true;
    else await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(bumped, 'lastUsedAt advanced after replay');
  await page.close();
});

test('reader fails closed on a paywalled + obfuscated page (banner shown, salad not repaired)', async () => {
  // Stopword salad reversed as a "source" — un-reversing yields real words, no grammar.
  const salad = 'the and of to in for with the and of to in for with the and of';
  const reversedSalad = salad.split('').reverse().join('');
  const key = 'reader-e2e-5';
  const html =
    `<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>` +
    `<article class="is-paywalled"><h1>Locked Story</h1><p>${reversedSalad}</p></article>`;
  await worker.evaluate(
    async (kk, h) => chrome.storage.session.set({ [kk]: { html: h, url: 'https://example.test/e' } }),
    key,
    html,
  );

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/extension/reader.html?key=${key}`, { waitUntil: 'load' });
  await page.waitForSelector('main', { timeout: 10000 });

  const out = await page.evaluate(() => ({
    notice: document.querySelector('.notice')?.textContent ?? '',
    obfuscatedMarks: document.querySelectorAll('.obfuscated').length,
    repairedMarks: document.querySelectorAll('mark.repaired').length,
  }));
  assert.match(out.notice, /paywall|obfuscat/i, 'a paywall/obfuscation notice is shown');
  assert.equal(out.repairedMarks, 0, 'salad is NOT presented as a repair');
  await page.close();
});

test('reader capture: "Don\'t repair this" reverts the text and persists a suppress', async () => {
  // Clear any prior corrections so this segment starts un-suppressed.
  await worker.evaluate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith('corr:v1:'));
    if (keys.length) await chrome.storage.local.remove(keys);
  });

  const original = '.melborp eht evlos lliw eW';
  const key = 'reader-e2e-4';
  await worker.evaluate(
    async (kk, h) => chrome.storage.session.set({ [kk]: { html: h, url: 'https://example.test/d' } }),
    key,
    `<article><h1>Capture</h1><p>${original}</p></article>`,
  );

  const page = await browser.newPage();
  await page.goto(`chrome-extension://${extId}/src/extension/reader.html?key=${key}`, { waitUntil: 'load' });
  await page.waitForSelector('mark.repaired', { timeout: 10000 });

  // It was auto-repaired on load; open the editor and choose "Don't repair this".
  assert.match(await page.$eval('main', (el) => el.textContent), /We will solve the problem\./);
  await page.click('mark.repaired');
  await page.waitForSelector('main button');
  const buttons = await page.$$('main button');
  for (const b of buttons) {
    const label = await b.evaluate((el) => el.textContent);
    if (/Don't repair/.test(label)) {
      await b.click();
      break;
    }
  }

  // The text reverts to the original now, and a suppress record is persisted.
  await page.waitForFunction((orig) => document.querySelector('main').textContent.includes(orig), {}, original);
  const body = await page.$eval('main', (el) => el.textContent);
  assert.ok(body.includes(original), 'reverted to original after suppress');
  assert.doesNotMatch(body, /We will solve the problem\./, 'no longer repaired');

  let stored = false;
  for (let i = 0; i < 20 && !stored; i++) {
    const n = await worker.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.keys(all).filter((k) => k.startsWith('corr:v1:')).length;
    });
    if (n >= 1) stored = true;
    else await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(stored, 'a suppress record was persisted to storage.local');
  await page.close();
});
