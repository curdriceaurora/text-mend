// Hard-wrap / hyphenation repair candidate (requirements §5.4.5 item 2).
// Joins mid-sentence single line breaks and dictionary-validated hyphenation splits.
// Double newlines (paragraph breaks) are always preserved. This candidate is only
// meaningful where \n represents a VISIBLE break (extraction/export, <br>-derived text);
// in-page DOM text nodes carry source newlines that render as collapsed whitespace,
// so the caller (repair.js) keeps it disabled for in-page scans.

import { isWord } from './corpus.js';

// `exten-\nsion` -> `extension` only when the joined form is a dictionary word.
const HYPHEN_SPLIT = /([A-Za-z]{2,})-\n([a-z]{2,})/gu;
// Mid-sentence wrap: lowercase letter or comma before the break, lowercase after.
const SOFT_WRAP = /([a-z,])\n(?=[a-z])/gu;

/**
 * @returns {{text: string, tier: 'high'|'medium', joins: number}}
 *   tier is high only when every join was dictionary-validated (hyphenation);
 *   any heuristic line-break join demotes the result to medium (preview).
 */
export function unwrapText(text) {
  let joins = 0;
  let heuristicJoins = 0;

  // Protect paragraph breaks from the soft-wrap rule.
  const PARA = '\u0000';
  let out = text.replace(/\n{2,}/gu, PARA);

  out = out.replace(HYPHEN_SPLIT, (match, left, right) => {
    const joined = left + right;
    if (isWord(joined.toLowerCase()) && !isWord(`${left}-${right}`.toLowerCase())) {
      joins++;
      return joined;
    }
    return match;
  });

  out = out.replace(SOFT_WRAP, (_m, before) => {
    joins++;
    heuristicJoins++;
    return `${before} `;
  });

  out = out.replaceAll(PARA, '\n\n');
  if (joins === 0) return { text, tier: 'high', joins: 0 };
  return { text: out, tier: heuristicJoins > 0 ? 'medium' : 'high', joins };
}
