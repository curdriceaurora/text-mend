// Corrections persistence adapter (design spec §3, §4, §10). The ONLY storage boundary:
// it owns the `corr:v1:` namespace, supplies Date.now() to the pure builders' callers, and
// enforces the entry cap. Injectable storage area keeps it testable without chrome; the
// pure core (corrections.js) never sees the prefix.

import { selectEvictions, MAX_CORRECTIONS } from '../core/corrections.js';

const PREFIX = 'corr:v1:';

export function createCorrectionsStore(area = chrome.storage.local, { maxCorrections = MAX_CORRECTIONS } = {}) {
  async function loadPrefixed() {
    const all = await area.get(null);
    const out = {};
    for (const k of Object.keys(all)) if (k.startsWith(PREFIX)) out[k] = all[k];
    return out;
  }

  /** All correction records as an UNPREFIXED map keyed by keyFor(text). */
  async function loadRecords() {
    const prefixed = await loadPrefixed();
    const out = {};
    for (const k of Object.keys(prefixed)) out[k.slice(PREFIX.length)] = prefixed[k];
    return out;
  }

  /** Persist one record; evicts the oldest OTHER records to stay within the cap. Never throws. */
  async function saveRecord(key, record) {
    if (!record) return { ok: false, error: 'over size limit' };
    const pk = PREFIX + key;
    try {
      // Write FIRST so a set failure (quota) can't leave us having deleted existing records.
      await area.set({ [pk]: record });
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
    // Then evict the oldest OTHER records to stay within the cap. The just-written key is
    // excluded from candidates, so a new record with an old timestamp can't evict itself.
    // A failure here is non-fatal: the record is saved; the cap self-heals on the next save.
    try {
      const others = await loadPrefixed();
      delete others[pk];
      const evict = selectEvictions(others, Math.max(0, maxCorrections - 1));
      if (evict.length) await area.remove(evict);
    } catch {
      /* non-fatal */
    }
    return { ok: true };
  }

  /** Best-effort lastUsedAt bump for replayed keys (batched). Never throws. */
  async function bump(keys, now) {
    if (!keys || keys.length === 0) return { ok: true };
    try {
      const prefixed = await loadPrefixed();
      const patch = {};
      for (const key of keys) {
        const pk = PREFIX + key;
        if (prefixed[pk]) patch[pk] = { ...prefixed[pk], lastUsedAt: now };
      }
      if (Object.keys(patch).length) await area.set(patch);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  }

  async function count() {
    return Object.keys(await loadPrefixed()).length;
  }

  async function clear() {
    const keys = Object.keys(await loadPrefixed());
    if (keys.length) await area.remove(keys);
  }

  return { loadRecords, saveRecord, bump, count, clear };
}
