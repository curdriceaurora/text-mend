// Reader page controller. Reads captured source HTML from session storage (written by the
// content script before opening this page), builds the repaired article, and renders it.
// All text is set via textContent — page-derived strings never reach innerHTML.

import { buildReaderArticle } from './reader.js';
import { toPlainText, toMarkdown } from '../core/extract.js';
import { canonicalizePunctuation } from '../core/punct.js';
import { createCorrectionsStore } from './corrections-store.js';
import { keyFor, makeOverride, makeSuppress } from '../core/corrections.js';
import { loadSettings } from './settings.js';

const params = new URLSearchParams(location.search);
const key = params.get('key');

const corrections = createCorrectionsStore();
const themes = ['light', 'sepia', 'dark'];
let themeIdx = 0;
let fontSize = 19;
let showMarks = true;
let captureEnabled = true;
let article = null;

function setText(el, text) {
  el.textContent = text;
}

function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

function blockEl(block) {
  const tag = block.type === 'heading' ? `h${Math.min(Math.max(block.level, 2), 3)}`
    : block.type === 'caption' ? 'figcaption'
    : 'p';
  const el = document.createElement(tag);
  if (block.changed && showMarks) {
    const mark = document.createElement('mark');
    mark.className = 'repaired';
    setText(mark, block.text);
    mark.title = `Original: ${block.original}\nRepaired via: ${block.modes.join(' → ')}`;
    mark.setAttribute('aria-label', `Repaired text. Original: ${block.original}`);
    if (captureEnabled) {
      mark.style.cursor = 'pointer';
      mark.addEventListener('click', () => openEditor(block, el));
    }
    el.appendChild(mark);
  } else if (block.obfuscated) {
    // Do NOT present obfuscated/scrambled source as repaired — show it as-is, marked.
    const span = document.createElement('span');
    span.className = 'obfuscated';
    setText(span, block.text);
    span.title = 'Source appears obfuscated or paywalled — shown as-is, not repaired.';
    span.setAttribute('aria-label', 'Source appears obfuscated or paywalled; shown unrepaired.');
    el.appendChild(span);
  } else {
    setText(el, block.text);
  }
  return el;
}

// Inline correction editor for a repaired block (spec §7). Immediate current-page effect:
// Save edit → block shows the new text; Don't repair → reverts to original now. Persists.
function openEditor(block, blockEl) {
  blockEl.replaceChildren();
  const input = document.createElement('input');
  input.type = 'text';
  input.value = block.text;
  input.setAttribute('aria-label', 'Edit the repaired text');
  input.style.cssText = 'width:100%;font:inherit;';

  // The current-page effect always happens (spec: "the in-page repair still happens for this
  // visit"); persistence is best-effort and reported via the toolbar status, which survives
  // the re-render (render() only rebuilds #article, not the toolbar).
  async function commit(record, mutate) {
    mutate();
    render();
    if (!captureEnabled) {
      setStatus('Memory is off — not remembered');
      return;
    }
    const res = record ? await corrections.saveRecord(keyFor(block.original), record) : { ok: false, error: 'too long to remember' };
    setStatus(res.ok ? '' : `Not remembered: ${res.error}`);
  }

  const save = document.createElement('button');
  save.textContent = 'Save edit';
  save.addEventListener('click', () =>
    commit(makeOverride(block.original, input.value, Date.now()), () => {
      block.text = input.value;
      block.changed = true;
      block.modes = ['override'];
    }),
  );

  const suppress = document.createElement('button');
  suppress.textContent = "Don't repair this";
  suppress.addEventListener('click', () =>
    commit(makeSuppress(block.original, Date.now()), () => {
      block.text = block.original; // revert to original now
      block.changed = false;
      block.modes = [];
    }),
  );

  const cancel = document.createElement('button');
  cancel.textContent = 'Dismiss';
  cancel.addEventListener('click', render);

  blockEl.append(input, save, suppress, cancel);
  input.focus();
}

