import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dictionaryCoverage,
  confidence,
  classify,
  shouldProcess,
  detectSegment,
} from '../src/core/detect.js';

test('dictionaryCoverage is ~1 for normal English and ~0 for reversed text', () => {
  // Normal text is almost entirely in-dictionary; reversed text is mostly non-words.
  // (A short reversed token can coincidentally be a real word — e.g. "ew" — so we assert
  // a strong separation, not near-zero.)
  const normal = dictionaryCoverage('we will solve the problem');
  const reversed = dictionaryCoverage('ew lliw evlos eht melborp');
  assert.ok(normal > 0.9, `normal coverage ${normal}`);
  assert.ok(reversed < 0.35, `reversed coverage ${reversed}`);
  assert.ok(normal - reversed > 0.6, `separation ${normal - reversed}`);
});

test('confidence rewards a proposal that is more English than the original', () => {
  const c = confidence('.melborp eht evlos lliw eW', 'We will solve the problem.');
  assert.ok(c > 0.75, `expected high confidence, got ${c}`);
});

test('confidence stays low when the proposal is no better than the original', () => {
  const c = confidence('We will solve the problem.', 'We will solve the problem.');
  assert.ok(c < 0.3, `expected low confidence, got ${c}`);
});

test('classify maps confidence to tiers around the threshold', () => {
  assert.equal(classify(0.9, 0.75), 'high');
  assert.equal(classify(0.6, 0.75), 'medium');
  assert.equal(classify(0.2, 0.75), 'low');
});

test('shouldProcess skips URLs, emails, short strings, and mostly-numeric text', () => {
  assert.equal(shouldProcess('https://example.com/eht/dna'), false);
  assert.equal(shouldProcess('user@example.com'), false);
  assert.equal(shouldProcess('eht'), false); // below min length
  assert.equal(shouldProcess('12345 6789 2025-06-08'), false);
  assert.equal(shouldProcess('.melborp eht evlos lliw eW'), true);
});

test('detectSegment picks full-string reverse for a fully reversed sentence', () => {
  const r = detectSegment('.melborp eht evlos lliw eW');
  assert.equal(r.mode, 'full');
  assert.equal(r.proposed, 'We will solve the problem.');
  assert.equal(r.tier, 'high');
});

test('detectSegment picks word-level reverse when only words are reversed', () => {
  const r = detectSegment('eW lliw evlos eht melborp.');
  assert.equal(r.mode, 'words');
  assert.equal(r.proposed, 'We will solve the problem.');
  assert.equal(r.tier, 'high');
});

test('detectSegment leaves already-normal text alone', () => {
  const r = detectSegment('We will solve the problem.');
  assert.equal(r.mode, 'none');
  assert.equal(r.tier, 'low');
});
