# Correction Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remember user override/suppress corrections to repairs and replay them automatically on later visits, local-only.

**Architecture:** Pure `corrections.js` (keyFor/lookup/resolveSegment + record builders) wraps the existing `detectSegment`; `engine.js` gains an injectable resolver; a chrome-free, injectable `corrections-store.js` adapter owns `storage.local` (per-record `corr:v1:` keys, caps, prefix strip). `dom-normalize`/`reader` stay chrome-free and receive records from `content.js`/`reader-page.js`.

**Tech Stack:** ES modules, Node built-in test runner, jsdom, puppeteer-core. Spec: `docs/superpowers/specs/2026-06-09-correction-memory-design.md`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/core/corrections.js` (new) | Pure: `normalizeForKey`, `keyFor` (cyrb53), `lookup`, `resolveSegment`, `makeOverride`/`makeSuppress`, `selectEvictions`, byte-cap constants |
| `src/core/engine.js` (mod) | `planNormalization(units, opts)` — `opts.resolve` injectable (default detectSegment); propagate `source`/`correctionKey` onto every decision incl. skip |
| `src/extension/corrections-store.js` (new) | Injectable adapter over a storage area: `loadRecords`, `saveRecord`, `bump`, `count`, `clear`; prefix `corr:v1:`; caps |
| `src/extension/dom-normalize.js` (mod) | chrome-free; `scan({records})` → also returns `replayedKeys`; `normalizeSelection` uses resolveSegment |
| `src/extension/reader.js` (mod) | `buildReaderArticle(doc,{records})`; repairBlock resolves; aggregate `replayedKeys` |
| `src/extension/settings.js` (mod) | add `rememberCorrections:true`, bump SCHEMA_VERSION to 2 |
| `src/extension/content.js` (mod) | load records, pass to scan, bump replayedKeys, preview-panel capture |
| `src/extension/reader-page.js` (mod) | load records, pass to builder, mark-editor capture |
| `src/extension/options.{html,js}` (mod) | toggle + clear(count) |
| `manifest.json` (mod) | add `src/extension/corrections-store.js` to web_accessible_resources |
| tests | `corrections.test.js`, `corrections-store.test.js`, `corrections-dom.test.js`, extend `engine.test.js`, `false-positive`/e2e |

---

## Task 1: Pure corrections core

**Files:** Create `src/core/corrections.js`, `test/corrections.test.js`.

- [ ] Write `test/corrections.test.js`: `keyFor` stable across whitespace + distinct content; `lookup` requires exact `original` match (forged-collision record not returned); `resolveSegment` precedence (suppress beats high-confidence, override replaces + returns `correctionKey`, miss ≡ detectSegment); empty records ≡ detectSegment; `selectEvictions` drops oldest `lastUsedAt` over cap.
- [ ] Run `npm test test/corrections.test.js` → FAIL (module missing).
- [ ] Implement `corrections.js`:
  - `normalizeForKey(t)` = collapse whitespace + trim.
  - `keyFor(t)` = cyrb53(normalizeForKey(t)).toString(36).
  - `lookup(records, text)` → record only if `records[keyFor]?.original === normalizeForKey(text)`.
  - `resolveSegment(text, records, opts)` per spec §6.1, returns detectSegment decision + `{source:'correction', correctionKey}` on hit; suppress → `{mode:'none',applied:[],tier:'low',source,correctionKey}`; override → `{mode:'override',proposed:replacement,applied:['override'],tier:'high',source,correctionKey}`.
  - `makeOverride(original, replacement, now)`, `makeSuppress(original, now)` → record objects (`schemaVersion:1`), enforce `MAX_ORIGINAL_BYTES`/`MAX_REPLACEMENT_BYTES` (return null if exceeded).
  - `selectEvictions(records, max)` → keys to drop (oldest lastUsedAt).
- [ ] Run → PASS. Commit.

## Task 2: Engine injectable resolver

**Files:** Modify `src/core/engine.js`, extend `test/engine.test.js`.

- [ ] Add test: `planNormalization(units,{resolve})` routes through the injected resolver; a resolver returning `{mode:'none',source:'correction',correctionKey:'k'}` yields a decision with `action:'skip'` that still carries `source` + `correctionKey`; default (no resolve) uses detectSegment (existing tests unchanged).
- [ ] Run → FAIL.
- [ ] Implement: `planNormalization(units, opts={})` uses `const resolve = opts.resolve || ((t)=>detectSegment(t,opts))`; copy `det.source`/`det.correctionKey` onto the returned decision for all actions.
- [ ] Run → PASS. Commit.

## Task 3: Corrections store adapter

**Files:** Create `src/extension/corrections-store.js`, `test/corrections-store.test.js`.

- [ ] Write test with an in-memory fake storage area (`{get,set,remove}` over a Map): `saveRecord` writes under `corr:v1:<key>`; `loadRecords` returns an **unprefixed** map; `bump(keys, now)` updates lastUsedAt; `count`/`clear` operate on `corr:v1:*` only (leave other keys); saving past `MAX_CORRECTIONS` evicts oldest; `set` failure is caught and surfaced (no throw).
- [ ] Run → FAIL.
- [ ] Implement `createCorrectionsStore(area = chrome.storage.local)` with `PREFIX='corr:v1:'`; methods as above; eviction via `selectEvictions`.
- [ ] Run → PASS. Commit.

## Task 4: dom-normalize integration

**Files:** Modify `src/extension/dom-normalize.js`, extend `test/dom-normalize.test.js`.

- [ ] Add tests: `scan({records, settings:{autoNormalize:false}})` applies an override (single-node) and a suppress (left unchanged) — bypassing autoNormalize; a link-spanning override routes to preview; `scan` result includes `replayedKeys` for both applied and skipped corrections; `normalizeSelection` returns `correctionKey` on a stored hit.
- [ ] Run → FAIL.
- [ ] Implement: `scan({apply, settings, records={}})` builds `resolve=(t,o)=>resolveSegment(t,records,o)`, passes to `planNormalization`; corrections bypass the autoNormalize gate (a `source==='correction'` apply/override is applied when single-node even if autoNormalize off; suppress always → unchanged, never preview); collect `replayedKeys`. `normalizeSelection(sel, opts, records)` calls resolveSegment.
- [ ] Run → PASS. Commit.

## Task 5: reader integration

**Files:** Modify `src/extension/reader.js`, extend `test/reader.test.js`.

- [ ] Add tests: `buildReaderArticle(doc,{records})` replays an override (block text replaced, `changed`, modes `['override']`) and a suppress (block left at original, `changed:false`, carries `correctionKey`); article exposes `replayedKeys`.
- [ ] Run → FAIL.
- [ ] Implement: `buildReaderArticle(doc, opts={})` threads `opts.records`; `repairBlock(text, records, opts)` calls `resolveSegment`; carry `correctionKey` even when `changed===false`; aggregate `replayedKeys`.
- [ ] Run → PASS. Commit.

## Task 6: settings

**Files:** Modify `src/extension/settings.js`, `options.html`, `options.js`. (covered by existing options behavior; assert via corrections-store/dom tests using settings flag)

- [ ] Add `rememberCorrections:true` to `SETTINGS_DEFAULTS`, bump `SCHEMA_VERSION` to 2 (migrate keeps it true).
- [ ] options.html: checkbox `rememberCorrections` + a "Clear corrections" button + count span. options.js: wire field; clear button calls store.clear() and updates count.
- [ ] Run full suite → PASS. Commit.

## Task 7: content.js wiring

**Files:** Modify `src/extension/content.js`.

- [ ] Load records once per scan (when `rememberCorrections`), pass to `normalizer.scan({records})`; after scan, `store.bump(res.replayedKeys)`. Preview panel: add edit field (override), "Always fix this" (override of proposal), "Ignore" (suppress) → store write + immediate in-place effect; hide controls when memory off.
- [ ] `node --check`; run full suite → PASS. Commit.

## Task 8: reader-page.js capture UI

**Files:** Modify `src/extension/reader-page.js`.

- [ ] Load records, pass to `buildReaderArticle`; bump replayedKeys. Mark editor on click: Save edit (override), Don't repair (suppress→revert mark to original now), Dismiss; hide when memory off.
- [ ] `node --check`. Commit.

## Task 9: manifest WAR

**Files:** Modify `manifest.json`.

- [ ] Add `src/extension/corrections-store.js` to web_accessible_resources resources.
- [ ] Run `npm test test/manifest-war.test.js` → PASS (it walks content.js's import graph). Commit.

## Task 10: Chrome e2e + spec integration

**Files:** Extend `test/e2e/regression.e2e.mjs`; update `requirements.md`.

- [ ] e2e: via SW, write an override + suppress to `storage.local` (prefixed), open reader for a fixture containing both originals, assert override text rendered + suppress left original; assert `lastUsedAt` advanced after load.
- [ ] Run `npm run test:e2e` → PASS.
- [ ] requirements.md: add §5.25 Correction Memory summary; move item in §9 from V2 to shipped. Commit.

---

## Self-review notes
- Spec coverage: types (override/suppress) T1; engine routing T2; adapter/versioned keys/caps T3; autoNormalize-bypass + structural-safety + replayedKeys T4/T5; settings/toggle-off T6; capture UI + immediate effect T7/T8; WAR T9; e2e + §5.25 T10. Bump path: correctionKey propagated T2, collected T4/T5, applied T7/T8.
- Determinism: pure core takes `now` as arg; adapter supplies Date.now.
