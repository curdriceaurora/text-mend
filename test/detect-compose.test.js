// §5.19 step 4: V1.5 pre-repairs compose with reversal scoring in detectSegment.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSegment } from '../src/core/detect.js';
import { artifactFor } from '../src/core/mojibake.js';

const moji = (s) => artifactFor(s);

test('mojibake-only segment is proposed with mode repair and applied list', () => {
  const input = `It${moji('’')}s a problem we will solve over time, they said.`;
  const r = detectSegment(input);
  assert.equal(r.proposed, 'It’s a problem we will solve over time, they said.');
  assert.equal(r.mode, 'repair');
  assert.deepEqual(r.applied, ['mojibake']);
  assert.equal(r.tier, 'high');
});

test('mojibake composes with full reversal; applied lists both, in order', () => {
  // Reverse a clean sentence, then corrupt the resulting right single quote.
  const reversed = '.melborp eht evlos lliw eW'.replace("'", ''); // plain ascii here
  const corrupted = `.melborp eht evlos lliw eW`.replace('eW', `eW${moji('’')}`);
  // Simpler real case: a reversed sentence whose apostrophe was mojibaked.
  const r = detectSegment(corrupted);
  assert.ok(r.applied.includes('mojibake'), `applied=${r.applied}`);
  assert.ok(r.applied.includes('full'), `applied=${r.applied}`);
  assert.equal(r.applied[r.applied.length - 1], 'full'); // reversal runs last
  void reversed;
});

test('pure reversal still reports its classic mode with applied=[mode]', () => {
  const r = detectSegment('.melborp eht evlos lliw eW');
  assert.equal(r.mode, 'full');
  assert.deepEqual(r.applied, ['full']);
});

test('clean text yields mode none and empty applied', () => {
  const r = detectSegment('We will solve the problem soon.');
  assert.equal(r.mode, 'none');
  assert.deepEqual(r.applied, []);
});

test('unwrap participates only when enabled, and demotes tier to medium', () => {
  const wrapped = 'the lights were\nstill burning bright over the water';
  const off = detectSegment(wrapped);
  assert.equal(off.mode, 'none');
  const on = detectSegment(wrapped, { unwrap: true });
  assert.equal(on.mode, 'repair');
  assert.deepEqual(on.applied, ['unwrap']);
  assert.equal(on.tier, 'medium'); // heuristic join → preview, never auto-apply
});
