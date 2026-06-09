// Pure correction-memory core (requirements §5.25; design spec §5–§6).
// No chrome / no clock: callers pass `now`. The hash is only a map index — replay safety
// comes from exact-original verification (§5), not hash strength.

import { detectSegment } from './detect.js';

export const MAX_ORIGINAL_BYTES = 4096;
export const MAX_REPLACEMENT_BYTES = 4096;
export const MAX_CORRECTIONS = 1000; // entry cap; LRU eviction by lastUsedAt
const SCHEMA_VERSION = 1;

/** Collapse whitespace runs + trim — the canonical form used for keys and exact match. */
export function normalizeForKey(text) {
  return text.replace(/\s+/gu, ' ').trim();
}

// cyrb53 — fast, dependency-free, well-distributed 53-bit string hash (public domain).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Map-index key for a segment's text (computed over its normalized form). */
export function keyFor(text) {
  return cyrb53(normalizeForKey(text)).toString(36);
}

const byteLen = (s) => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : Buffer.byteLength(s));

/** Build an override record, or null if the text exceeds the byte caps. */
export function makeOverride(originalText, replacement, now = 0) {
  const original = normalizeForKey(originalText);
  if (byteLen(original) > MAX_ORIGINAL_BYTES || byteLen(replacement) > MAX_REPLACEMENT_BYTES) return null;
  return { schemaVersion: SCHEMA_VERSION, type: 'override', original, replacement, createdAt: now, lastUsedAt: now };
}

/** Build a suppress record, or null if the original exceeds the byte cap. */
export function makeSuppress(originalText, now = 0) {
  const original = normalizeForKey(originalText);
  if (byteLen(original) > MAX_ORIGINAL_BYTES) return null;
  return { schemaVersion: SCHEMA_VERSION, type: 'suppress', original, createdAt: now, lastUsedAt: now };
}

/** Return the record for `text` only if it exists AND its stored original matches exactly. */
export function lookup(records, text) {
  const rec = records[keyFor(text)];
  if (!rec) return null;
  return rec.original === normalizeForKey(text) ? rec : null;
}

/**
 * Resolve a segment: a matching correction overrides detection; otherwise delegate to
 * detectSegment. Hits carry `source:'correction'` and `correctionKey` (for lastUsedAt bumps).
 */
export function resolveSegment(text, records = {}, opts = {}) {
  const rec = lookup(records, text);
  if (rec) {
    const correctionKey = keyFor(text);
    if (rec.type === 'suppress') {
      return { mode: 'none', applied: [], proposed: text, confidence: 1, tier: 'low', source: 'correction', correctionKey };
    }
    return { mode: 'override', applied: ['override'], proposed: rec.replacement, confidence: 1, tier: 'high', source: 'correction', correctionKey };
  }
  return detectSegment(text, opts);
}

/** Keys to evict (oldest lastUsedAt first) to bring the record count down to `max`. */
export function selectEvictions(records, max) {
  const keys = Object.keys(records);
  if (keys.length <= max) return [];
  return keys
    .sort((a, b) => (records[a].lastUsedAt ?? 0) - (records[b].lastUsedAt ?? 0))
    .slice(0, keys.length - max);
}
