import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  reverseGraphemes,
  splitToken,
  reverseToken,
  reverseWords,
  fullReverse,
} from '../src/core/reverse.js';

test('reverseGraphemes reverses a plain ASCII string', () => {
  assert.equal(reverseGraphemes('problem'), 'melborp');
});

test('reverseGraphemes is grapheme-safe for emoji (no broken surrogate pairs)', () => {
  // "a👍b" reversed must keep the thumbs-up intact, not split its surrogate pair.
  assert.equal(reverseGraphemes('a👍b'), 'b👍a');
});

test('reverseGraphemes keeps a combining mark attached to its base letter', () => {
  // "é" as e + combining acute (U+0301). Naive UTF-16 reversal detaches the mark.
  const eCombining = 'é'; // é
  const input = 'a' + eCombining; // "aé"
  const reversed = reverseGraphemes(input);
  // The accented e must survive as one grapheme at the front.
  assert.equal(reversed, eCombining + 'a');
});

test('splitToken separates leading and trailing punctuation from the core', () => {
  assert.deepEqual(splitToken('melborp.'), { leading: '', core: 'melborp', trailing: '.' });
  assert.deepEqual(splitToken('"dias'), { leading: '"', core: 'dias', trailing: '' });
  assert.deepEqual(splitToken('(eht)'), { leading: '(', core: 'eht', trailing: ')' });
  assert.deepEqual(splitToken('word'), { leading: '', core: 'word', trailing: '' });
});

test('reverseToken reverses only the core, preserving trailing punctuation', () => {
  // The defect this guards against: naive reversal turns "melborp." into ".problem".
  assert.equal(reverseToken('melborp.'), 'problem.');
});

test('fullReverse converts a fully character-reversed sentence', () => {
  assert.equal(fullReverse('.melborp eht evlos lliw eW'), 'We will solve the problem.');
});

test('reverseWords reverses individually-reversed words while keeping order and punctuation', () => {
  assert.equal(reverseWords('eW lliw evlos eht melborp.'), 'We will solve the problem.');
});

test('reverseWords preserves the original whitespace between tokens', () => {
  assert.equal(reverseWords('eht\tdna'), 'the\tand');
});
