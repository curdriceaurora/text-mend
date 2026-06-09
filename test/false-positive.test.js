// §6.6 measurable false-positive bar: normal English article sentences must NOT be
// flagged as reversed. Bar: at most 1 false positive across the corpus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectSegment } from '../src/core/detect.js';

const FP_BAR = 1;

const corpusPath = fileURLToPath(new URL('../fixtures/normal-corpus.txt', import.meta.url));
const sentences = readFileSync(corpusPath, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);

test('normal article sentences are not normalized (false-positive bar)', () => {
  const offenders = [];
  for (const sentence of sentences) {
    const r = detectSegment(sentence);
    if (r.mode !== 'none') offenders.push(`"${sentence}" -> ${r.mode}@${r.confidence.toFixed(2)}`);
  }
  assert.ok(
    offenders.length <= FP_BAR,
    `false positives ${offenders.length}/${sentences.length} (bar ${FP_BAR}):\n${offenders.join('\n')}`,
  );
});

test('V1.5 candidates make ZERO changes on the clean corpus (§8.5.7 gate)', () => {
  const offenders = [];
  for (const sentence of sentences) {
    const r = detectSegment(sentence, { unwrap: true });
    if (r.applied.some((m) => ['strip', 'mojibake', 'unwrap'].includes(m))) {
      offenders.push(`"${sentence}" -> ${r.applied.join('+')}`);
    }
  }
  assert.equal(offenders.length, 0, `clean text altered by pre-repairs:\n${offenders.join('\n')}`);
});
