// Rendered-text extraction (innerText preference) + paywall detection (hotfix points 1, 2).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderedText, detectPaywall, extractArticle } from '../src/extension/extract-article.js';

const doc = (html) => new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;

test('renderedText prefers innerText when available, falls back to textContent', () => {
  // jsdom has no innerText; simulate both cases with a plain element-like object.
  assert.equal(renderedText({ innerText: 'visible only', textContent: 'visible only + hidden decoy' }), 'visible only');
  assert.equal(renderedText({ innerText: '   ', textContent: 'real text' }), 'real text', 'blank innerText falls back');
  assert.equal(renderedText({ textContent: 'no innerText here' }), 'no innerText here');
});

test('detectPaywall flags isAccessibleForFree:false in JSON-LD', () => {
  const d = doc(`<script type="application/ld+json">{"@type":"NewsArticle","isAccessibleForFree":false}</script><article><p>x</p></article>`);
  const r = detectPaywall(d);
  assert.equal(r.paywalled, true);
  assert.equal(r.reason, 'isAccessibleForFree');
});

test('detectPaywall flags paywall placeholder classes', () => {
  for (const cls of ['is-paywalled', 'story-paygate_placeholder', 'paywall', 'metered-content']) {
    const r = detectPaywall(doc(`<div class="${cls}">locked</div><article><p>x</p></article>`));
    assert.equal(r.paywalled, true, `class "${cls}" should flag`);
  }
});

test('detectPaywall flags blur classes', () => {
  const r = detectPaywall(doc(`<article><p class="gradient-blur">teaser…</p></article>`));
  assert.equal(r.paywalled, true);
  assert.equal(r.reason, 'blur');
});

test('detectPaywall does NOT flag a normal article', () => {
  const r = detectPaywall(doc(`<article><h1>Real</h1><p>An ordinary readable article paragraph.</p></article>`));
  assert.equal(r.paywalled, false);
});

test('extractArticle reports the paywalled flag', () => {
  const d = doc(`<article class="is-paywalled"><h1>Locked</h1><p>Subscribe to read the rest of this story today.</p></article>`);
  const article = extractArticle(d);
  assert.equal(article.paywalled, true);
});
