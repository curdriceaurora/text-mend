import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planNormalization } from '../src/core/engine.js';

const REVERSED = '.melborp eht evlos lliw eW';

test('high-confidence single-node segment is planned for in-place apply', () => {
  const [d] = planNormalization([{ id: 1, text: REVERSED, singleNode: true }]);
  assert.equal(d.action, 'apply');
  assert.equal(d.mode, 'full');
  assert.equal(d.proposed, 'We will solve the problem.');
});

test('high-confidence MULTI-node segment is routed to preview, never auto-applied', () => {
  const [d] = planNormalization([{ id: 1, text: REVERSED, singleNode: false }]);
  assert.equal(d.action, 'preview'); // §5.5: no silent mutation across nodes/links
  assert.equal(d.proposed, 'We will solve the problem.');
});

test('normal text is skipped', () => {
  const [d] = planNormalization([{ id: 1, text: 'We will solve the problem.', singleNode: true }]);
  assert.equal(d.action, 'skip');
});

test('summary counts reflect the plan', () => {
  const plan = planNormalization([
    { id: 1, text: REVERSED, singleNode: true },
    { id: 2, text: REVERSED, singleNode: false },
    { id: 3, text: 'We will solve the problem.', singleNode: true },
  ]);
  const counts = plan.reduce((acc, d) => ({ ...acc, [d.action]: (acc[d.action] ?? 0) + 1 }), {});
  assert.deepEqual(counts, { apply: 1, preview: 1, skip: 1 });
});
