import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeParagraphs } from '../src/core/dedupe.js';

test('removes exact back-to-back duplicate paragraphs', () => {
  const input = ['Caption A', 'Caption A', 'Body text'];
  assert.deepEqual(dedupeParagraphs(input), ['Caption A', 'Body text']);
});

test('treats whitespace-normalized paragraphs as duplicates', () => {
  const input = ['Image caption:   High mast lights', 'Image caption: High mast lights'];
  assert.deepEqual(dedupeParagraphs(input), ['Image caption:   High mast lights']);
});

test('keeps distinct paragraphs and preserves order', () => {
  const input = ['One', 'Two', 'Three'];
  assert.deepEqual(dedupeParagraphs(input), ['One', 'Two', 'Three']);
});

test('removes a near-distance repeat within the window', () => {
  const input = ['Caption', 'Body', 'Caption'];
  assert.deepEqual(dedupeParagraphs(input, { window: 3 }), ['Caption', 'Body']);
});
