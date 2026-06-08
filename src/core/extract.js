// Cleaned-article extraction / export (requirements §5.8).
// An article is { title?, byline?, blocks: [{ type, text, level? }] }
// where type is 'paragraph' | 'heading' | 'caption'.

import { dedupeParagraphs } from './dedupe.js';

function maybeDedupe(blocks, removeDuplicates) {
  if (!removeDuplicates) return blocks;
  const kept = dedupeParagraphs(blocks.map((b) => b.text));
  const keptSet = new Set(kept);
  // Keep first occurrence of each surviving text, in order.
  const seen = new Set();
  return blocks.filter((b) => {
    if (!keptSet.has(b.text)) return false;
    if (seen.has(b.text)) return false;
    seen.add(b.text);
    return true;
  });
}

/** Render the article as Markdown. */
export function toMarkdown(article, { removeDuplicates = false } = {}) {
  const segments = [];
  if (article.title) segments.push(`# ${article.title}`);
  if (article.byline) segments.push(`By ${article.byline}`);
  for (const block of maybeDedupe(article.blocks ?? [], removeDuplicates)) {
    if (block.type === 'heading') {
      segments.push(`${'#'.repeat(block.level ?? 2)} ${block.text}`);
    } else if (block.type === 'caption') {
      segments.push(`*${block.text}*`);
    } else {
      segments.push(block.text);
    }
  }
  return segments.join('\n\n');
}

/** Render the article as plain text, preserving logical order. */
export function toPlainText(article, { removeDuplicates = false } = {}) {
  const segments = [];
  if (article.title) segments.push(article.title);
  if (article.byline) segments.push(`By ${article.byline}`);
  for (const block of maybeDedupe(article.blocks ?? [], removeDuplicates)) {
    segments.push(block.text);
  }
  return segments.join('\n\n');
}
