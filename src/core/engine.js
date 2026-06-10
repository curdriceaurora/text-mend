// Normalization policy engine (requirements §5.19 flow, §5.5 in-place-safety routing).
// Pure: operates on "units" describing text, not on the DOM. The content script builds
// units from text nodes and consumes the returned decisions. This keeps the routing
// policy fully unit-testable and the DOM layer a thin adapter.

import { detectSegment } from './detect.js';

/**
 * @param {{id:*, text:string, singleNode:boolean}[]} units
 * @param {{threshold?:number, minLength?:number, resolve?:Function}} [opts]
 *   opts.resolve(text, opts) -> decision; defaults to detectSegment. Injecting a
 *   corrections-aware resolver lets stored overrides/suppresses replay through the scan path.
 * @returns {{id:*, action:'apply'|'preview'|'skip', mode, proposed, confidence, tier, source?, correctionKey?}[]}
 */
export function planNormalization(units, opts = {}) {
  const resolve = opts.resolve || ((text) => detectSegment(text, opts));
  return units.map((unit) => {
    const det = resolve(unit.text, opts);
    let action;
    if (det.mode === 'none' || det.tier === 'low') {
      action = 'skip';
    } else if (det.tier === 'high' && unit.singleNode) {
      // Safe to mutate in place only when the segment is a single text node (§5.5).
      action = 'apply';
    } else {
      // Medium confidence, or high confidence spanning multiple nodes / inline elements:
      // surface in preview rather than silently rewriting the DOM.
      action = 'preview';
    }
    return {
      id: unit.id,
      action,
      mode: det.mode,
      proposed: det.proposed,
      confidence: det.confidence,
      tier: det.tier,
      // Carry correction provenance onto EVERY decision, including skip (a suppress hit) —
      // the surface needs it to bump lastUsedAt even when nothing visibly changed.
      source: det.source,
      correctionKey: det.correctionKey,
      // Obfuscated/paywalled source — skipped, but the surface marks it so the user knows.
      obfuscated: det.obfuscated,
      reason: det.reason,
    };
  });
}
