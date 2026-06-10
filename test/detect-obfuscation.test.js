// detectSegment must fail closed when the reversal yields bag-of-words: instead of a
// confident repair, return mode 'none' with obfuscated:true + reason (hotfix point 4).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSegment } from '../src/core/detect.js';
import { reverseGraphemes } from '../src/core/reverse.js';

test('a genuine reversed sentence is still repaired (not flagged)', () => {
  const r = detectSegment('.melborp eht evlos lliw eW');
  assert.equal(r.proposed, 'We will solve the problem.');
  assert.equal(r.mode, 'full');
  assert.ok(!r.obfuscated);
});

test('reversed bag-of-words is NOT presented as repaired — flagged obfuscated instead', () => {
  // Build a stopword salad and reverse it as a "source"; un-reversing yields real words,
  // no grammar — must not be shown as a clean repair.
  const salad = 'the and of to in for with the and of to in for with the and of';
  const reversedSource = reverseGraphemes(salad);
  const r = detectSegment(reversedSource);
  assert.equal(r.mode, 'none', 'not presented as a repair');
  assert.equal(r.obfuscated, true);
  assert.equal(r.reason, 'unnatural');
  assert.equal(r.proposed, reversedSource, 'original left unchanged');
});

test('a keyword-salad source is flagged, not repaired', () => {
  const salad = 'turtle lights county state season nesting beaches coast ocean glow horizon';
  const r = detectSegment(reverseGraphemes(salad));
  assert.equal(r.mode, 'none');
  assert.equal(r.obfuscated, true);
});
