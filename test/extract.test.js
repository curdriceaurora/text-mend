import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toMarkdown, toPlainText } from '../src/core/extract.js';

const article = {
  title: 'Article Title',
  byline: 'Author Name',
  blocks: [
    { type: 'paragraph', text: 'Body paragraph one.' },
    { type: 'heading', level: 2, text: 'Section Heading' },
    { type: 'paragraph', text: 'More body text.' },
    { type: 'caption', text: 'Image caption: a photo.' },
  ],
};

test('toMarkdown renders title, byline, headings, body, and captions', () => {
  const md = toMarkdown(article);
  assert.equal(
    md,
    [
      '# Article Title',
      '',
      'By Author Name',
      '',
      'Body paragraph one.',
      '',
      '## Section Heading',
      '',
      'More body text.',
      '',
      '*Image caption: a photo.*',
    ].join('\n'),
  );
});

test('toPlainText preserves logical order without markdown markers', () => {
  const txt = toPlainText(article);
  assert.equal(
    txt,
    [
      'Article Title',
      'By Author Name',
      'Body paragraph one.',
      'Section Heading',
      'More body text.',
      'Image caption: a photo.',
    ].join('\n\n'),
  );
});

test('toMarkdown deduplicates captions when asked', () => {
  const withDupes = {
    title: 'T',
    blocks: [
      { type: 'caption', text: 'Same caption' },
      { type: 'caption', text: 'Same caption' },
    ],
  };
  const md = toMarkdown(withDupes, { removeDuplicates: true });
  assert.equal(md, ['# T', '', '*Same caption*'].join('\n'));
});
