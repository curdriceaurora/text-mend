// Scrambled-source / bag-of-words detection (requirements: fail closed on obfuscated source).
// Real reversed prose un-reverses into a natural sentence; deliberately scrambled or paywall
// "word salad" un-reverses into real words with no grammar. We detect the latter and refuse to
// present it as a clean repair (the caller marks it "source appears obfuscated/paywalled").

import { dictionaryCoverage } from './detect-score.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'with',
  'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'these', 'those', 'he', 'she', 'they', 'we', 'you', 'i', 'not', 'no', 'so', 'if', 'then',
  'than', 'too', 'very', 'can', 'will', 'would', 'about', 'into', 'over', 'under', 'out',
  'up', 'down', 'his', 'her', 'their', 'our', 'your', 'my', 'which', 'who', 'what', 'when',
  'where', 'why', 'how', 'all', 'any', 'some', 'such', 'only', 'also', 'just', 'now', 'here',
  'there', 'during', 'near',
]);

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z']+/gu) || []).filter(Boolean);
}

/** Fraction of adjacent alphabetic characters that are in non-decreasing order. */
export function alphaSortedRatio(text) {
  const letters = text.toLowerCase().replace(/[^a-z]/gu, '');
  if (letters.length < 2) return 0;
  let inOrder = 0;
  for (let i = 0; i < letters.length - 1; i++) if (letters[i] <= letters[i + 1]) inOrder++;
  return inOrder / (letters.length - 1);
}

/** Fraction of adjacent tokens that are in non-decreasing alphabetical order. */
export function wordSortedRatio(tokens) {
  if (tokens.length < 2) return 0;
  let inOrder = 0;
  for (let i = 0; i < tokens.length - 1; i++) if (tokens[i] <= tokens[i + 1]) inOrder++;
  return inOrder / (tokens.length - 1);
}

/** Longest run of the identical token repeated consecutively. */
export function maxRepeatedTokenRun(tokens) {
  let max = 0;
  let run = 0;
  let prev = null;
  for (const t of tokens) {
    run = t === prev ? run + 1 : 1;
    if (run > max) max = run;
    prev = t;
  }
  return max;
}

/** Fraction of tokens that are stopwords. */
export function stopwordRatio(tokens) {
  if (tokens.length === 0) return 0;
  return tokens.filter((t) => STOPWORDS.has(t)).length / tokens.length;
}

function endsWithSentencePunctuation(text) {
  return /[.!?]["'”’)\]]?\s*$/u.test(text.trim());
}

/**
 * @returns {{obfuscated: boolean, reason: 'sorted'|'repeated'|'unnatural'|null}}
 * Conservative — must not fire on genuine repaired prose.
 */
export function looksObfuscated(text) {
  const tokens = tokenize(text);
  if (tokens.length < 6) return { obfuscated: false, reason: null };

  // (1) Alphabetically sorted source (a known scramble): either the characters trend
  // alphabetical (char-level), or the words themselves are in alphabetical order (a sorted
  // word list). Natural prose is ~0.5 on both.
  const letters = text.replace(/[^a-zA-Z]/gu, '');
  if (
    (letters.length >= 40 && alphaSortedRatio(text) > 0.8) ||
    (tokens.length >= 8 && wordSortedRatio(tokens) > 0.9)
  ) {
    return { obfuscated: true, reason: 'sorted' };
  }

  // (2) Repeated stopword/word runs — natural prose almost never repeats a word 3× in a row.
  if (maxRepeatedTokenRun(tokens) >= 3) {
    return { obfuscated: true, reason: 'repeated' };
  }

  // (3) High dictionary coverage but bad sentence naturalness: real words, no grammar —
  // an extreme stopword ratio (all function words OR all content words) with no terminal
  // sentence punctuation across a long-enough span is the bag-of-words signature.
  const coverage = dictionaryCoverage(text);
  const stopwords = stopwordRatio(tokens);
  if (
    coverage >= 0.85 &&
    tokens.length >= 8 &&
    !endsWithSentencePunctuation(text) &&
    (stopwords >= 0.55 || stopwords <= 0.12)
  ) {
    return { obfuscated: true, reason: 'unnatural' };
  }

  return { obfuscated: false, reason: null };
}
