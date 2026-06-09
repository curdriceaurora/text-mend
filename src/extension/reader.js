// Reader-view article builder (requirements §5.21). chrome-free + DOM-free output:
// takes a source `document`, returns a repaired article with per-block repair metadata.
// The reader page (reader-page.js) renders this into an owned surface, so repairs that
// the in-page flow could only preview (link-spanning segments) are fully applied here.
// Punctuation canonicalization is deliberately NOT applied — it is export-only (§5.4.5.4).

import { extractArticle } from './extract-article.js';
import { resolveSegment } from '../core/corrections.js';

const WORDS_PER_MIN = 200;

function repairBlock(text, records) {
  // unwrap enabled: reader text may carry visible hard wraps from extraction.
  const det = resolveSegment(text, records, { unwrap: true });
  if (det.mode === 'none') {
    // Carry correctionKey even when unchanged (a suppress replay) so it can be bumped.
    return { text, original: text, changed: false, modes: [], tier: 'high', correctionKey: det.correctionKey };
  }
  return {
    text: det.proposed,
    original: text,
    changed: true,
    modes: det.applied,
    tier: det.tier,
    correctionKey: det.correctionKey,
  };
}

export function buildReaderArticle(doc, opts = {}) {
  const { records = {} } = opts;
  const extracted = extractArticle(doc, opts);
  let wordCount = 0;
  const replayedKeys = [];
  const blocks = extracted.blocks.map((b) => {
    const r = repairBlock(b.text, records);
    if (r.correctionKey) replayedKeys.push(r.correctionKey);
    wordCount += r.text.split(/\s+/).filter(Boolean).length;
    return { type: b.type, level: b.level, ...r };
  });
  return {
    title: extracted.title,
    byline: extracted.byline,
    date: extracted.date,
    readingTimeMin: Math.max(1, Math.round(wordCount / WORDS_PER_MIN)),
    blocks,
    replayedKeys,
  };
}
