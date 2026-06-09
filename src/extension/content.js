// Content module (ES module, dynamically imported by background/popup). Wires the tested
// DOM adapter (dom-normalize.js) to chrome messaging, the clipboard, the same-session
// observer, and the injected review panel. No detection/DOM-walking logic lives here.

import { createDomNormalizer } from './dom-normalize.js';
import { loadSettings } from './settings.js';
import { canonicalizePunctuation } from '../core/punct.js';
import { createCorrectionsStore } from './corrections-store.js';
import { keyFor, makeOverride, makeSuppress } from '../core/corrections.js';

const normalizer = createDomNormalizer({ window });
const corrections = createCorrectionsStore();
let observer = null;
let captureEnabled = true; // mirrors settings.rememberCorrections; updated per scan

const getSettings = loadSettings;

// Load stored corrections only when the feature is on; otherwise an empty map ⇒ no replay.
async function loadRecords(settings) {
  if (!settings.rememberCorrections) return {};
  try {
    return await corrections.loadRecords();
  } catch {
    return {};
  }
}

async function runScan({ apply, renderPanel = true }) {
  const settings = await getSettings();
  captureEnabled = settings.rememberCorrections;
  const records = await loadRecords(settings);
  const res = normalizer.scan({ apply, settings, records });
  if (captureEnabled && res.replayedKeys.length) corrections.bump(res.replayedKeys, Date.now());
  if (renderPanel) renderPreview(res.preview);
  if (apply) ensureObserver();
  return { applied: res.applied, preview: res.preview.length, total: res.total };
}

async function runSelection() {
  const settings = await getSettings();
  const records = await loadRecords(settings);
  const res = normalizer.normalizeSelection(
    window.getSelection(),
    { threshold: settings.threshold, minLength: settings.minLength },
    records,
  );
  if (res.copied) navigator.clipboard?.writeText(res.copied).catch(() => {});
  if (settings.rememberCorrections && res.correctionKey) corrections.bump([res.correctionKey], Date.now());
  return res;
}

async function runCopyCleaned() {
  const settings = await getSettings();
  const records = await loadRecords(settings);
  // Punctuation canonicalization is export-only (§5.4.5 item 4): applied to copied text,
  // never to the in-page DOM. Records make copied text honor stored suppress/override.
  const text = canonicalizePunctuation(normalizer.extractCleanedText(settings, records));
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

// Reflect a settings toggle immediately on an already-open page: if correction memory is
// turned off, drop the review panel so its (now stale) capture controls can't be used.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'sync' && changes.rememberCorrections) {
    captureEnabled = changes.rememberCorrections.newValue;
    if (!captureEnabled) dismissPreview();
  }
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

    // Apply a chosen text to the page: in place when single-node, else copy (link-spanning
    // can't mutate in place). Used by Apply and the override-capture actions.
    const applyToPage = (text) => {
      if (item.singleNode) normalizer.applyDecision(item.node, { proposed: text });
      else navigator.clipboard?.writeText(text).catch(() => {});
    };
    // Persist a record; returns the adapter result. A null record means it exceeded the
    // byte caps (makeOverride/makeSuppress returned null) — reported, not silently dropped.
    const persist = async (record) =>
      record ? corrections.saveRecord(keyFor(item.text), record) : { ok: false, error: 'too long to remember' };

    const btn = document.createElement('button');
    btn.textContent = item.singleNode ? 'Apply' : 'Copy fixed text';
    btn.addEventListener('click', () => {
      applyToPage(item.decision.proposed);
      if (!item.singleNode) btn.textContent = 'Copied';
      else row.remove();
    });
    row.append(orig, prop, tier, btn);

    if (captureEnabled) {
      // Capture controls: edit (override), pin the proposal (override), or suppress.
      const edit = document.createElement('input');
      edit.type = 'text';
      edit.value = item.decision.proposed;
      edit.setAttribute('aria-label', 'Edit the fix');

      const status = document.createElement('span');
      status.className = 'tier';
      status.setAttribute('role', 'status');

      // The current-page effect happens regardless of persistence (spec: "the in-page repair
      // still happens for this visit"). Persistence is best-effort: on success remove the row;
      // on failure (over cap / quota / memory turned off) keep the row and say so.
      const capture = async (record, applyText) => {
        if (applyText !== undefined) applyToPage(applyText);
        if (!captureEnabled) {
          status.textContent = 'Memory is off — not remembered';
          return;
        }
        const res = await persist(record);
        if (!res.ok) {
          status.textContent = `Applied, not remembered: ${res.error}`;
          return;
        }
        row.remove();
      };

      const save = document.createElement('button');
      save.textContent = 'Save fix';
      save.addEventListener('click', () => capture(makeOverride(item.text, edit.value, Date.now()), edit.value));

      const pin = document.createElement('button');
      pin.textContent = 'Always fix this';
      pin.addEventListener('click', () =>
        capture(makeOverride(item.text, item.decision.proposed, Date.now()), item.decision.proposed),
      );

      const ignore = document.createElement('button');
      ignore.textContent = 'Ignore — don’t repair again';
      // Suppress: segment is already shown un-repaired, so nothing to apply on success.
      ignore.addEventListener('click', () => capture(makeSuppress(item.text, Date.now()), undefined));

      const captureRow = document.createElement('div');
      captureRow.append(edit, save, pin, ignore, status);
      row.appendChild(captureRow);
    }

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
