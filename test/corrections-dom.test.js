// Corrections applied through the DOM adapter (jsdom). dom-normalize stays chrome-free —
// records are passed in; corrections bypass autoNormalize but obey structural safety.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDomNormalizer } from '../src/extension/dom-normalize.js';
import { buildReaderArticle } from '../src/extension/reader.js';
import { makeOverride, makeSuppress, keyFor, normalizeForKey } from '../src/core/corrections.js';

const REVERSED = '.melborp eht evlos lliw eW';

function setup(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  return { normalizer: createDomNormalizer({ window: dom.window }), doc: dom.window.document, dom };
}
function records(...recs) {
  const out = {};
  for (const [text, rec] of recs) out[keyFor(text)] = rec;
  return out;
}

test('a stored override applies in place even when autoNormalize is off', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const recs = records([REVERSED, makeOverride(normalizeForKey(REVERSED), 'MY FIX', 1)]);
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: false }, records: recs });
  assert.equal(res.applied, 1);
  assert.equal(doc.querySelector('p').textContent, 'MY FIX');
  assert.deepEqual(res.replayedKeys, [keyFor(REVERSED)]);
});

test('a stored suppress leaves the segment unchanged and is not previewed', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const recs = records([REVERSED, makeSuppress(normalizeForKey(REVERSED), 1)]);
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: true }, records: recs });
  assert.equal(res.applied, 0);
  assert.equal(res.preview.length, 0);
  assert.equal(doc.querySelector('p').textContent, REVERSED, 'left as original');
  assert.deepEqual(res.replayedKeys, [keyFor(REVERSED)], 'suppress still bumped');
});

test('a link-spanning override is routed to preview, not mutated in place', () => {
  const { normalizer, doc } = setup(`<p>.melborp eht evlos <a href="/x">lliw</a> eW</p>`);
  const full = '.melborp eht evlos lliw eW';
  const recs = records([full, makeOverride(normalizeForKey(full), 'MY FIX', 1)]);
  const before = doc.querySelector('p').innerHTML;
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: true }, records: recs });
  assert.equal(res.applied, 0);
  assert.equal(res.preview.length, 1);
  assert.equal(doc.querySelector('p').innerHTML, before, 'DOM untouched (link preserved)');
  assert.deepEqual(res.replayedKeys, [keyFor(full)]);
});

test('empty records ⇒ scan behaves exactly as before', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: true }, records: {} });
  assert.equal(res.applied, 1);
  assert.equal(doc.querySelector('p').textContent, 'We will solve the problem.');
  assert.deepEqual(res.replayedKeys, []);
});

test('toggle-off (empty records) disables replay — stored override is ignored, detection runs', () => {
  // content.js passes {} when rememberCorrections is off; a would-be override must not fire.
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: true }, records: {} });
  assert.equal(doc.querySelector('p').textContent, 'We will solve the problem.', 'normal detection, not the override');
  assert.deepEqual(res.replayedKeys, []);
});

test('extractCleanedText (toolbar copy) honors a stored suppress and override', () => {
  const ov = 'eW lliw evlos eht melborp.';
  const sup = '.melborp eht evlos lliw eW';
  const { normalizer } = setup(`<p>${ov}</p><p>${sup}</p>`);
  const recs = records(
    [ov, makeOverride(normalizeForKey(ov), 'COPY OVERRIDE', 1)],
    [sup, makeSuppress(normalizeForKey(sup), 1)],
  );
  const text = normalizer.extractCleanedText({}, recs);
  assert.ok(text.includes('COPY OVERRIDE'), 'override honored in copy');
  assert.ok(text.includes(sup), 'suppressed segment left as original in copy');
  assert.ok(!text.includes('We will solve the problem.'), 'neither auto-repaired');
});

test('reader view replays an override and a suppress, exposing replayedKeys', () => {
  const dom = new JSDOM(
    `<!doctype html><body><article><h1>T</h1><p>${REVERSED}</p><p>eW lliw evlos eht melborp.</p></article></body>`,
  );
  const ov = '.melborp eht evlos lliw eW';
  const sup = 'eW lliw evlos eht melborp.';
  const recs = records(
    [ov, makeOverride(normalizeForKey(ov), 'READER FIX', 1)],
    [sup, makeSuppress(normalizeForKey(sup), 1)],
  );
  const article = buildReaderArticle(dom.window.document, { records: recs });
  const paras = article.blocks.filter((b) => b.type === 'paragraph');
  assert.equal(paras[0].text, 'READER FIX');
  assert.equal(paras[0].changed, true);
  assert.equal(paras[1].text, sup, 'suppress left at original');
  assert.equal(paras[1].changed, false);
  assert.equal(article.replayedKeys.length, 2);
});
