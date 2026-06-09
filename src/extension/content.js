// Content module (ES module, dynamically imported by background/popup). Wires the tested
// DOM adapter (dom-normalize.js) to chrome messaging, the clipboard, the same-session
// observer, and the injected review panel. No detection/DOM-walking logic lives here.

import { createDomNormalizer } from './dom-normalize.js';
import { loadSettings } from './settings.js';
import { canonicalizePunctuation } from '../core/punct.js';

const normalizer = createDomNormalizer({ window });
let observer = null;

const getSettings = loadSettings;

async function runScan({ apply, renderPanel = true }) {
  const settings = await getSettings();
  const res = normalizer.scan({ apply, settings });
  if (renderPanel) renderPreview(res.preview);
  if (apply) ensureObserver();
  return { applied: res.applied, preview: res.preview.length, total: res.total };
}

async function runSelection() {
  const settings = await getSettings();
  const res = normalizer.normalizeSelection(window.getSelection(), {
    threshold: settings.threshold,
    minLength: settings.minLength,
  });
  if (res.copied) navigator.clipboard?.writeText(res.copied).catch(() => {});
  return res;
}

async function runCopyCleaned() {
  const settings = await getSettings();
  // Punctuation canonicalization is export-only (§5.4.5 item 4): applied to copied text,
  // never to the in-page DOM.
  const text = canonicalizePunctuation(normalizer.extractCleanedText(settings));
  await navigator.clipboard?.writeText(text);
  return { copied: text.length };
}

// Debounced same-session observer — attaches only after a user-initiated scan (§5.1).
// It disconnects while it applies (so our own edits can never re-trigger it) and does not
// rebuild the review panel on background mutations (which would reset it under the user).
function ensureObserver() {
  if (observer) return;
  let timer = null;
  const start = () => observer.observe(document.body, { childList: true, subtree: true });
  observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      observer.disconnect();
      try {
        await runScan({ apply: true, renderPanel: false });
      } finally {
        start();
      }
    }, 300);
  });
  start();
  window.addEventListener('pagehide', () => observer?.disconnect(), { once: true });
}

async function handle(message) {
  switch (message.type) {
    case 'scan':
      return { ok: true, ...(await runScan({ apply: false })) };
    case 'normalize-page':
      return { ok: true, ...(await runScan({ apply: true })) };
    case 'normalize-selection':
      return { ok: true, ...(await runSelection()) };
    case 'undo':
      return { ok: true, ...normalizer.undoAll() };
    case 'copy-cleaned':
      return { ok: true, ...(await runCopyCleaned()) };
    case 'capture-source':
      // Read-only snapshot of the page for the reader view; the trusted caller
      // (popup/background) persists it and opens the reader tab.
      return { ok: true, html: document.documentElement.outerHTML, url: location.href };
    default:
      return { ok: false, error: 'unknown command' };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handle(message).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // keep the message channel open for the async response
});

// --- Review panel (injected, shadow-DOM isolated; text set via textContent only) ---

let panelHost = null;

function dismissPreview() {
  panelHost?.remove();
  panelHost = null;
}

function renderPreview(items) {
  dismissPreview();
  if (!items.length) return;

  panelHost = document.createElement('div');
  panelHost.style.cssText = 'all: initial; position: fixed; top: 16px; right: 16px; z-index: 2147483647;';
  const root = panelHost.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .panel { width: 340px; max-height: 70vh; overflow:auto; font: 13px/1.4 system-ui, sans-serif;
      background:#fff; color:#222; border:1px solid #ccc; border-radius:10px; box-shadow:0 6px 24px rgba(0,0,0,.2); }
    header { display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border-bottom:1px solid #eee; }
    h2 { font-size:13px; margin:0; }
    .item { padding:10px 12px; border-bottom:1px solid #f0f0f0; }
    .orig { color:#999; text-decoration:line-through; word-break:break-word; }
    .prop { font-weight:600; word-break:break-word; margin:2px 0 6px; }
    .tier { font-size:11px; color:#666; margin-bottom:6px; }
    button { font:12px system-ui; padding:4px 8px; border:1px solid #ccc; border-radius:6px; background:#f7f7f7; cursor:pointer; }
    button.primary { background:#1a73e8; color:#fff; border-color:#1a73e8; }
    footer { display:flex; gap:6px; padding:10px 12px; position:sticky; bottom:0; background:#fff; border-top:1px solid #eee; }`;
  root.appendChild(style);

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'Reversed text review');

  const header = document.createElement('header');
  const h2 = document.createElement('h2');
  h2.textContent = `Review ${items.length} segment${items.length === 1 ? '' : 's'}`;
  const close = document.createElement('button');
  close.textContent = 'Close';
  close.addEventListener('click', dismissPreview);
  header.append(h2, close);
  panel.appendChild(header);

  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'item';

    const orig = document.createElement('div');
    orig.className = 'orig';
    orig.textContent = item.text;

    const prop = document.createElement('div');
    prop.className = 'prop';
    prop.textContent = item.decision.proposed;

    const tier = document.createElement('div');
    tier.className = 'tier';
    tier.textContent = item.singleNode
      ? `${item.decision.tier} confidence · ${item.decision.mode} reverse`
      : `${item.decision.tier} confidence · spans links/inline — copy only`;

    const btn = document.createElement('button');
    if (item.singleNode) {
      // In-place-safe: rewrite the single text node directly.
      btn.textContent = 'Apply';
      btn.addEventListener('click', () => {
        normalizer.applyDecision(item.node, item.decision);
        row.remove();
      });
    } else {
      // Multi-node/linked: never mutate in place in V1 — offer the corrected text.
      btn.textContent = 'Copy fixed text';
      btn.addEventListener('click', () => {
        navigator.clipboard?.writeText(item.decision.proposed).catch(() => {});
        btn.textContent = 'Copied';
      });
    }

    row.append(orig, prop, tier, btn);
    panel.appendChild(row);
  }

  const footer = document.createElement('footer');
  const applyAll = document.createElement('button');
  applyAll.className = 'primary';
  applyAll.textContent = 'Apply all in-place';
  applyAll.addEventListener('click', () => {
    items.filter((i) => i.singleNode).forEach((i) => normalizer.applyDecision(i.node, i.decision));
    dismissPreview();
  });
  footer.appendChild(applyAll);
  panel.appendChild(footer);

  root.appendChild(panel);
  document.documentElement.appendChild(panelHost);
}
