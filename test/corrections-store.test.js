// Corrections persistence adapter. Tested against an in-memory fake storage area so it runs
// without chrome — the adapter is injectable (createCorrectionsStore(area)).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCorrectionsStore } from '../src/extension/corrections-store.js';
import { makeOverride, makeSuppress, keyFor } from '../src/core/corrections.js';

// Minimal chrome.storage.local-shaped fake over a Map.
function fakeArea(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    failNextSet: false,
    async get(keys) {
      if (keys == null) return Object.fromEntries(map);
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (map.has(k)) out[k] = map.get(k);
      return out;
    },
    async set(obj) {
      if (this.failNextSet) {
        this.failNextSet = false;
        throw new Error('QUOTA_BYTES quota exceeded');
      }
      for (const [k, v] of Object.entries(obj)) map.set(k, v);
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) map.delete(k);
    },
    _map: map,
  };
}

test('saveRecord writes under the corr:v1: prefix; loadRecords returns an unprefixed map', async () => {
  const area = fakeArea();
  const store = createCorrectionsStore(area);
  const key = keyFor('hello world here');
  await store.saveRecord(key, makeSuppress('hello world here', 1));

  assert.ok(area._map.has(`corr:v1:${key}`), 'stored under prefixed key');
  const records = await store.loadRecords();
  assert.ok(records[key], 'returned under unprefixed key');
  assert.equal(records[key].type, 'suppress');
});

test('count and clear operate only on corr:v1:* keys', async () => {
  const area = fakeArea({ unrelated: 'keep me', 'settings:x': 1 });
  const store = createCorrectionsStore(area);
  await store.saveRecord('a', makeSuppress('aaaaaaaaaaaaaaaaaaaa', 1));
  await store.saveRecord('b', makeSuppress('bbbbbbbbbbbbbbbbbbbb', 1));
  assert.equal(await store.count(), 2);
  await store.clear();
  assert.equal(await store.count(), 0);
  assert.equal(area._map.get('unrelated'), 'keep me', 'non-correction keys untouched');
});

test('bump updates lastUsedAt for the given keys', async () => {
  const area = fakeArea();
  const store = createCorrectionsStore(area);
  await store.saveRecord('a', makeOverride('original text here', 'fix', 1));
  await store.bump(['a'], 999);
  const records = await store.loadRecords();
  assert.equal(records.a.lastUsedAt, 999);
  assert.equal(records.a.createdAt, 1, 'createdAt unchanged');
});

test('saving past the cap evicts the oldest lastUsedAt', async () => {
  const area = fakeArea();
  const store = createCorrectionsStore(area, { maxCorrections: 3 });
  await store.saveRecord('k0', makeSuppress('segment zero padded out', 0));
  await store.saveRecord('k1', makeSuppress('segment one padded out', 1));
  await store.saveRecord('k2', makeSuppress('segment two padded out', 2));
  assert.equal(await store.count(), 3);
  // 4th (newest) evicts k0 (oldest lastUsedAt = 0).
  await store.saveRecord('knew', makeSuppress('a brand new segment here', 99));
  const records = await store.loadRecords();
  assert.equal(Object.keys(records).length, 3);
  assert.equal(records.k0, undefined, 'oldest evicted');
  assert.ok(records.knew, 'newest kept');
});

test('a new record with an OLD timestamp still respects the cap (no self-eviction overshoot)', async () => {
  const area = fakeArea();
  const store = createCorrectionsStore(area, { maxCorrections: 2 });
  await store.saveRecord('a', makeSuppress('segment a padded out here', 10));
  await store.saveRecord('b', makeSuppress('segment b padded out here', 20));
  // Newcomer is OLDER than both existing — must evict an existing one, not itself.
  await store.saveRecord('c', makeSuppress('segment c padded out here', 1));
  const records = await store.loadRecords();
  assert.equal(Object.keys(records).length, 2, 'cap held');
  assert.ok(records.c, 'newcomer kept');
  assert.equal(records.a, undefined, 'oldest existing evicted');
});

test('a storage.set failure is caught and reported, not thrown', async () => {
  const area = fakeArea();
  area.failNextSet = true;
  const store = createCorrectionsStore(area);
  const res = await store.saveRecord('a', makeSuppress('some original text here', 1));
  assert.equal(res.ok, false);
  assert.match(res.error, /quota/i);
});

test('a failed save never deletes existing corrections (write-before-evict)', async () => {
  const area = fakeArea();
  const store = createCorrectionsStore(area, { maxCorrections: 2 });
  await store.saveRecord('a', makeSuppress('segment a padded out here', 1));
  await store.saveRecord('b', makeSuppress('segment b padded out here', 2));
  // The 3rd save (would evict 'a') fails at set — existing records must survive intact.
  area.failNextSet = true;
  const res = await store.saveRecord('c', makeSuppress('segment c padded out here', 3));
  assert.equal(res.ok, false);
  const records = await store.loadRecords();
  assert.ok(records.a && records.b, 'existing corrections preserved on failed save');
  assert.equal(records.c, undefined, 'failed record not stored');
});
