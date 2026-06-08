// Grapheme-safe, punctuation-aware reversal primitives.
// All reversal operates on grapheme clusters via Intl.Segmenter (never split('')),
// so emoji surrogate pairs and combining marks survive intact. See requirements §5.4.

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Reverse a string by grapheme cluster (Unicode-safe). */
export function reverseGraphemes(text) {
  const graphemes = Array.from(graphemeSegmenter.segment(text), (s) => s.segment);
  return graphemes.reverse().join('');
}

// Characters treated as "punctuation" when peeled off the edges of a token.
// Includes ASCII punctuation plus common typographic marks (smart quotes, dashes).
const EDGE_PUNCTUATION = /[\s!-/:-@[-`{-~¡¿‐-‧‰-⁞‘’“”]/u;

function isEdgePunctuation(ch) {
  return EDGE_PUNCTUATION.test(ch);
}

/**
 * Split a token into { leading, core, trailing } where leading/trailing are
 * runs of edge punctuation and core is the word body. Operates on graphemes.
 */
export function splitToken(token) {
  const chars = Array.from(graphemeSegmenter.segment(token), (s) => s.segment);
  let start = 0;
  let end = chars.length;
  while (start < end && isEdgePunctuation(chars[start])) start++;
  while (end > start && isEdgePunctuation(chars[end - 1])) end--;
  return {
    leading: chars.slice(0, start).join(''),
    core: chars.slice(start, end).join(''),
    trailing: chars.slice(end).join(''),
  };
}

/** Reverse only the word core of a token, preserving edge punctuation in place. */
export function reverseToken(token) {
  const { leading, core, trailing } = splitToken(token);
  return leading + reverseGraphemes(core) + trailing;
}

/** Full-string reverse: the whole segment was reversed character-by-character. */
export function fullReverse(text) {
  return reverseGraphemes(text);
}

// Capture whitespace runs as delimiters so we can rejoin with the exact original spacing.
const WHITESPACE_SPLIT = /(\s+)/u;

/** Token-level reverse: each word was individually reversed but word order is correct. */
export function reverseWords(text) {
  return text
    .split(WHITESPACE_SPLIT)
    .map((part) => (/^\s+$/u.test(part) || part === '' ? part : reverseToken(part)))
    .join('');
}
