// Integration tests for the DOM adapter, run against a real DOM via jsdom.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createDomNormalizer } from '../src/extension/dom-normalize.js';

function setup(html) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`);
  const normalizer = createDomNormalizer({ window: dom.window });
  return { dom, normalizer, doc: dom.window.document };
}

const REVERSED = '.melborp eht evlos lliw eW';
const NORMALIZED = 'We will solve the problem.';

test('normalizes a reversed single-text-node paragraph in place', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const res = normalizer.scan({ apply: true });
  assert.equal(res.applied, 1);
  assert.equal(doc.querySelector('p').textContent, NORMALIZED);
});

test('leaves normal text untouched', () => {
  const { normalizer, doc } = setup(`<p>Wildlife experts say the glow disrupts the turtles.</p>`);
  const res = normalizer.scan({ apply: true });
  assert.equal(res.applied, 0);
  assert.equal(doc.querySelector('p').textContent, 'Wildlife experts say the glow disrupts the turtles.');
});

test('never reverses code or script content', () => {
  const { normalizer, doc } = setup(`<pre><code>const eht = reverse("dna");</code></pre>`);
  const res = normalizer.scan({ apply: true });
  assert.equal(res.applied, 0);
  assert.equal(doc.querySelector('code').textContent, 'const eht = reverse("dna");');
});

test('routes a reversed paragraph spanning a link to preview, never mutating it', () => {
  const { normalizer, doc } = setup(`<p>.melborp eht evlos <a href="https://x.test">lliw</a> eW</p>`);
  const res = normalizer.scan({ apply: true });
  assert.equal(res.applied, 0);
  assert.equal(res.preview.length, 1);
  // DOM is unchanged — the link survives.
  assert.ok(doc.querySelector('p a'));
});

test('skips hidden and editable nodes', () => {
  const { normalizer } = setup(
    `<p style="display:none">${REVERSED}</p>` +
      `<div contenteditable="true">${REVERSED}</div>`,
  );
  const res = normalizer.scan({ apply: true });
  assert.equal(res.applied, 0);
});

test('undo restores every modified node', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p><p>eW lliw evlos eht melborp.</p>`);
  normalizer.scan({ apply: true });
  assert.equal(doc.querySelectorAll('p')[0].textContent, NORMALIZED);
  const undo = normalizer.undoAll();
  assert.equal(undo.restored, 2);
  assert.equal(doc.querySelectorAll('p')[0].textContent, REVERSED);
});

test('respects autoNormalize=false by routing applies to preview instead', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const res = normalizer.scan({ apply: true, settings: { autoNormalize: false } });
  assert.equal(res.applied, 0);
  assert.equal(res.preview.length, 1);
  assert.equal(doc.querySelector('p').textContent, REVERSED);
});

test('re-scanning already-normalized content applies nothing (observer/idempotency safety)', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  assert.equal(normalizer.scan({ apply: true }).applied, 1);
  assert.equal(normalizer.scan({ apply: true }).applied, 0); // normalized text detects as 'none'
  assert.equal(doc.querySelector('p').textContent, NORMALIZED);
});

test('normalizeSelection rewrites a single-text-node selection in place', () => {
  const { normalizer, doc } = setup(`<p>${REVERSED}</p>`);
  const textNode = doc.querySelector('p').firstChild;
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => textNode.nodeValue,
    getRangeAt: () => ({
      startContainer: textNode,
      endContainer: textNode,
      startOffset: 0,
      endOffset: textNode.nodeValue.length,
    }),
  };
  const res = normalizer.normalizeSelection(selection, {});
  assert.equal(res.applied, 1);
  assert.equal(textNode.nodeValue, NORMALIZED);
});

test('normalizeSelection on a cross-node selection returns copy text without mutating', () => {
  const { normalizer, doc } = setup(`<p>.melborp eht evlos <a href="https://x.test">lliw</a> eW</p>`);
  const p = doc.querySelector('p');
  const before = p.innerHTML;
  const selection = {
    isCollapsed: false,
    rangeCount: 1,
    toString: () => '.melborp eht evlos lliw eW',
    getRangeAt: () => ({ startContainer: p, endContainer: p.querySelector('a'), startOffset: 0, endOffset: 1 }),
  };
  const res = normalizer.normalizeSelection(selection, {});
  assert.equal(res.applied, 0);
  assert.equal(res.copied, NORMALIZED);
  assert.equal(p.innerHTML, before); // DOM untouched
});

test('extractCleanedText returns normalized, deduped article text', () => {
  const { normalizer } = setup(
    `<h1>Title</h1><p>${REVERSED}</p><figcaption>Cap</figcaption><figcaption>Cap</figcaption>`,
  );
  const text = normalizer.extractCleanedText({ dedupeOnCopy: true });
  assert.ok(text.includes(NORMALIZED));
  assert.equal(text.match(/Cap/g).length, 1); // duplicate caption removed
});
