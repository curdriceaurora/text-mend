// Mojibake repair candidate (requirements §5.4.5 item 1): reverse UTF-8-decoded-as-
// windows-1252 double-decode artifacts. The mapping table is GENERATED at module load
// (encode target char to UTF-8 bytes, mis-decode as windows-1252) so entries are exact
// by construction and bidirectionally unambiguous — no hand-typed artifact strings.

const encoder = new TextEncoder();
const cp1252 = new TextDecoder('windows-1252');

/** The double-decode artifact form of a character (exported for tests/fixtures). */
export function artifactFor(char) {
  return cp1252.decode(encoder.encode(char));
}

// Characters whose mojibake forms appear routinely in news text: typographic punctuation
// and common Latin-1 accented letters. General-purpose — no domain vocabulary involved.
// No nbsp entry: its artifact is 'Â' + U+00A0; repairing it deletes a leading 'Â' with no
// effect on dictionary coverage, i.e. it would silently corrupt a legitimate 'Â' at
// auto-apply tier for ~zero reading benefit. Left out deliberately.
const TARGETS = [
  '’', '‘', '“', '”', '–', '—', '…', '•', '€', '°', '™', '£',
  'á', 'à', 'â', 'ä', 'ã', 'å', 'ç', 'é', 'è', 'ê', 'ë',
  'í', 'ì', 'î', 'ï', 'ñ', 'ó', 'ò', 'ô', 'ö', 'õ',
  'ú', 'ù', 'û', 'ü', 'ý',
];

// Longest-first so multi-byte artifacts win over their prefixes.
const TABLE = TARGETS.map((target) => ({ artifact: artifactFor(target), target }))
  .filter(({ artifact, target }) => artifact !== target && artifact.length > 1)
  .sort((a, b) => b.artifact.length - a.artifact.length);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ARTIFACT_RE = new RegExp(TABLE.map((e) => escapeRe(e.artifact)).join('|'), 'gu');
const LOOKUP = new Map(TABLE.map((e) => [e.artifact, e.target]));

// "Strong" artifacts begin with â (U+00E2) or Ã (U+00C3) — the UTF-8 lead bytes for the
// punctuation/accent ranges. These multi-codepoint sequences essentially never occur in
// legitimate text, so their presence is a reliable corruption signal. The remaining "weak"
// single-'Â' entries (Â°, Â£) collide with real À-circumflex prose, so callers should only
// auto-apply mojibake repair when a strong artifact co-occurs (see repair.js).
const STRONG_ARTIFACTS = TABLE.filter((e) => /^[âÃ]/u.test(e.artifact)).map((e) => e.artifact);
const STRONG_RE = new RegExp(STRONG_ARTIFACTS.map((a) => escapeRe(a)).join('|'), 'u');

/** True if the text contains an unambiguous (â/Ã-led) mojibake artifact. */
export function hasStrongArtifact(text) {
  return STRONG_RE.test(text);
}

/** Replace every mapped artifact with its original character. */
export function repairMojibake(text) {
  return text.replace(ARTIFACT_RE, (m) => LOOKUP.get(m) ?? m);
}

/** Number of mapped artifacts present (the §5.4.5 gate: apply only when ≥ 1). */
export function mojibakeArtifactCount(text) {
  const matches = text.match(ARTIFACT_RE);
  return matches ? matches.length : 0;
}
