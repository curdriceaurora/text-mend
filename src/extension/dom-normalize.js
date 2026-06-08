// DOM adapter, decoupled from chrome.* and navigator.* so it can be tested under jsdom.
// All decisions come from the tested core (engine/detect); this layer only reads/writes
// the DOM. content.js wraps this with chrome messaging, the review panel, and clipboard.

import { planNormalization } from '../core/engine.js';
import { detectSegment } from '../core/detect.js';
import { toPlainText } from '../core/extract.js';
import { SETTINGS_DEFAULTS } from './settings.js';

const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'CODE', 'PRE']);
// Block-level containers whose text is treated as one segment (§5.19 step 3).
const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6,figcaption,blockquote,dd,dt,td,caption';
const EXCLUDE_DESCENDANT = 'script,style,code,pre,textarea';

export { SETTINGS_DEFAULTS };

export function createDomNormalizer({ window }) {
  const doc = window.document;
  const { NodeFilter, Node } = window;
  const undoStack = []; // [{ node, original }]

  function isHidden(el) {
    if (!el) return true;
    if (el.hidden) return true;
    const style = window.getComputedStyle(el);
    if (!style) return false;
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    // RTL / bidi: visual order differs from logical order — skip (§5.3.8).
    if (style.direction === 'rtl' || (el.dir && el.dir.toLowerCase() === 'rtl')) return true;
    return false;
  }

  function isEditable(el) {
    return !!el && (el.isContentEditable || !!el.closest('input,textarea,[contenteditable=""],[contenteditable=true]'));
  }

  function ancestorExcluded(el) {
    for (let p = el; p; p = p.parentElement) {
      if (SKIP_TAGS.has(p.tagName)) return true;
      if (isEditable(p) || isHidden(p)) return true;
    }
    return false;
  }

  // One unit per "leaf" block (a block that contains no nested block). The block's full
  // textContent is the segment; it is safe to mutate in place only when the block holds a
  // single text node (no inline elements/links to scramble — §5.5).
  function collectUnits() {
    const units = [];
    let id = 0;
    for (const el of doc.body.querySelectorAll(BLOCK_SELECTOR)) {
      if (el.querySelector(BLOCK_SELECTOR)) continue; // not a leaf block
      if (el.querySelector(EXCLUDE_DESCENDANT)) continue; // contains code/etc.
      if (ancestorExcluded(el)) continue;
      const text = el.textContent;
      if (!text || !text.trim()) continue;
      const singleNode = el.childNodes.length === 1 && el.firstChild.nodeType === Node.TEXT_NODE;
      units.push({
        id: id++,
        // node is the text node we can safely rewrite, or the block element for preview-only.
        node: singleNode ? el.firstChild : el,
        text,
        singleNode,
      });
    }
    return units;
  }

  function applyDecision(node, decision) {
    undoStack.push({ node, original: node.nodeValue });
    node.nodeValue = decision.proposed;
  }

  function scan({ apply = true, settings: override } = {}) {
    const settings = { ...SETTINGS_DEFAULTS, ...override };
    const units = collectUnits().slice(0, settings.maxNodes); // §5.15 scan-size guardrail
    const plan = planNormalization(units, {
      threshold: settings.threshold,
      minLength: settings.minLength,
    });
    const doApply = apply && settings.autoNormalize;
    const preview = [];
    let applied = 0;
    plan.forEach((decision, i) => {
      if (decision.action === 'skip') return;
      const unit = units[i];
      if (decision.action === 'apply' && unit.singleNode && doApply) {
        applyDecision(unit.node, decision);
        applied++;
      } else {
        // Preview when: medium confidence, a multi-node/linked block (never auto-mutated),
        // or a single-node apply suppressed because autoNormalize is off. singleNode tells
        // the panel whether "Apply" can rewrite in place or should fall back to copy.
        preview.push({ node: unit.node, text: unit.text, singleNode: unit.singleNode, decision });
      }
    });
    return { applied, preview, total: units.length };
  }

  function normalizeSelection(selection, settings) {
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      return { applied: 0, preview: 0, total: 0 };
    }
    const text = selection.toString();
    const det = detectSegment(text, settings);
    if (det.mode === 'none') return { applied: 0, preview: 0, total: 1 };
    const range = selection.getRangeAt(0);
    if (range.startContainer === range.endContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
      const node = range.startContainer;
      undoStack.push({ node, original: node.nodeValue });
      node.nodeValue =
        node.nodeValue.slice(0, range.startOffset) + det.proposed + node.nodeValue.slice(range.endOffset);
      return { applied: 1, preview: 0, total: 1 };
    }
    // Cross-node selection: hand back text for the caller to copy, don't mutate.
    return { applied: 0, preview: 1, total: 1, copied: det.proposed };
  }

  function undoAll() {
    const count = undoStack.length;
    while (undoStack.length) {
      const { node, original } = undoStack.pop();
      if (node.isConnected) node.nodeValue = original;
    }
    return { restored: count };
  }

  function extractCleanedText(override) {
    const settings = { ...SETTINGS_DEFAULTS, ...override };
    const blocks = [];
    doc.body.querySelectorAll('h1,h2,h3,p,figcaption,li').forEach((el) => {
      const raw = el.textContent.trim();
      if (!raw) return;
      const det = detectSegment(raw, { threshold: settings.threshold, minLength: settings.minLength });
      const text = det.mode === 'none' ? raw : det.proposed;
      const type = /^H[1-3]$/.test(el.tagName)
        ? 'heading'
        : el.tagName === 'FIGCAPTION'
          ? 'caption'
          : 'paragraph';
      blocks.push({ type, level: el.tagName === 'H2' ? 2 : 3, text });
    });
    return toPlainText({ blocks }, { removeDuplicates: settings.dedupeOnCopy });
  }

  return { collectUnits, applyDecision, scan, normalizeSelection, undoAll, extractCleanedText };
}
