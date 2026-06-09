import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripInvisibles, hasInvisibles } from '../src/core/strip.js';
import { repairMojibake, mojibakeArtifactCount, artifactFor } from '../src/core/mojibake.js';
import { unwrapText } from '../src/core/unwrap.js';
import { canonicalizePunctuation } from '../src/core/punct.js';
import { preRepair } from '../src/core/repair.js';

// Mojibake artifacts are GENERATED (UTF-8 bytes mis-decoded as windows-1252), never
// hand-typed, so the fixtures are exact by construction.
const moji = (s) => artifactFor(s);

// --- strip ---

test('stripInvisibles removes ZWSP, soft hyphen, and stray directional marks', () => {
  const input = 'tur​tle sea­son re‎port‏';
  assert.equal(stripInvisibles(input), 'turtle season report');
  assert.equal(hasInvisibles(input), true);
  assert.equal(hasInvisibles('clean text'), false);
});

test('stripInvisibles preserves ZWJ inside an emoji sequence', () => {
  const family = '👨‍👩‍👧'; // ZWJ joins the family emoji
  assert.equal(stripInvisibles(`a ${family} b`), `a ${family} b`);
});

// --- mojibake ---

test('artifactFor produces the double-decode form of a character', () => {
  // U+2019 RIGHT SINGLE QUOTATION MARK as UTF-8 bytes read as windows-1252
  const a = moji('’');
  assert.equal(a.length, 3);
  assert.notEqual(a, '’');
});

test('repairMojibake restores curly quotes and accented letters', () => {
  const corrupted = `It${moji('’')}s a caf${moji('é')} story`;
  assert.equal(repairMojibake(corrupted), 'It’s a café story');
  assert.equal(mojibakeArtifactCount(corrupted), 2);
});

test('repairMojibake leaves clean text byte-identical', () => {
  const clean = 'It’s a café story — truly.';
  assert.equal(repairMojibake(clean), clean);
  assert.equal(mojibakeArtifactCount(clean), 0);
});

// --- unwrap ---

test('unwrapText joins a mid-sentence hard wrap into a space', () => {
  const r = unwrapText('the lights were\nstill burning bright');
  assert.equal(r.text, 'the lights were still burning bright');
  assert.equal(r.tier, 'medium'); // heuristic join → preview tier
});

test('unwrapText re-joins a dictionary-validated hyphenation split at high tier', () => {
  const r = unwrapText('this prob-\nlem is solved');
  assert.equal(r.text, 'this problem is solved');
  assert.equal(r.tier, 'high');
});

test('unwrapText leaves non-dictionary hyphen joins alone', () => {
  const r = unwrapText('the xqz-\nzyx unit');
  assert.equal(r.text, 'the xqz-\nzyx unit');
});

test('unwrapText preserves paragraph breaks (double newlines)', () => {
  const r = unwrapText('first paragraph ends.\n\nsecond starts here');
  assert.equal(r.text, 'first paragraph ends.\n\nsecond starts here');
});

// --- punctuation canonicalization (export-only transform) ---

test('canonicalizePunctuation converts -- and ... only', () => {
  assert.equal(
    canonicalizePunctuation('Wait -- really... yes'),
    'Wait — really… yes',
  );
});

test('canonicalizePunctuation leaves em dashes, ellipses, and code-ish text alone', () => {
  const s = 'a — b … c --flag';
  assert.equal(canonicalizePunctuation(s), 'a — b … c --flag');
});

// --- composed pre-repair pass (§5.4.5 / §5.19 step 4) ---

test('preRepair composes strip then mojibake, reporting modes and lowest tier', () => {
  const input = `It${moji('’')}s​ a story`;
  const r = preRepair(input);
  assert.equal(r.text, 'It’s a story');
  assert.deepEqual(r.applied.map((a) => a.mode), ['strip', 'mojibake']);
  assert.equal(r.tier, 'high');
});

test('preRepair applies unwrap only when enabled (extraction/export paths)', () => {
  const wrapped = 'the lights were\nstill burning';
  assert.equal(preRepair(wrapped).text, wrapped); // in-page scan: untouched
  const r = preRepair(wrapped, { unwrap: true });
  assert.equal(r.text, 'the lights were still burning');
  assert.equal(r.tier, 'medium'); // lowest tier wins for the composition
});

test('preRepair routes weak-only mojibake (Â£/Â°) to medium, never auto-apply', () => {
  // A lone single-'Â' artifact with no strong (â/Ã) artifact must not auto-fire.
  const weak = `the price was ${moji('£')}5 across the board for every customer in the region`;
  const r = preRepair(weak);
  assert.equal(r.applied[0].mode, 'mojibake');
  assert.equal(r.tier, 'medium', 'weak-only mojibake must be preview tier');
});

test('preRepair keeps mojibake at high tier when a strong artifact co-occurs', () => {
  const strong = `the price ${moji('’')}was ${moji('£')}5 for the whole order that the buyer placed`;
  const r = preRepair(strong);
  assert.equal(r.tier, 'high');
});

test('preRepair is a no-op on clean text', () => {
  const clean = 'Wildlife experts say the glow disrupts the turtles.';
  const r = preRepair(clean, { unwrap: true });
  assert.equal(r.text, clean);
  assert.deepEqual(r.applied, []);
});
