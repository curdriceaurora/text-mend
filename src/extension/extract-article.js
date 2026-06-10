// Readability-style article extraction (requirements §5.8 V1.5 upgrades).
// chrome-free: takes a `document`, returns { title, byline, date, blocks: [{type, text, level}] }.
// Container scoring beats V1's flat page-wide tag query (which pulls nav/ads and misses
// <article>-scoped content) — it's the biggest extraction-quality lever for a reader product.

const BLOCK_SELECTOR = 'p,li,h1,h2,h3,h4,h5,h6,figcaption,blockquote';
const NEGATIVE_RE = /(^|[\s_-])(nav|menu|footer|header|sidebar|share|related|promo|ad|advert|advertisement|newsletter|subscribe|comment|cookie|social|recirc|outbrain|taboola)([\s_-]|$)/i;
const BOILERPLATE_RE = /^(advertisement|related stories?:?|read more:?|sign up|subscribe|share this|most read|recommended)\b/i;
const FOOTER_RE = /(all rights reserved|©|copyright \d{4}|subscribe to our newsletter)/i;
const CREDIT_RE = /\s*\((?:AP Photo|Photo|Getty|Reuters|AFP|Image)[^)]*\)\s*$|\s*\/\s*(Getty Images|Reuters|AFP|AP)\s*$/i;

// Paywall / locked-content signals (hotfix point 2). Includes generic markers plus
// real platform classes: Gannett/USA Today (gnt_pr, roadblock), WSJ (snippet-promotion,
// wsj-snippet), Piano/Arc — AJC (tp-modal, tp-backdrop), NYT (gateway-content).
const PAYWALL_CLASS_RE = /(^|[\s_-])(is-?paywalled|paywall|paygate|story-paygate_placeholder|metered|premium-locked|subscriber-only|locked-content|regwall|roadblock|gnt[_-]pr|snippet-promotion|wsj-snippet|tp-modal|tp-backdrop|gateway-content)([\s_-]|$)/i;
const BLUR_CLASS_RE = /(^|[\s_-])(blur|blurred|paywall-?blur|gradient-?blur|fade-?gradient|content-?fade|fade-?out)([\s_-]|$)/i;

/**
 * Rendered text of an element: prefer `innerText` (what's actually visible — respects
 * display:none / visibility, unlike textContent which includes hidden decoy text often used
 * on paywalled/obfuscated pages). Falls back to textContent when innerText is unavailable
 * (e.g. jsdom) or blank.
 */
export function renderedText(el) {
  const it = el.innerText;
  if (typeof it === 'string' && it.trim().length > 0) return it;
  return el.textContent || '';
}

function textOf(el) {
  return renderedText(el).replace(/\s+/g, ' ').trim();
}

function classId(el) {
  return `${el.className || ''} ${el.id || ''}`;
}

/** Detect paywall / locked-content placeholders (hotfix point 2). */
export function detectPaywall(doc) {
  // 1. JSON-LD isAccessibleForFree: false
  for (const s of doc.querySelectorAll('script[type="application/ld+json"]')) {
    if (/"isAccessibleForFree"\s*:\s*(false|"false")/i.test(s.textContent || '')) {
      return { paywalled: true, reason: 'isAccessibleForFree' };
    }
  }
  // 2. Paywall placeholder classes/ids
  for (const el of doc.querySelectorAll('[class],[id]')) {
    if (PAYWALL_CLASS_RE.test(classId(el))) return { paywalled: true, reason: 'placeholder' };
  }
  // 3. Blur / fade-gradient classes (visual paywall teaser)
  for (const el of doc.querySelectorAll('[class]')) {
    if (BLUR_CLASS_RE.test(el.className || '')) return { paywalled: true, reason: 'blur' };
  }
  return { paywalled: false, reason: null };
}

function linkDensity(el) {
  const total = textOf(el).length || 1;
  let linkLen = 0;
  el.querySelectorAll('a').forEach((a) => (linkLen += textOf(a).length));
  return linkLen / total;
}

