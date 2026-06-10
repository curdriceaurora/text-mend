// Scrambled-source / bag-of-words detection (hotfix point 3). Pure heuristics: we must
// NOT present reversed bag-of-words as a clean repair — fail closed and mark it instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  alphaSortedRatio,
  maxRepeatedTokenRun,
  stopwordRatio,
  looksObfuscated,
} from '../src/core/obfuscation.js';

test('alphaSortedRatio is ~1 for alphabetically sorted letters, moderate for prose', () => {
  assert.ok(alphaSortedRatio('aabbccddeeffgghhiijjkkllmmnnoopp') > 0.95);
  assert.ok(alphaSortedRatio('We will solve the problem soon today') < 0.75);
});

test('maxRepeatedTokenRun counts consecutive identical tokens', () => {
  assert.equal(maxRepeatedTokenRun(['the', 'the', 'the', 'and']), 3);
  assert.equal(maxRepeatedTokenRun(['we', 'will', 'solve', 'the', 'problem']), 1);
});

test('stopwordRatio is high for stopword salad, moderate for prose', () => {
  assert.ok(stopwordRatio(['the', 'and', 'of', 'to', 'in', 'for']) > 0.9);
  assert.ok(stopwordRatio(['wildlife', 'experts', 'say', 'the', 'glow', 'disrupts']) < 0.4);
});

// --- looksObfuscated: real repairs must pass; bag-of-words must be flagged ---

test('a genuine repaired sentence is NOT flagged as obfuscated', () => {
  assert.equal(looksObfuscated('We will solve the problem.').obfuscated, false);
  assert.equal(
    looksObfuscated('Wildlife experts say the nighttime glow disrupts sea turtles during the nesting season.').obfuscated,
    false,
  );
});

test('a stopword bag-of-words (high coverage, no grammar) is flagged', () => {
  const r = looksObfuscated('the and of to in for with the and of to in for with the and of');
  assert.equal(r.obfuscated, true);
  assert.equal(r.reason, 'unnatural');
});

test('a keyword salad of only content words is flagged', () => {
  const r = looksObfuscated('turtle lights county state season nesting beaches coast ocean glow horizon');
  assert.equal(r.obfuscated, true);
  assert.equal(r.reason, 'unnatural');
});

test('repeated stopword runs are flagged', () => {
  const r = looksObfuscated('county county county lights state and beaches near the coast today now');
  assert.equal(r.obfuscated, true);
  assert.equal(r.reason, 'repeated');
});

test('alphabetically sorted text is flagged', () => {
  const r = looksObfuscated('abide bind cope dose ever first gone hint into jolt know last most');
  assert.equal(r.obfuscated, true);
  assert.equal(r.reason, 'sorted');
});

test('short ambiguous text is not flagged (avoids false positives)', () => {
  assert.equal(looksObfuscated('the and of').obfuscated, false);
});
