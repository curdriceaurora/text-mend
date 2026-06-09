// Punctuation canonicalization (requirements §5.4.5 item 4).
// EXPORT-ONLY: this transforms copy/export output and is never applied to any rendered
// surface — in-page or reader view. Stylistic preference, not corruption repair.

// `--` becomes an em dash only in prose positions: surrounded by spaces (`a -- b`) or
// glued between word characters (`a--b`). CLI-style `--flag` (space before, glued to the
// word after) is left alone.
const SPACED_DASH = /(\s)--(?=\s)/gu;
// Letters only — avoid rewriting code-ish tokens like `x86--64` or `snake_case--var`.
const GLUED_DASH = /([A-Za-z])--(?=[A-Za-z])/gu;
// Exactly three dots (not part of a longer run) -> ellipsis.
const TRIPLE_DOT = /(?<!\.)\.\.\.(?!\.)/gu;

export function canonicalizePunctuation(text) {
  return text
    .replace(SPACED_DASH, '$1—')
    .replace(GLUED_DASH, '$1—')
    .replace(TRIPLE_DOT, '…');
}
