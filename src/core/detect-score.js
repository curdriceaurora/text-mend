// Shared tokenization + dictionary scoring, used by both detect.js (confidence formula)
// and repair.js (mojibake tier gate) without a circular import.

import { isWord } from './corpus.js';
import { splitToken } from './reverse.js';

/** Lowercase word cores extracted from text (punctuation stripped). */
export function tokenize(text) {
  return text
    .split(/\s+/u)
    .map((t) => splitToken(t).core.toLowerCase())
    .filter((t) => t.length > 0);
}

/** Fraction of tokens that are dictionary words. */
export function dictionaryCoverage(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter(isWord).length;
  return hits / tokens.length;
}
