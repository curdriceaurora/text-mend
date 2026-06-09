// Invisible-character strip candidate (requirements §5.4.5 item 3).
// Pure deletion of zero-width/invisible characters; rendered text is unchanged, so the
// gate is "target characters present" and the tier is high by construction.

// ZWSP, soft hyphen, LRM/RLM directional marks, word joiner, zero-width no-break space.
const ALWAYS_STRIP = /[​­‎‏⁠﻿]/gu;

// ZWNJ/ZWJ are stripped only when NOT joining complex scripts or emoji — i.e. when not
// surrounded by characters that legitimately use joiners (emoji, Arabic, Indic, etc.).
const JOINER = /(.?)([‌‍])(.?)/gu;
const JOINING_CONTEXT = /[\p{Extended_Pictographic}\p{Script=Arabic}\p{Script=Devanagari}\p{Script=Bengali}\p{Script=Tamil}\p{Script=Telugu}\p{Script=Kannada}\p{Script=Malayalam}\p{Script=Sinhala}\p{Script=Myanmar}\p{Script=Khmer}\p{M}]/u;

export function stripInvisibles(text) {
  let out = text.replace(ALWAYS_STRIP, '');
  out = out.replace(JOINER, (match, before, joiner, after) =>
    JOINING_CONTEXT.test(before) || JOINING_CONTEXT.test(after)
      ? match
      : before + after,
  );
  return out;
}

export function hasInvisibles(text) {
  return stripInvisibles(text) !== text;
}
