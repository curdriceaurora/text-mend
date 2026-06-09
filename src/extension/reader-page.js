// Reader page controller. Reads captured source HTML from session storage (written by the
// content script before opening this page), builds the repaired article, and renders it.
// All text is set via textContent — page-derived strings never reach innerHTML.

import { buildReaderArticle } from './reader.js';
import { toPlainText, toMarkdown } from '../core/extract.js';
import { canonicalizePunctuation } from '../core/punct.js';

const params = new URLSearchParams(location.search);
const key = params.get('key');

const themes = ['light', 'sepia', 'dark'];
let themeIdx = 0;
let fontSize = 19;
let showMarks = true;
let article = null;

function setText(el, text) {
  el.textContent = text;
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
    el.appendChild(mark);
  } else {
    setText(el, block.text);
  }
  return el;
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
  const doc = new DOMParser().parseFromString(html, 'text/html');
  article = buildReaderArticle(doc);
  render();
}

init();
