// Readability-style article extraction (requirements §5.8 V1.5 upgrades).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { extractArticle, normalizeByline } from '../src/extension/extract-article.js';

function doc(html) {
  return new JSDOM(`<!doctype html><html><body>${html}</body></html>`).window.document;
}

const NEWS = `
  <header><nav>Home World Politics Sports <a href="/sub">Subscribe</a></nav></header>
  <article>
    <h1>Turtle light fight burns bright</h1>
    <p class="byline">By Jane Doe | Updated 3:42 p.m. ET, June 8, 2025</p>
    <p>Wildlife experts say the nighttime glow disrupts sea turtles during nesting season, a problem that has persisted for years along the coast.</p>
    <figure><img src="x.jpg"><figcaption>High mast lights at Exit 42. (AP Photo/Jane Smith)</figcaption></figure>
    <p>County officials said no fix is imminent, and proposals remain under discussion among the various state and local agencies involved.</p>
    <aside class="related">Related stories: Five more articles you should read right now today</aside>
    <p>Advertisement</p>
  </article>
  <footer>Copyright 2025. All rights reserved. Subscribe to our newsletter.</footer>
`;

test('extractArticle selects the article body and drops nav/footer/ads/related', () => {
  const article = extractArticle(doc(NEWS));
  const bodyText = article.blocks.map((b) => b.text).join('\n');
  assert.ok(bodyText.includes('Wildlife experts say the nighttime glow'));
  assert.ok(bodyText.includes('County officials said no fix'));
  assert.ok(!bodyText.includes('Home World Politics'), 'nav leaked');
  assert.ok(!bodyText.includes('Related stories'), 'related-stories boilerplate leaked');
  assert.ok(!/Advertisement/.test(bodyText), 'ad marker leaked');
  assert.ok(!bodyText.includes('All rights reserved'), 'footer leaked');
});

test('extractArticle keeps the title and both real body paragraphs', () => {
  const article = extractArticle(doc(NEWS));
  assert.equal(article.title, 'Turtle light fight burns bright');
  const paras = article.blocks.filter((b) => b.type === 'paragraph');
  assert.equal(paras.length, 2);
});

test('extractArticle captures the caption and can strip the photo credit', () => {
  const withCredit = extractArticle(doc(NEWS), { stripCredits: false });
  const cap = withCredit.blocks.find((b) => b.type === 'caption');
  assert.ok(cap.text.includes('(AP Photo/Jane Smith)'));

  const stripped = extractArticle(doc(NEWS), { stripCredits: true });
  const cap2 = stripped.blocks.find((b) => b.type === 'caption');
  assert.equal(cap2.text, 'High mast lights at Exit 42.');
});

test('normalizeByline splits author from updated date', () => {
  const r = normalizeByline('By Jane Doe | Updated 3:42 p.m. ET, June 8, 2025');
  assert.equal(r.author, 'Jane Doe');
  assert.ok(/June 8, 2025/.test(r.date));
});

test('extractArticle drops a pull-quote that repeats a body sentence', () => {
  const html = `
    <article>
      <h1>T</h1>
      <p>The county will not put their heads in the sand on this important issue, she said firmly.</p>
      <blockquote class="pullquote">The county will not put their heads in the sand on this important issue, she said firmly.</blockquote>
      <p>She added that conservationists would continue working with local officials going forward.</p>
    </article>`;
  const article = extractArticle(doc(html), { dedupePullQuotes: true });
  const matches = article.blocks.filter((b) => b.text.includes('heads in the sand'));
  assert.equal(matches.length, 1);
});

test('extractArticle does not double-count a paragraph nested in a list item or blockquote', () => {
  const html = `
    <article>
      <h1>T</h1>
      <ul><li><p>This list item wraps a paragraph element with real readable content here.</p></li></ul>
      <blockquote><p>This blockquote wraps a paragraph element with its own distinct readable content.</p></blockquote>
      <p>A plain trailing paragraph that also has enough words to be counted as body text.</p>
    </article>`;
  const article = extractArticle(doc(html));
  const texts = article.blocks.map((b) => b.text);
  const listText = texts.filter((t) => t.includes('list item wraps a paragraph'));
  const quoteText = texts.filter((t) => t.includes('blockquote wraps a paragraph'));
  assert.equal(listText.length, 1, 'nested <li><p> emitted once');
  assert.equal(quoteText.length, 1, 'nested <blockquote><p> emitted once');
});

test('extractArticle falls back to whole-body scoring when no <article> exists', () => {
  const html = `
    <div class="content">
      <h1>Headline Goes Here</h1>
      <p>This is a substantial paragraph of real article content with enough words to score as the main body region of the page.</p>
      <p>A second substantial paragraph continues the story with further detail and additional context for the reader to follow.</p>
    </div>
    <div class="sidebar"><a href="/1">link</a> <a href="/2">link</a> <a href="/3">link</a></div>`;
  const article = extractArticle(doc(html));
  assert.equal(article.title, 'Headline Goes Here');
  assert.ok(article.blocks.some((b) => b.text.includes('substantial paragraph of real')));
});
