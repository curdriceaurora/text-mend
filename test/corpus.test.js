// Guards that the bundled corpus loaded intact — if corpus-data.js were ever truncated or
// regenerated empty, coverage-dependent tests would silently weaken instead of failing loud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWord, COMMON_WORD_COUNT } from '../src/core/corpus.js';
import { WORDS } from '../src/core/corpus-data.js';

test('frequency list has the expected size', () => {
  assert.equal(WORDS.length, 20000);
});

test('total dictionary (frequency + curated) is the expected size', () => {
  // 20000 frequency words + curated supplement ('a','i','readable','normalize',
  // 'normalized','mojibake'); 'reversed' was already in the list so it does not add.
  assert.equal(COMMON_WORD_COUNT, 20006);
});

test('recognizes common words including the re-added single letters', () => {
  for (const w of ['the', 'and', 'problem', 'extension', 'cooperate', 'a', 'i']) {
    assert.ok(isWord(w), `expected "${w}" to be a word`);
  }
});

test('rejects non-words and denylisted entries', () => {
  for (const w of ['zzzz', 'qwxz', 'melborp', 'fuck', 'nigger', 'der', 'que']) {
    assert.equal(isWord(w), false, `expected "${w}" to be rejected`);
  }
});

test('isWord is case-insensitive', () => {
  assert.equal(isWord('THE'), true);
  assert.equal(isWord('Problem'), true);
});
