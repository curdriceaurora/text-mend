// Bundled, general-purpose English word list for local scoring (requirements §5.3.7).
// The bulk is a frequency-ranked list (src/core/corpus-data.js, generated from
// hermitdave/FrequencyWords, MIT — see NOTICE.md). A small curated supplement adds
// product/domain-neutral terms that may fall outside the top-N frequency cut. No
// article-specific vocabulary is hardcoded; common nouns like "turtle"/"county" are
// present only because the frequency list includes them.

import { WORDS as FREQUENCY_WORDS } from './corpus-data.js';

// Supplement: the single-letter words "a"/"i" (dropped by the build's length>=2 filter)
// and a few tool-specific terms that fall outside the top-N frequency cut.
const CURATED = ['a', 'i', 'readable', 'normalize', 'normalized', 'mojibake'];

const WORD_SET = new Set([...FREQUENCY_WORDS, ...CURATED]);

/** True if the lowercased token is in the bundled dictionary. */
export function isWord(token) {
  return WORD_SET.has(token.toLowerCase());
}

export const COMMON_WORD_COUNT = WORD_SET.size;