// Score a candidate container by how article-like it is.
function scoreContainer(el) {
  const paras = el.querySelectorAll('p');
  if (paras.length === 0) return -1;
  let score = paras.length * 5;
  score += Math.min(textOf(el).length / 100, 50); // text mass, capped
  score -= linkDensity(el) * 50; // nav/lists are link-dense
  const cls = `${el.className} ${el.id}`;
  if (NEGATIVE_RE.test(cls)) score -= 50;
  if (el.tagName === 'ARTICLE') score += 25;
  if (/(^|[\s_-])(article|content|story|post|body|main)([\s_-]|$)/i.test(cls)) score += 15;
  return score;
}

function pickContainer(doc) {
  const candidates = [
    ...doc.querySelectorAll('article, main, [role="main"], div, section'),
  ];
  let best = doc.body;
  let bestScore = scoreContainer(doc.body);
  for (const el of candidates) {
    const s = scoreContainer(el);
    if (s > bestScore) {
      bestScore = s;
      best = el;
    }
  }
  return best;
}

/** Parse "By Jane Doe | Updated 3:42 p.m. ET, June 8, 2025" into { author, date }. */
export function normalizeByline(raw) {
  const text = (raw || '').replace(/\s+/g, ' ').trim();
  const dateMatch = text.match(/((?:updated|published)\b.*$)/i);
  const date = dateMatch ? dateMatch[1].replace(/^(updated|published)\s*/i, '').trim() : '';
  let author = (dateMatch ? text.slice(0, dateMatch.index) : text)
    .replace(/^by\s+/i, '')
    .replace(/[|·,\s]+$/, '')
    .trim();
  return { author, date };
}

function classify(el) {
  const tag = el.tagName;
  if (/^H[1-6]$/.test(tag)) return { type: 'heading', level: Number(tag[1]) };
  if (tag === 'FIGCAPTION') return { type: 'caption', level: 0 };
  if (tag === 'BLOCKQUOTE') return { type: 'quote', level: 0 };
  return { type: 'paragraph', level: 0 };
}

/**
 * @param {Document} doc
 * @param {{stripCredits?:boolean, dedupePullQuotes?:boolean}} [opts]
 */
export function extractArticle(doc, { stripCredits = true, dedupePullQuotes = true } = {}) {
  const container = pickContainer(doc);
  const titleEl = container.querySelector('h1') || doc.querySelector('h1');
  const title = titleEl ? textOf(titleEl) : '';

  // Byline: a node mentioning "By ..." near the top.
  let byline = '';
  let date = '';
  const bylineEl = [...container.querySelectorAll('p,span,div,address')].find((el) =>
    /^by\s+\w/i.test(textOf(el)) && textOf(el).length < 120,
  );
  if (bylineEl) {
    const parsed = normalizeByline(textOf(bylineEl));
    byline = parsed.author;
    date = parsed.date;
  }

  const blocks = [];
  const seen = new Set();
  for (const el of container.querySelectorAll(BLOCK_SELECTOR)) {
    if (el.querySelector(BLOCK_SELECTOR)) continue; // leaf blocks only — skip any wrapper (li>p, blockquote>p)
    if (NEGATIVE_RE.test(`${el.className} ${el.id}`)) continue;
    if (el.closest('nav,footer,header,aside')) continue;
    let text = textOf(el);
    if (!text) continue;
    if (el === titleEl || el === bylineEl) continue;
    if (BOILERPLATE_RE.test(text) || FOOTER_RE.test(text)) continue;

    const meta = classify(el);
    if (meta.type === 'caption' && stripCredits) text = text.replace(CREDIT_RE, '').trim();
    if ((meta.type === 'quote' || /pullquote/i.test(el.className)) && dedupePullQuotes) {
      if (seen.has(text)) continue; // pull quote repeating a body sentence
    }
    seen.add(text);
    blocks.push({ type: meta.type === 'quote' ? 'paragraph' : meta.type, level: meta.level, text });
  }

  return { title, byline, date, blocks, paywalled: detectPaywall(doc).paywalled };
}
