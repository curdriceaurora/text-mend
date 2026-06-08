// Local heuristic detection + confidence scoring (requirements §5.2, §5.3).
// Scoring always compares ORIGINAL vs PROPOSED text, never "does the string look reversed".

import { isWord } from './corpus.js';
import { reverseGraphemes, fullReverse, reverseWords, splitToken } from './reverse.js';

const MIN_SEGMENT_LENGTH = 20; // §5.11 default
const DEFAULT_THRESHOLD = 0.75; // §5.11 default

const URL_RE = /\bhttps?:\/\/|\bwww\.|\b\S+\.(com|org|net|io|gov|edu)\b/iu;
const EMAIL_RE = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/u;

/** Lowercase word cores extracted from text (punctuation stripped). */
function tokenize(text) {
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

/** Coherence proxy for n-gram score: fraction of adjacent token pairs both in-dictionary. */
function bigramCoherence(text) {
  const tokens = tokenize(text);
  if (tokens.length < 2) return dictionaryCoverage(text);
  let good = 0;
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isWord(tokens[i]) && isWord(tokens[i + 1])) good++;
  }
  return good / (tokens.length - 1);
}

/** Fraction of original tokens whose grapheme-reverse is a dictionary word (reversal signal). */
function reversedCommonTokenScore(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;
  const hits = tokens.filter((t) => isWord(reverseGraphemes(t))).length;
  return hits / tokens.length;
}

const clamp01 = (n) => Math.max(0, Math.min(1, n));

function endsLikeSentence(text) {
  return /[.!?]["'”’)]?\s*$/u.test(text.trim());
}
function startsCapitalized(text) {
  return /^["'“‘(]*[A-Z]/u.test(text.trim());
}

/** Reward proposals that read like a sentence (capital start, terminal punctuation). */
function punctuationImprovementScore(original, proposed) {
  const score = (t) => (endsLikeSentence(t) ? 0.5 : 0) + (startsCapitalized(t) ? 0.5 : 0);
  return clamp01(score(proposed) - score(original));
}

/** Casing plausibility of the proposal on its own. */
function casingBoundaryScore(proposed) {
  const trimmed = proposed.trim();
  if (!trimmed) return 0;
  let s = 0;
  if (startsCapitalized(trimmed)) s += 0.6;
  // penalize ALL-CAPS noise; reward presence of lowercase body
  if (/[a-z]/u.test(trimmed)) s += 0.4;
  return clamp01(s);
}

/**
 * Confidence that `proposed` is a better-normalized form of `original`, in [0,1].
 * Weighted per §5.3.6.
 */
export function confidence(original, proposed) {
  if (proposed === original) return 0;
  const dictionaryDelta = clamp01(dictionaryCoverage(proposed) - dictionaryCoverage(original));
  const ngramDelta = clamp01(bigramCoherence(proposed) - bigramCoherence(original));
  const reversedCommon = reversedCommonTokenScore(original);
  const punctuation = punctuationImprovementScore(original, proposed);
  const casing = casingBoundaryScore(proposed);
  return clamp01(
    0.35 * dictionaryDelta +
      0.25 * ngramDelta +
      0.2 * reversedCommon +
      0.1 * punctuation +
      0.1 * casing,
  );
}

/** Map a confidence value to a tier given the threshold. */
export function classify(value, threshold = DEFAULT_THRESHOLD) {
  if (value >= threshold) return 'high';
  if (value >= threshold / 2) return 'medium';
  return 'low';
}

// Exclusion gate (§5.3.8 / §5.11). V1 deliberately rejects a whole segment if it contains
// a URL/email rather than excluding just the offending token — conservative (safe but
// lossy: a long paragraph mentioning one URL is skipped). Token-level exclusion is a
// documented follow-up; see requirements §5.3.8.
export function shouldProcess(text, { minLength = MIN_SEGMENT_LENGTH } = {}) {
  const trimmed = text.trim();
  if (trimmed.length < minLength) return false;
  if (URL_RE.test(trimmed)) return false;
  if (EMAIL_RE.test(trimmed)) return false;
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return false;
  // mostly numeric / dates → skip
  const alpha = tokens.filter((t) => /[a-z]/iu.test(t)).length;
  if (alpha / tokens.length < 0.5) return false;
  return true;
}

/**
 * Evaluate a text segment and return the best deterministic normalization.
 * Returns { mode: 'none'|'full'|'words', proposed, confidence, tier }.
 */
export function detectSegment(text, { threshold = DEFAULT_THRESHOLD, minLength } = {}) {
  if (!shouldProcess(text, { minLength })) {
    return { mode: 'none', proposed: text, confidence: 0, tier: 'low' };
  }

  const candidates = [
    { mode: 'full', proposed: fullReverse(text) },
    { mode: 'words', proposed: reverseWords(text) },
  ];

  // Rank candidates by full confidence so word ORDER (punctuation/casing), not just
  // dictionary coverage, decides between full-string and word-level reversal.
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    if (c.proposed === text) continue;
    const score = confidence(text, c.proposed);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) return { mode: 'none', proposed: text, confidence: 0, tier: 'low' };

  const conf = bestScore;
  const tier = classify(conf, threshold);
  if (tier === 'low') {
    return { mode: 'none', proposed: text, confidence: conf, tier };
  }
  return { mode: best.mode, proposed: best.proposed, confidence: conf, tier };
}
