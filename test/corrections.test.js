// Pure correction-memory core (spec §5, §6). No chrome / clock — `now` is passed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeForKey,
  keyFor,
  lookup,
  resolveSegment,
  makeOverride,
  makeSuppress,
  selectEvictions,
  MAX_ORIGINAL_BYTES,
  MAX_REPLACEMENT_BYTES,
} from '../src/core/corrections.js';
import { detectSegment } from '../src/core/detect.js';

const REVERSED = '.melborp eht evlos lliw eW';
const NORMAL = 'We will solve the problem soon.';

test('keyFor is stable across whitespace variants and distinct for distinct content', () => {
  assert.equal(keyFor('the  quick   fox'), keyFor('the quick fox'));
  assert.equal(keyFor('  the quick fox '), keyFor('the quick fox'));
  assert.notEqual(keyFor('the quick fox'), keyFor('the quick ox'));
});

test('normalizeForKey collapses whitespace and trims', () => {
  assert.equal(normalizeForKey('  a\t b\n c '), 'a b c');
});

test('makeOverride / makeSuppress build records and enforce byte caps', () => {
  const o = makeOverride('orig text here', 'fixed text', 1000);
  assert.equal(o.type, 'override');
  assert.equal(o.original, 'orig text here');
  assert.equal(o.replacement, 'fixed text');
  assert.equal(o.createdAt, 1000);
  assert.equal(o.lastUsedAt, 1000);
  assert.equal(o.schemaVersion, 1);

  const s = makeSuppress('orig text here', 2000);
  assert.equal(s.type, 'suppress');
  assert.equal(s.replacement, undefined);

  assert.equal(makeOverride('x', 'y'.repeat(MAX_REPLACEMENT_BYTES + 1), 1), null);
  assert.equal(makeOverride('o'.repeat(MAX_ORIGINAL_BYTES + 1), 'y', 1), null);
  assert.equal(makeSuppress('o'.repeat(MAX_ORIGINAL_BYTES + 1), 1), null);
});

test('lookup requires an exact original match (hash collision is not enough)', () => {
  const records = { [keyFor(REVERSED)]: makeSuppress(normalizeForKey(REVERSED), 1) };
  assert.ok(lookup(records, REVERSED));
  // Forge a record under the same key but with a different stored original.
  const forged = { [keyFor(REVERSED)]: { ...makeSuppress('totally different text', 1) } };
  assert.equal(lookup(forged, REVERSED), null);
});

test('resolveSegment: suppress beats high-confidence detection', () => {
  const records = { [keyFor(REVERSED)]: makeSuppress(normalizeForKey(REVERSED), 1) };
  const r = resolveSegment(REVERSED, records);
  assert.equal(r.mode, 'none');
  assert.equal(r.source, 'correction');
  assert.equal(r.correctionKey, keyFor(REVERSED));
});

test('resolveSegment: override replaces with stored text and reports the key', () => {
  const records = { [keyFor(REVERSED)]: makeOverride(normalizeForKey(REVERSED), 'CUSTOM FIX', 1) };
  const r = resolveSegment(REVERSED, records);
  assert.equal(r.mode, 'override');
  assert.equal(r.proposed, 'CUSTOM FIX');
  assert.deepEqual(r.applied, ['override']);
  assert.equal(r.tier, 'high');
  assert.equal(r.correctionKey, keyFor(REVERSED));
});

test('resolveSegment: miss is identical to detectSegment and has no source', () => {
  const direct = detectSegment(REVERSED);
  const resolved = resolveSegment(REVERSED, {});
  assert.equal(resolved.mode, direct.mode);
  assert.equal(resolved.proposed, direct.proposed);
  assert.equal(resolved.source, undefined);
  assert.equal(resolveSegment(NORMAL, {}).mode, 'none');
});

test('selectEvictions drops the oldest lastUsedAt over the cap', () => {
  const records = {
    a: { lastUsedAt: 300 },
    b: { lastUsedAt: 100 },
    c: { lastUsedAt: 200 },
  };
  assert.deepEqual(selectEvictions(records, 2), ['b']); // oldest removed to get to 2
  assert.deepEqual(selectEvictions(records, 3), []);
  assert.deepEqual(selectEvictions(records, 1).sort(), ['b', 'c']);
});
