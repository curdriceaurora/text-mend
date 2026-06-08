// Duplicate-paragraph removal (requirements §5.9).

/** Normalize whitespace for duplicate comparison (collapse runs, trim). */
function normalize(text) {
  return text.replace(/\s+/gu, ' ').trim();
}

/**
 * Remove duplicate paragraphs that recur within `window` positions of each other.
 * `window` is the max gap that still counts as a duplicate (a repeat is dropped when
 * `index - previousIndex < window`). Default window=2 therefore catches only adjacent
 * (back-to-back) repeats; pass a larger window for near-distance repeats (e.g. window=3
 * drops a caption echoed one paragraph later). Order is preserved.
 */
export function dedupeParagraphs(paragraphs, { window = 2 } = {}) {
  const out = [];
  const lastSeen = new Map(); // normalized text -> original index
  paragraphs.forEach((para, index) => {
    const key = normalize(para);
    const prev = lastSeen.get(key);
    if (prev !== undefined && index - prev < window) {
      lastSeen.set(key, index);
      return; // drop the duplicate
    }
    lastSeen.set(key, index);
    out.push(para);
  });
  return out;
}
