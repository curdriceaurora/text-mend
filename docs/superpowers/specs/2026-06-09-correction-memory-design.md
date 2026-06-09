# Design: Correction Memory (V2)

**Date:** 2026-06-09
**Status:** Approved design (revised after review) — pending implementation plan
**Feature:** Remember user corrections to repairs and replay them on later visits.
**Spec home:** will land as `requirements.md` §5.25 + §9 roadmap update after implementation.

## 1. Summary

The extension already repairs text deterministically (reversal, mojibake, strip, unwrap) and
renders/normalizes it. Correction memory lets a user **override** a repair (replace it with
exact text) or **suppress** it (never repair this text), once, and have that decision
**replayed automatically** the next time the same text appears — on any site. It is
local-only, on by default, and clearable.

This is the most design-heavy V2 item (it introduces a persistence layer and a precedence
rule over detection). The other §9 V2 items (diff view, site-specific extraction rules,
multi-page stitching) remain on the roadmap and are out of scope here.

### 1.1 Target platform

**Chrome MV3**, consistent with the rest of the project; Firefox/Edge/Safari ports stay a
deferred `requirements.md` §10 item and are out of scope. The design keeps portability cheap
without taking it on now: **all `chrome.*` and quota-specific assumptions are confined to
`corrections-store.js`** (the single storage adapter). The pure core (`corrections.js`),
`dom-normalize.js`, and `reader.js` are browser-agnostic — they only ever see a plain
`records` object and plain decisions. A future port reimplements one adapter (e.g. against
`browser.storage.local`) and changes nothing else. Where this doc cites Chrome's ~10 MB
`storage.local` quota, that is an adapter-level detail; the portable guards are the
entry/byte caps in §4, which hold on any backend.

## 2. Goals / Non-goals

