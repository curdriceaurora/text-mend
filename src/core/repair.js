// Gated pre-repair pass (requirements §5.4.5 / §5.19 step 4).
// Fixed composition order: strip -> mojibake -> unwrap. Each candidate runs only when
// its gate opens; the composition's tier is the LOWEST tier among applied components.
// Unwrap is opt-in (extraction/export paths only): in-page DOM text nodes carry source
// newlines that render as collapsed whitespace, where "unwrapping" would be a no-op
// visually but would flood the false-positive bar.

import { stripInvisibles, hasInvisibles } from './strip.js';
import { repairMojibake, mojibakeArtifactCount, hasStrongArtifact } from './mojibake.js';
import { unwrapText } from './unwrap.js';
import { dictionaryCoverage } from './detect-score.js';

const TIER_RANK = { high: 2, medium: 1, low: 0 };
const lowest = (a, b) => (TIER_RANK[a] <= TIER_RANK[b] ? a : b);

/**
 * @param {string} text
 * @param {{unwrap?: boolean}} [opts]
 * @returns {{text: string, applied: {mode: string, tier: string}[], tier: 'high'|'medium'}}
 */
export function preRepair(text, { unwrap = false } = {}) {
  const applied = [];
  let out = text;
  let tier = 'high';

  if (hasInvisibles(out)) {
    out = stripInvisibles(out);
    applied.push({ mode: 'strip', tier: 'high' }); // high by construction (§5.4.5.3)
  }

  if (mojibakeArtifactCount(out) > 0) {
    const repaired = repairMojibake(out);
    // High tier (auto-apply) requires BOTH a strong, unambiguous artifact present (so a
    // lone 'Â°'/'Â£' in real prose can't auto-fire) AND no dictionary-coverage regression
    // (§5.4.5.1). Weak-only matches route to medium (preview) instead of auto-applying.
    const coverageOk = dictionaryCoverage(repaired) >= dictionaryCoverage(out);
    const mojiTier = hasStrongArtifact(out) && coverageOk ? 'high' : 'medium';
    applied.push({ mode: 'mojibake', tier: mojiTier });
    tier = lowest(tier, mojiTier);
    out = repaired;
  }

  if (unwrap && out.includes('\n')) {
    const r = unwrapText(out);
    if (r.joins > 0) {
      applied.push({ mode: 'unwrap', tier: r.tier });
      tier = lowest(tier, r.tier);
      out = r.text;
    }
  }

  return { text: out, applied, tier };
}
