// Normalization policy engine (requirements §5.19 flow, §5.5 in-place-safety routing).
// Pure: operates on "units" describing text, not on the DOM. The content script builds
// units from text nodes and consumes the returned decisions. This keeps the routing
// policy fully unit-testable and the DOM layer a thin adapter.

import { detectSegment } from './detect.js';

/**
 * @param {{id:*, text:string, singleNode:boolean}[]} units
 * @param {{threshold?:number, minLength?:number}} [opts]
 * @returns {{id:*, action:'apply'|'preview'|'skip', mode:string, proposed:string, confidence:number, tier:string}[]}
 */
export function planNormalization(units, opts = {}) {
  return units.map((unit) => {
    const det = detectSegment(unit.text, opts);
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
    };
  });
}