**Goals**
1. Capture corrections with one or two clicks: **override** (edit the text, or pin the
   detector's current proposal) and **suppress** (never repair this segment).
2. Replay a stored correction automatically when the same original segment text reappears,
   regardless of site or URL — on every surface (page scan, selection, reader view).
3. Deterministic and safe: a replayed override produces the exact stored text, and only on an
   exact text match (no collision-driven wrong replacements).
4. Keep all correction data local; never transmit or sync it. On by default, clearable.
5. Leave behavior identical to today when memory is empty or disabled.

**Non-goals**
- No cloud sync (`storage.sync` quota is too small; §5.13 mandates local).
- No per-site or per-URL scoping (matching is content-addressed — §5).
- No diff view, site rules, or multi-page stitching (separate V2 increments).
- No fuzzy/ML matching — exact normalized-text match only.
- **No separate "force" type.** "Always apply this repair" is implemented as an override
  whose replacement is the detector's current proposal (see §2.1).

### 2.1 Why two types, not three

The earlier draft had a third type, "force" ("always apply the detector's repair"). That is
not deterministic — it re-trusts whatever the detector proposes later, which can change. The
user-facing promise "always fix this" is satisfied deterministically by storing the **resolved
text** as an override. So the "Always fix this" UI action creates an `override` whose
`replacement` is the proposal shown at capture time. Internally there are exactly two types:
`override` and `suppress`.

## 3. Architecture & modules

| Module | Kind | Responsibility |
|---|---|---|
| `src/core/corrections.js` | pure, no chrome | The brain: `keyFor`, `lookup`, `resolveSegment`, record builders, LRU selection. Imports `detectSegment`; single place precedence lives. Returns a decision **plus `correctionKey`** on a hit. |
| `src/core/engine.js` | **modified** | `planNormalization(units, opts)` gains an injectable `resolve` (default `detectSegment`); the page-scan path must route through corrections, not call `detectSegment` directly. |
| `src/extension/corrections-store.js` | thin chrome adapter | Load all records, save/delete **per-record** under `corr:v1:<key>` storage keys, supply `Date.now()`, enforce entry + byte caps, bump `lastUsedAt` for replayed keys, surface write failures. No decision logic. |
| `src/core/detect.js` | unchanged | Detection only. |
| `src/extension/dom-normalize.js` | modified, **stays chrome-free** | Receives `records` (or a ready `resolve`) from its caller — does **not** touch storage. `scan`/`normalizeSelection` use `resolveSegment` with the passed records and apply per §6.3. |
| `src/extension/reader.js` | modified, **stays pure** | `buildReaderArticle(doc, { records, ... })`; `repairBlock` calls `resolveSegment(text, records, {unwrap:true})`. Records passed in by `reader-page.js`. |
| `src/extension/content.js` | modified | **The only content-side storage boundary**: loads records once per scan (via `corrections-store`), passes them into `dom-normalize`, collects replayed `correctionKey`s and asks the store to bump them, and wires preview-panel capture actions to the store. |
| `src/extension/reader-page.js` | modified | Loads records via `corrections-store`, passes them to `buildReaderArticle`; wires the inline mark editor to the store. |
| `src/extension/options.{html,js}` | modified | Toggle + clear button + live count. |
| `src/extension/settings.js` | modified | Add `rememberCorrections` (default `true`); bump `SCHEMA_VERSION`. |

The pure core takes records + timestamps as **arguments** (deterministic, unit-testable, no
chrome/clock). The adapter is the only place touching `chrome.storage.local` / `Date.now()`.

**Web-accessible resources:** `content.js` (injected) statically imports `corrections.js`
(under `src/core/*`, already covered) and `corrections-store.js` — **`corrections-store.js`
must be added to `web_accessible_resources`**, like `dom-normalize.js`/`settings.js`. The
existing `test/manifest-war.test.js` guard fails until it is. Content scripts may use
`chrome.storage.local` directly, so no background round-trip is needed.

## 4. Data model & storage

Each correction is stored under its **own** storage key `corr:v1:<key>` (not one big object)
so concurrent writes from different tabs don't clobber each other (see §10). The `v1` segment
is a **schema/namespace version**: if `normalize()` or `keyFor()` ever changes (which would
invalidate existing keys), bump to `corr:v2:` so old records are cleanly ignored/migrated
rather than silently mismatching. Records also carry `schemaVersion: 1` for in-record
migration if the field shape changes independently of the key function.

**Adapter ↔ core boundary (key shape):** the pure core (§6) works with an **unprefixed**
records map keyed by `keyFor(text)`. The adapter translates:
- `loadRecords()` reads all `corr:v1:*` storage keys and returns a map with the `corr:v1:`
  prefix **stripped** (so `records[keyFor(text)]` works in pure code).
- `save`/`delete`/`count`/`clear` operate on the **prefixed** storage keys.
The prefix never appears in `corrections.js`.

```jsonc
// storage.local key: "corr:v1:1a2b3c..."
{
  "schemaVersion": 1,
  "type": "override" | "suppress",
  "original": "normalized original segment text",  // both types store this — replay requires exact match
  "replacement": "user's exact text",              // override only
  "createdAt": 1717900000000,
  "lastUsedAt": 1717900000000                       // updated on replay; LRU eviction key
}
```

- Both types store the normalized **original** text — required for exact-match replay (§5) and
  for showing the user what a record refers to in a future management UI. This is page-derived
  text stored locally; acceptable given the feature is opt-out, local-only, and clearable.
- Caps (enforced by the adapter, checked at capture for **both** types):
  `MAX_CORRECTIONS = 1000` entries (LRU by `lastUsedAt`); `MAX_ORIGINAL_BYTES = 4096` on the
  stored `original` (a suppress on a huge block is rejected with a message — it would also
  bloat storage); `MAX_REPLACEMENT_BYTES = 4096` on an override's `replacement`. A record is
  therefore ≤ ~8 KB plus metadata, so worst case ≈ 1000 × ~8 KB ≈ 8 MB and the entry cap is
  the binding guard; the byte caps prevent a single pathological capture.
- `storage.local.set` failures (quota/`runtime.lastError`) are caught: the capture surfaces a
  non-fatal "couldn't save correction" status and the in-page repair still happens for this
  visit; nothing throws.

## 5. Matching: content-addressed, exact-verified

- `normalize(text)` = collapse whitespace + trim (reuse the dedupe normalizer).
- `keyFor(text)` = a dependency-free non-crypto hash (cyrb53, 53-bit, base-36) of
  `normalize(text)`. **The hash is only a map index.** Correctness does not depend on hash
  strength because:
- **Exact-match verification:** `lookup`/`resolveSegment` replay a record only when
  `record.original === normalize(incomingText)`. A hash collision therefore can never inject
  the wrong replacement — a colliding-but-unequal segment falls through to normal detection.
  This closes the global-replay footgun for overrides regardless of hash choice.
- **Collision precision:** a true hash collision is harmless for *replay* but not for
  *retention* — since storage is one record per hash key (§4), capturing a second, different
  text that collides would overwrite the first record. At 53-bit cyrb53 with ≤ 1000 entries
  the probability is ≈ 1e-10, which we accept rather than chaining records per key. (If ever
  needed, the cheap hardening is to store an array of records under a key and exact-match
  within it; not implemented now — YAGNI.)
- Key computed over the **original (pre-repair)** segment text — what the user saw and acted
  on. Global scope; the 20-char minimum segment length makes even hash-bucket collisions rare,
  and exact-match makes them harmless.

## 6. Precedence & application

### 6.1 `resolveSegment(text, records, opts)` (pure)
Returns the normal `detectSegment` decision shape, plus `source` and `correctionKey` on a hit:

1. `key = keyFor(text)`; `rec = records[key]`; if `rec` and `rec.original === normalize(text)`:
   - **suppress** → `{ mode:'none', proposed:text, applied:[], tier:'low', source:'correction', correctionKey:key }`.
   - **override** → `{ mode:'override', proposed:rec.replacement, applied:['override'], tier:'high', source:'correction', correctionKey:key }`.
2. Otherwise → `detectSegment(text, opts)` unchanged (today's behavior; no `source`).

`correctionKey` is how the adapter knows which record to bump `lastUsedAt` on (§3, §10) —
resolveSegment itself is pure and mutates nothing.

**Bump-path contract (applies to every surface):** `source`/`correctionKey` must survive all
routing, including decisions that produce no visible change. Specifically:
- `engine.planNormalization` copies `source` and `correctionKey` onto every decision it
  returns — **including `action:'skip'`** (a suppress hit is a skip with a `correctionKey`).
- `dom-normalize.scan` returns a `replayedKeys: string[]` collected from **all** plan
  decisions (skip/apply/preview alike), and `normalizeSelection` includes `correctionKey`
  in its result.
- `reader.repairBlock` carries `correctionKey` on blocks even when `changed === false`
  (suppress), and `buildReaderArticle` aggregates a `replayedKeys` array.
- `content.js` / `reader-page.js` pass `replayedKeys` to the store's batched bump.
Without this, suppress records would never be bumped and would be LRU-evicted first — the
exact records the user most explicitly created.

### 6.2 Interaction with `autoNormalize` (the replay-vs-routing rule)
Corrections are explicit per-segment user intent, so they **bypass the `autoNormalize`
setting** (which only governs *detector-proposed* repairs):
- **suppress** always wins: the segment is shown unchanged and is **never** routed to preview.
- **override** is applied whenever structurally safe, even if `autoNormalize` is off.

They still obey the existing **DOM in-place-safety rule** (unchanged from V1.5):
- single text-node block → applied in place;
- multi-node / link-spanning block → routed to the preview/review surface (cannot mutate
  across inline elements in-page), and fully applied in the reader view.

So: corrections override the *confidence/autoNormalize* gate but not the *structural-safety*
gate. Detector-proposed repairs continue to respect both.

### 6.3 Where each surface resolves
- **Page scan** (`dom-normalize.scan` → `engine.planNormalization`): inject
  `resolve = (t,o)=>resolveSegment(t, records, o)`; engine uses it instead of `detectSegment`.
- **Selection** (`dom-normalize.normalizeSelection`): call `resolveSegment`.
- **Reader view** (`reader.repairBlock`): call `resolveSegment`; everything applies in the
  owned surface.

## 7. Capture UI (both surfaces)

**Reader view** (`reader-page.js`): clicking a repaired `<mark>` opens a small inline editor:
- editable field prefilled with the repaired text → **Save edit** = override(typed text);
- **Don't repair this** = suppress;
- **Dismiss** = no change.

**In-page preview panel** (`content.js`): each preview item gains:
- an editable field → **override**(typed text);
- **Always fix this** → override(the proposal shown), i.e. pin this repair;
- **Ignore — don't repair again** → suppress.

All actions key on the segment's **original** text and call the same `corrections-store` write
API. Controls are hidden when `rememberCorrections` is off.

**Immediate effect (current page, not just next visit):** a capture updates the view in place
right away, then persists:
- Reader **Save edit** → the `<mark>` re-renders with the new text (and is still marked as a
  correction). Reader **Don't repair this** → the `<mark>` **reverts to the original text**
  and the mark is removed (the user sees their suppress take effect now). 
- Preview **override** / **Always fix this** → applies to the page immediately under the same
  structural-safety rule as a normal apply: a **single-node** block is rewritten in place; a
  **multi-node / link-spanning** block stays **copy/preview-only in-page** (it cannot mutate
  across inline elements) — the override is persisted and the fixed text offered for copy, and
  it applies fully only in the reader view. Either way the item leaves the panel. Preview
  **Ignore — don't repair again** → the segment is left/restored as original and the item
  leaves the panel.
This keeps "I fixed it" and "it changed on screen" the same gesture; persistence is a
side effect the user doesn't have to think about.

## 8. Settings, privacy, security

- `settings.js`: add `rememberCorrections: true` to the versioned schema; bump
  `SCHEMA_VERSION`; `migrate` defaults it `true` for existing users.
- `options.html/js`: **"Remember my corrections"** toggle; **"Clear all corrections (N)"**
  button with live count; both operate on `storage.local` (`corr:v1:*` keys).
- Local-only, never synced. No new permissions (`storage` already granted).
- Stored data is page-derived (original text) plus user-authored replacements — all local,
  clearable, and gated by the toggle. Override/suppress text is rendered via `textContent`
  only (no `innerHTML`), per §5.14.
- Turning the toggle off stops capture and replay immediately; it does not delete records
  (the Clear button does that explicitly).

## 9. Testing

**Pure (`test/corrections.test.js`)**
- `keyFor` stable across whitespace variants, distinct for distinct content.
- `lookup` requires exact `original` match: a forged record whose `original` differs from the
  incoming text (same key) is **not** replayed → falls through to detection (collision guard).
- `resolveSegment` precedence: suppress beats high-confidence detection; override replaces with
  exact stored text and reports `correctionKey`; miss ≡ `detectSegment`.
- LRU selection evicts oldest `lastUsedAt` at the cap.
- Empty records ⇒ `resolveSegment` ≡ `detectSegment` (false-positive guard).

**Engine (`test/engine.test.js` extended)**
- `planNormalization` with an injected `resolve` routes through it; default still uses
  `detectSegment` (no regression).

**jsdom (`test/corrections-dom.test.js`)**
- `dom-normalize` applies a suppress (segment left alone) and an override (text replaced) from
  a records map, **even when `autoNormalize` is false** (bypass rule); a link-spanning override
  routes to preview (structural-safety rule still holds).
- `reader` replays corrections.
- capture helpers produce correct record shapes; over-long `replacement` **and** over-long
  `original` are both rejected (`MAX_REPLACEMENT_BYTES` / `MAX_ORIGINAL_BYTES`).

**Chrome e2e (extend `regression.e2e.mjs`)**
- Persist an override + a suppress via the store, reload the reader page, assert both replay
  from real `storage.local`; assert `lastUsedAt` advanced.

**Toggle-off (`rememberCorrections = false`)**
- Existing stored corrections are **ignored**: `resolveSegment` is bypassed (or fed empty
  records) so a stored override/suppress does not replay; output ≡ plain detection.
- No `lastUsedAt` bump occurs (no `replayedKeys` acted on).
- Capture controls are hidden in both surfaces (asserted in the jsdom UI tests).

**Suppress-bump (P1 guard)**
- A suppress hit during a page scan surfaces its `correctionKey` in `replayedKeys` even though
  the segment is unchanged (`action:'skip'`), and the store bumps its `lastUsedAt`.

**Regression**
- Full suite green with memory empty/off; FP bar unchanged.

## 10. Concurrency & lifecycle

- **Per-record keys** (`corr:v1:<key>`) avoid the load-modify-save lost-update race: adding a
  record or bumping one record's `lastUsedAt` writes only that key, never the whole map.
- `lastUsedAt` bumps are best-effort and batched per scan (the surface collects replayed
  `correctionKey`s from `resolveSegment` results and calls one store update).
- Eviction: when adding past `MAX_CORRECTIONS`, the adapter lists `corr:v1:*`, drops the oldest
  `lastUsedAt`. (A rare over-cap race between tabs self-heals on the next eviction pass.)

## 11. Rollout / spec integration

After implementation: add `requirements.md` §5.25 (Correction Memory) summarizing this design,
and move the item from §9 "V2" to "shipped", leaving diff view / site rules / multi-page as the
remaining V2 roadmap.
