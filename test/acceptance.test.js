// Acceptance tests mirroring requirements §6.5 — end-to-end through the detection +
// routing engine on realistic, paragraph-shaped inputs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSegment } from '../src/core/detect.js';
import { planNormalization } from '../src/core/engine.js';

test('§6.5 normal headline paragraph is left unchanged', () => {
  const r = detectSegment('BRUNSWICK — Turn them off? Take them down?');
  assert.equal(r.mode, 'none');
});

test('§6.5 reversed paragraph normalizes to readable English', () => {
  const r = detectSegment('.melborp eht evlos lliw eW');
  assert.equal(r.proposed, 'We will solve the problem.');
  assert.equal(r.tier, 'high');
});

test('§6.5 a mixed page: normal kept, reversed fixed, link-spanning reversed reviewed', () => {
  const plan = planNormalization([
    { id: 'normal', text: 'BRUNSWICK — Turn them off? Take them down?', singleNode: true },
    { id: 'reversed', text: '.melborp eht evlos lliw eW', singleNode: true },
    { id: 'linked', text: '.melborp eht evlos lliw eW', singleNode: false },
  ]);
  const byId = Object.fromEntries(plan.map((d) => [d.id, d]));
  assert.equal(byId.normal.action, 'skip');
  assert.equal(byId.reversed.action, 'apply');
  assert.equal(byId.linked.action, 'preview'); // never silently mutated across nodes/links
});
