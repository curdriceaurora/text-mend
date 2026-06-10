// Publisher verification suite for the obfuscation/paywall hotfix.
//
// These are OFFLINE fixtures under fixtures/publishers/ that reproduce each publisher's real
// paywall/structure markers (schema.org isAccessibleForFree JSON-LD per Google's spec, plus
// platform classes: NYT gateway, WSJ snippet-promotion, AJC/Arc+Piano tp-modal, USA TODAY
// /Gannett gnt_pr + roadblock). Body text is SYNTHETIC — no article content is copied. We do
// not fetch live pages: that is non-deterministic, scraper-blocked, paywalled, and a copyright
// risk. Fixtures let us assert the hotfix behavior deterministically and in CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { detectPaywall, extractArticle } from '../src/extension/extract-article.js';
import { buildReaderArticle } from '../src/extension/reader.js';

function load(name) {
  const html = readFileSync(fileURLToPath(new URL(`../fixtures/publishers/${name}`, import.meta.url)), 'utf8');
  return new JSDOM(html).window.document;
}

const FREE = ['nytimes-free.html', 'wsj-free.html', 'ajc-free.html', 'usatoday-free.html'];
const PAYWALLED = ['nytimes-paywalled.html', 'wsj-paywalled.html', 'ajc-paywalled.html', 'usatoday-paywalled.html'];

for (const file of PAYWALLED) {
  test(`${file}: detected as paywalled`, () => {
    assert.equal(detectPaywall(load(file)).paywalled, true);
    assert.equal(buildReaderArticle(load(file)).paywalled, true, 'reader would show the paywall banner');
  });
}

for (const file of FREE) {
  test(`${file}: NOT flagged as paywalled`, () => {
    assert.equal(detectPaywall(load(file)).paywalled, false);
    assert.equal(buildReaderArticle(load(file)).paywalled, false);
  });

  test(`${file}: article extracted (title + body, no nav/footer)`, () => {
    const article = extractArticle(load(file));
    assert.ok(article.title.length > 0, 'has a title');
    const body = article.blocks.map((b) => b.text).join('\n');
    assert.ok(article.blocks.filter((b) => b.type === 'paragraph').length >= 3, 'multiple body paragraphs');
    assert.doesNotMatch(body, /All rights reserved|Subscribe<|Home.*World/, 'nav/footer excluded');
  });

  test(`${file}: a reversed paragraph is repaired in the reader`, () => {
    const article = buildReaderArticle(load(file));
    const repaired = article.blocks.find((b) => b.changed);
    assert.ok(repaired, 'a block was repaired');
    assert.equal(repaired.text, 'We will solve the problem.');
    assert.equal(article.obfuscated, false, 'clean article is not flagged obfuscated');
  });
}

test('usatoday-paywalled.html: scrambled decoy body is flagged obfuscated, not repaired', () => {
  const article = buildReaderArticle(load('usatoday-paywalled.html'));
  assert.equal(article.paywalled, true);
  assert.equal(article.obfuscated, true, 'reversed bag-of-words flagged, not presented as repaired');
  assert.equal(article.blocks.some((b) => b.changed), false, 'nothing shown as a clean repair');
});

// --- Graceful degradation: the WHOLE point — see a paywalled page and fail gracefully ---

for (const file of PAYWALLED) {
  test(`${file}: degrades gracefully — keeps visible text, fabricates nothing, never throws`, () => {
    let article;
    assert.doesNotThrow(() => {
      article = buildReaderArticle(load(file));
    });
    assert.equal(article.paywalled, true, 'flagged so the reader shows the banner');
    // Whatever snippet IS visible is preserved (we never blank the page)...
    const hasVisibleText = article.blocks.some((b) => b.text.trim().length > 0);
    assert.ok(hasVisibleText || article.blocks.length === 0, 'visible snippet kept when present');
    // ...and we never present a confident "repair" of paywalled/decoy content.
    const fabricatedRepair = article.blocks.some((b) => b.changed && !b.obfuscated);
    assert.equal(fabricatedRepair, false, 'no fabricated repair of paywalled content');
  });
}

test('a hard wall with no extractable body still returns a paywalled article (no crash, no empty lie)', () => {
  const dom = new JSDOM(
    `<!doctype html><html><body>
       <script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script>
       <div class="paywall"><p>Subscribe to read this article.</p></div>
     </body></html>`,
  );
  let article;
  assert.doesNotThrow(() => {
    article = buildReaderArticle(dom.window.document);
  });
  assert.equal(article.paywalled, true, 'reader knows it is paywalled even with no body to show');
  assert.equal(article.blocks.some((b) => b.changed), false, 'nothing fabricated');
});
