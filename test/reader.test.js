// Reader-view article builder (requirements §5.21). Pure: document -> repaired article
// data with per-block repair metadata. DOM rendering (reader.js) is e2e-tested in Chrome.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildReaderArticle } from '../src/extension/reader.js';
import { artifactFor } from '../src/core/mojibake.js';

const doc = (html) => new JSDOM(`<!doctype html><body>${html}</body>`).window.document;
const moji = (s) => artifactFor(s);

test('repairs reversed body text and marks the block as changed', () => {
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>.melborp eht evlos lliw eW</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.equal(p.text, 'We will solve the problem.');
  assert.equal(p.changed, true);
  assert.deepEqual(p.modes, ['full']);
  assert.equal(p.original, '.melborp eht evlos lliw eW');
});

test('repairs a reversed paragraph that spanned a link (reader view, not preview)', () => {
  // The in-page flow can only PREVIEW this; the reader surface repairs the text.
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>.melborp eht evlos <a href="/x">lliw</a> eW</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.equal(p.text, 'We will solve the problem.');
  assert.equal(p.changed, true);
});

test('repairs mojibake in the reader surface', () => {
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>It${moji('’')}s a problem we will solve over time, they said.</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.ok(p.text.startsWith('It’s'));
  assert.ok(p.modes.includes('mojibake'));
});

test('does NOT canonicalize punctuation in the rendered article (export-only)', () => {
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>Wait -- the experts say this is really happening now... yes.</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.ok(p.text.includes('--'), 'double dash should remain in rendered reader text');
  assert.ok(p.text.includes('...'), 'triple dot should remain in rendered reader text');
});

test('leaves clean paragraphs unchanged', () => {
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>Wildlife experts say the glow disrupts the turtles each year.</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.equal(p.changed, false);
  assert.deepEqual(p.modes, []);
});

test('marks an obfuscated block instead of presenting it as repaired', () => {
  // A reversed stopword salad: un-reversing yields real words with no grammar.
  const salad = 'the and of to in for with the and of to in for with the and of';
  const reversedSalad = salad.split('').reverse().join('');
  const article = buildReaderArticle(
    doc(`<article><h1>T</h1><p>${reversedSalad}</p></article>`),
  );
  const p = article.blocks.find((b) => b.type === 'paragraph');
  assert.equal(p.changed, false, 'not shown as repaired');
  assert.equal(p.obfuscated, true);
  assert.equal(p.text, reversedSalad, 'original left as-is');
  assert.equal(article.obfuscated, true, 'article-level flag set');
});

test('surfaces the paywalled flag from extraction', () => {
  const article = buildReaderArticle(
    doc(`<article class="is-paywalled"><h1>Locked</h1><p>Subscribe to keep reading this story today.</p></article>`),
  );
  assert.equal(article.paywalled, true);
});

test('reports an estimated reading time', () => {
  const words = Array.from({ length: 400 }, () => 'word').join(' ');
  const article = buildReaderArticle(doc(`<article><h1>T</h1><p>${words}</p></article>`));
  assert.equal(article.readingTimeMin, 2); // 400 words / 200 wpm
});
