// Bundled, general-purpose English word list for local scoring (requirements §5.3.7).
// Deliberately NOT domain-specific: no article vocabulary is hardcoded. This is a
// compact high-frequency list; production would swap in a larger permissively-licensed
// frequency list (attribution in NOTICE.md) without changing the scoring API.

const WORDS = [
  // function words / stopwords
  'the', 'and', 'a', 'an', 'of', 'to', 'in', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'it', 'its', 'for', 'on', 'with', 'as', 'at', 'by', 'this', 'that', 'these',
  'those', 'from', 'or', 'but', 'not', 'no', 'nor', 'so', 'if', 'then', 'than', 'too',
  'very', 'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'do', 'does', 'did', 'done', 'have', 'has', 'had', 'having', 'i', 'you', 'he', 'she',
  'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their',
  'who', 'whom', 'whose', 'which', 'what', 'when', 'where', 'why', 'how', 'all', 'any',
  'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same',
  'about', 'above', 'after', 'again', 'against', 'before', 'below', 'between', 'down',
  'during', 'into', 'over', 'through', 'under', 'until', 'up', 'out', 'off', 'here',
  'there', 'once', 'because', 'while', 'also', 'just', 'now', 'still', 'even', 'ever',
  // common verbs
  'go', 'goes', 'going', 'went', 'gone', 'make', 'makes', 'made', 'making', 'take',
  'takes', 'took', 'taken', 'taking', 'come', 'comes', 'came', 'coming', 'see', 'sees',
  'saw', 'seen', 'seeing', 'know', 'knows', 'knew', 'known', 'get', 'gets', 'got',
  'give', 'gives', 'gave', 'given', 'find', 'finds', 'found', 'think', 'thinks',
  'thought', 'say', 'says', 'said', 'tell', 'tells', 'told', 'work', 'works', 'worked',
  'use', 'uses', 'used', 'want', 'wants', 'wanted', 'need', 'needs', 'needed', 'try',
  'tries', 'tried', 'ask', 'asked', 'turn', 'turns', 'turned', 'help', 'helps', 'helped',
  'show', 'shows', 'showed', 'shown', 'change', 'changes', 'changed', 'solve', 'solves',
  'solved', 'remove', 'removes', 'removed', 'keep', 'keeps', 'kept', 'put', 'leave',
  'leaves', 'left', 'read', 'reads', 'write', 'writes', 'wrote', 'written', 'copy',
  'detect', 'detects', 'detected', 'convert', 'converts', 'converted', 'normalize',
  // common nouns / adjectives
  'time', 'times', 'year', 'years', 'day', 'days', 'way', 'ways', 'thing', 'things',
  'people', 'person', 'man', 'woman', 'child', 'world', 'life', 'hand', 'part', 'place',
  'case', 'point', 'home', 'water', 'room', 'word', 'words', 'problem', 'problems',
  'fact', 'group', 'number', 'state', 'states', 'page', 'pages', 'text', 'light',
  'lights', 'issue', 'issues', 'option', 'options', 'safety', 'season', 'area', 'side',
  'long', 'little', 'good', 'great', 'high', 'small', 'large', 'new', 'old', 'first',
  'last', 'next', 'many', 'much', 'right', 'left', 'early', 'big', 'simple', 'normal',
  'reversed', 'readable', 'solution', 'solutions',
];

const WORD_SET = new Set(WORDS);

/** True if the lowercased token is in the bundled dictionary. */
export function isWord(token) {
  return WORD_SET.has(token.toLowerCase());
}

export const COMMON_WORD_COUNT = WORD_SET.size;