function render() {
  document.documentElement.dataset.theme = themes[themeIdx];
  document.documentElement.style.setProperty('--size', `${fontSize}px`);

  const main = document.getElementById('article');
  main.replaceChildren();

  if (!article || (!article.title && article.blocks.length === 0)) {
    const p = document.createElement('p');
    p.id = 'empty';
    setText(p, 'No readable article content was found on this page.');
    main.appendChild(p);
    return;
  }

  if (article.paywalled || article.obfuscated) {
    const banner = document.createElement('div');
    banner.className = 'notice';
    banner.setAttribute('role', 'note');
    setText(
      banner,
      article.paywalled
        ? 'This page appears to be paywalled or locked. The visible text is shown as-is — it may be incomplete and was not repaired.'
        : 'Part of this page appears obfuscated or scrambled. Affected text is shown as-is, not repaired.',
    );
    main.appendChild(banner);
  }

  if (article.title) {
    const h1 = document.createElement('h1');
    setText(h1, article.title);
    main.appendChild(h1);
  }
  if (article.byline || article.date) {
    const by = document.createElement('p');
    by.className = 'byline';
    setText(by, [article.byline && `By ${article.byline}`, article.date].filter(Boolean).join(' · '));
    main.appendChild(by);
  }
  for (const block of article.blocks) main.appendChild(blockEl(block));

  setText(document.getElementById('readtime'), `${article.readingTimeMin} min read`);
  document.getElementById('marks').textContent = showMarks ? 'Hide repair marks' : 'Show repair marks';
  document.getElementById('marks').setAttribute('aria-pressed', String(showMarks));
}

// Export uses the repaired text; punctuation canonicalization is applied here (export-only).
function exportArticle(asMarkdown) {
  const payload = {
    title: article.title,
    byline: article.byline,
    blocks: article.blocks.map((b) => ({ type: b.type, level: b.level, text: b.text })),
  };
  const text = asMarkdown
    ? toMarkdown(payload, { removeDuplicates: true })
    : toPlainText(payload, { removeDuplicates: true });
  // Punctuation canonicalization is export-only (§5.4.5 item 4) — applied here, never to
  // the rendered reader surface.
  return canonicalizePunctuation(text);
}

function wireToolbar() {
  document.getElementById('theme').addEventListener('click', () => {
    themeIdx = (themeIdx + 1) % themes.length;
    render();
  });
  document.getElementById('larger').addEventListener('click', () => {
    fontSize = Math.min(28, fontSize + 1);
    render();
  });
  document.getElementById('smaller').addEventListener('click', () => {
    fontSize = Math.max(14, fontSize - 1);
    render();
  });
  document.getElementById('marks').addEventListener('click', () => {
    showMarks = !showMarks;
    render();
  });
  document.getElementById('copy').addEventListener('click', () =>
    navigator.clipboard?.writeText(exportArticle(false)),
  );
  document.getElementById('copymd').addEventListener('click', () =>
    navigator.clipboard?.writeText(exportArticle(true)),
  );
}

async function init() {
  wireToolbar();
  let html = '';
  try {
    const stored = await chrome.storage.session.get(key);
    html = stored[key]?.html ?? '';
    chrome.storage.session.remove(key);
  } catch {
    html = '';
  }
  const settings = await loadSettings();
  captureEnabled = settings.rememberCorrections;
  let records = {};
  if (captureEnabled) {
    try {
      records = await corrections.loadRecords();
    } catch {
      records = {};
    }
  }
  const doc = new DOMParser().parseFromString(html, 'text/html');
  article = buildReaderArticle(doc, { records });
  if (captureEnabled && article.replayedKeys.length) corrections.bump(article.replayedKeys, Date.now());
  render();
}

// Reflect a settings toggle immediately: if memory is turned off while the reader is open,
// re-render so repaired marks stop being editable capture points.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area === 'sync' && changes.rememberCorrections) {
    captureEnabled = changes.rememberCorrections.newValue;
    render();
  }
});

init();
