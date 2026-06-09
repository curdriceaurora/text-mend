# TODO: Reversed Text Normalizer

## V1.5 — news reader (in progress)

Per requirements §9 (V1.5) and §8.5 release criteria. Build order follows dependency, not priority: pure candidates → extraction → reader view → e2e.

- [x] **A. Repair candidates (pure core, TDD)** — `strip`/`mojibake`/`unwrap`/`punct` + `repair.js` composer with §5.4.5 gates+tiers; integrated into `detect.js` (§5.19 step 4) as a gated pre-repair pass before reversal scoring (composed `applied` list, lowest-tier). Unwrap is opt-in (extraction/export only). `detect-score.js` extracted to share tokenization without a circular import.
- [x] **B. News extraction (§5.8)** — `extract-article.js`: Readability-style container scoring (text mass, link density, ¶ count, class hints), byline/dateline split, photo-credit strip, boilerplate + footer exclusion, pull-quote dedup; jsdom-tested.
- [x] **C. Reader view (§5.21)** — `reader.js` (pure builder: extract→repair→metadata+read-time) + `reader.html`/`reader-page.js` (themes, font size, repair marks w/ original on hover, copy + copy-Markdown). Entry points: popup "Open reader view" + context menu "Open in reader view" → background captures source, seeds `storage.session`, opens the reader tab.
- [x] **D. Fixtures + FP gates (§6.4/§6.6)** — `fixtures/v15-news.html` (reversed/mojibake/zero-width/link-span/code/boilerplate). FP bar extended: strip/mojibake/unwrap make ZERO changes on the clean corpus (verified).
- [x] **E. Chrome e2e regression** — `test/e2e/regression.e2e.mjs`: puppeteer-core loads the REAL packed extension into system Chrome (via `installExtension` over the debugging pipe; Chrome 149 removed `--load-extension`), asserts the SW is alive and the reader view repairs reversal/mojibake/zero-width/link-spanning text, excludes nav/ads/footer/credits/code, shows read time + marks, and does not canonicalize punctuation. `npm run test:all` → 76 unit/integration + 3 e2e, 0 failures.

**Code-review pass (post-V1.5, 79 unit + 3 e2e passing):**
- Important #1 — `extract-article.js` leaf-block logic double-counted paragraphs nested in `<li>`/`<blockquote>` (wrapper not skipped because it's itself a block). Simplified to `if (el.querySelector(BLOCK_SELECTOR)) continue;` (matches `dom-normalize`); added a nested-block regression test.
- Important #2 — mojibake could silently delete a legitimate `Â` at auto-apply tier (nbsp entry) and fire on lone `Â°`/`Â£`. Dropped the nbsp entry; added `hasStrongArtifact` (â/Ã-led) gate so weak-only matches route to medium (preview), never auto-apply. Two regression tests.
- Minor — `punct` glued-dash now letters-only (won't rewrite `x86--64`); repair `<mark>` gained an `aria-label` exposing the original to screen readers; `storage.session` reader payloads are swept on each open (leak guard); popup now routes reader-open through the background (single key scheme + sweep, removes duplicated capture logic).
- Verdict was "merge with fixes"; all Important + the cheap Minors are addressed.

**Notes / honest scope:**
- Found & fixed a latent V1 bug: `dom-normalize.js`/`settings.js` were imported by the injected content script but missing from `web_accessible_resources` (the in-page flow would fail to load the module graph in real Chrome). Added them + a static guard (`test/manifest-war.test.js`) so it can't recur.
- The in-page normalize/undo flow is **not** driven in the Chrome e2e: it's gated on a user gesture (toolbar click → activeTab) that headless puppeteer can't synthesize for an MV3 action popup. That path is covered by the jsdom integration suite + the WAR static guard. Reader view (the V1.5 headline) is fully exercised in real Chrome.
- Reader view repairs link-spanning text at the block level; inline link anchors are rendered as plain text (links are not re-created in the owned surface). §5.21 item 2's "links re-rendered with repaired anchor text" is therefore partial — deferred as a refinement.

# V1 (shipped)

Implementation checklist derived from [requirements.md](../requirements.md).
Ordered so each phase produces something testable before the next depends on it.
Mark `[x]` as completed; add a Review section at the bottom when done.

Legend: spec refs point at sections of `requirements.md`.

---

## Phase 0 — Project scaffold
- [ ] Pick toolchain (TypeScript + bundler producing MV3-compatible output; React for popup/side panel).
- [ ] `manifest.json` per §5.20 (`activeTab`, `scripting`, `contextMenus`, `storage`; empty `host_permissions`; `_execute_action` + `normalize-selection` commands).
- [ ] Background service worker stub (`background.js`) wiring context menu + command routing.
- [ ] Load-unpacked build that opens a no-op popup. **Gate:** extension loads in Chrome with no manifest errors.

## Phase 1 — Reversal core (pure, no DOM) — TDD
> Build and unit-test in isolation first; this is the deterministic heart of the product.
- [ ] `normalizer.ts`: **grapheme-safe** full-string reverse via `Intl.Segmenter` (§5.4.3). Ban `split('')`.
- [ ] `normalizer.ts`: **punctuation-aware** token reverse — `leading + reverse(core) + trailing` (§5.4.2).
- [ ] Mode selection: produce original / full-reversed / word-reversed candidates for a segment (§5.19 step 4).
- [ ] Unit tests: `melborp.` → `problem.`; full-string acceptance example; emoji/combining-mark/smart-quote/em-dash/accent fixtures (§6.2, §6.4). **Gate:** all reversal unit tests green.

## Phase 2 — Detection & confidence
- [ ] Bundle corpus: stopword/reversed-token detector + permissive word-frequency list + n-gram table under `corpus/`; add `NOTICE.md` attribution (§5.3.7). Cap compressed size.
- [ ] `detector.ts`: sub-scores — dictionary delta, n-gram delta, reversed-common-token, punctuation improvement, casing boundary; each normalized `[0,1]` (§5.3.1–5.3.5).
- [ ] `detector.ts`: confidence formula + threshold (§5.3.6), comparing **original vs. proposed** (not "contains reversed words"). No hardcoded domain vocabulary.
- [ ] Exclusion rules (§5.3.8): URLs, emails, code, math, <3-char tokens, secure inputs, `script`/`style`/`noscript`/`textarea`/hidden, **CSS `rtl`/bidi context**, non-English.
- [ ] Unit tests for scoring + every exclusion rule; **measurable false-positive bar** harness over a normal-only corpus (§6.6). **Gate:** false-positive bar met.

## Phase 3 — DOM scan & safe write
- [ ] `scanner.ts`: `TreeWalker` candidate collection; skip hidden/script/style/template/noscript/textarea (§5.5).
- [ ] Block grouping + sentence segmentation for mixed paragraphs (§5.19 step 3).
- [ ] **In-place-safety classifier**: single text-node vs. multi-node/linked block (§5.5 inline rule).
- [ ] `domWriter.ts`: text-node replacement only (no HTML injection); preserve tags/links/handlers (§5.5, §5.13.6).
- [ ] `undoStore.ts`: per-operation original text; memory-bounded; cap+warn instead of silent drop; clear on navigation (§5.6).
- [ ] Integration tests: static article, inline links, images/captions, shadow DOM, same-origin iframe, forms (§6.3). **Gate:** multi-node/linked blocks are never mutated in place (assert).

## Phase 4 — Manual flows (the V1 product)
- [ ] Toolbar popup (`popup.tsx`): scan status + counts + primary action buttons (§5.10.1).
- [ ] "Scan page" / "Normalize page" / "Normalize visible content" wired through scanner→detector→domWriter (§5.1, §5.19).
- [ ] Context-menu "Normalize selection" + selection handling (§4.2, §5.10.3).
- [ ] Undo action across whole-page / visible / selection ops (§5.6).
- [ ] Keyboard shortcut `Ctrl/Cmd+Shift+U` + manual-config fallback messaging (§5.17).
- [ ] Error messages for all §5.16 cases. **Gate:** manual scan→normalize→undo round-trips on a static fixture page.

## Phase 5 — Preview side panel
- [ ] `sidePanel.tsx`: injected in-page panel (not popup) with columns Location/Confidence/Original/Proposed/Mode/Action (§5.7).
- [ ] Route medium-confidence + all multi-node/linked blocks to preview (§5.19 steps 6–8).
- [ ] Apply-all-high / apply-selected / ignore / edit / copy-proposed; virtualize large sets (§5.7, §5.15.6).
- [ ] Inline highlighting: green/amber/gray + non-color cue; removable (§5.10.2, §5.14.4).
- [ ] Accessibility pass: keyboard nav, screen-reader labels, no focus-stealing on apply (§5.14). **Gate:** OCR-mangled fixture lands in preview, never auto-applied.

## Phase 6 — Same-session dynamic content
- [ ] `MutationObserver` attached **only after user activation**, current page session only, stops on navigation/reload (§5.1).
- [ ] Debounced re-scan of newly added nodes (§5.15.4).
- [ ] Integration test: dynamic content loading fixture (§6.3). **Gate:** no observer/content-script runs before user activation.

## Phase 7 — Clean extraction & dedupe
- [ ] `articleExtractor.ts`: title/byline/headings/body-order/captions; exclude nav/ads/widgets; plain text + Markdown (§5.8).
- [ ] `dedupe.ts`: exact / whitespace-normalized / back-to-back / near-distance duplicates (§5.9).
- [ ] "Copy cleaned text" + clipboard (prefer `navigator.clipboard` under gesture; `clipboardWrite` only if needed) (§5.1, §5.16).
- [ ] Settings defaults: dedupe on for copy, off in-page (§5.9, §5.11). **Gate:** Markdown export matches §5.8 shape.

## Phase 8 — Settings & storage
- [ ] Options page (`settings.ts`) for all §5.11 settings.
- [ ] `chrome.storage.sync` with **versioned schema** + migration; document `sync` quota and that future correction-memory uses `storage.local` (§5.11).
- [ ] Respect threshold / max-nodes / min-length / preserve-styling / local-only at runtime. **Gate:** changing threshold visibly changes detection.

## Phase 9 — Hardening & release
- [ ] Restricted-URL guard: `chrome://`, `edge://`, `about:`, Web Store (§5.13.8).
- [ ] Performance: batch large pages, cap scan, warn on oversized pages; benchmark the ≤500 ms scan goal (§5.15).
- [ ] Full regression suite incl. 100+ paragraph article, code-snippet-must-not-reverse, Unicode set (§6.4).
- [ ] Verify all §8 release criteria.
- [ ] Chrome Web Store privacy disclosure (§8.12). **Gate:** all release criteria checked.

---

## Explicitly OUT of V1 (do not build now — §9, §2.2)
Per-site auto mode · page-load auto-run · broad host permissions · in-place mutation across links/spans · OCR/contextual reconstruction · LLM repair · non-English detection · PDF/image OCR.

---

## Review

**Built (this pass) — testable V1.** `npm test` → **30 passing**, 0 failing.

Done & automated-tested (pure core):
- Phase 1 reversal core — grapheme-safe (`Intl.Segmenter`) + punctuation-aware token reverse (`src/core/reverse.js`, `test/reverse.test.js`).
- Phase 2 detection/confidence — weighted formula per §5.3.6, exclusions, general (non-domain) corpus (`detect.js`, `corpus.js`, `test/detect.test.js`).
- Routing policy — in-place-safety + preview routing (`engine.js`, `test/engine.test.js`).
- Phase 7 dedupe + extraction — Markdown/plain export (`dedupe.js`, `extract.js`, tests).
- §6.5 acceptance tests (`test/acceptance.test.js`).

Done — extension glue (loadable; verified by syntax check + manifest validation; **manual browser run pending**):
- Phase 0 scaffold: `manifest.json` (MV3, `activeTab`, empty host perms, `_execute_action` + `normalize-selection`, fixed shortcut `Ctrl/Cmd+Shift+U`).
- Phase 3/4 DOM adapter + manual flows: `content.js` (TreeWalker scan, skip script/style/code/editable/hidden/`rtl`, single-node safety, text-node replacement, per-operation undo), `popup.{html,js}`, `background.js`, `content-loader.js`.
- Phase 5 preview: shadow-DOM review panel with Apply / Apply-all (link-spanning segments routed here, never auto-mutated).
- Phase 6 same-session debounced `MutationObserver` (attaches only after activation; disconnects on `pagehide`).
- Phase 8 settings: `options.{html,js}`, versioned `storage.sync` schema, read by `content.js` (threshold/minLength/maxNodes/autoNormalize/dedupeOnCopy).
- Phase 9 partial: restricted-URL guard; `maxNodes` scan cap.

**Buildout finished.** `npm test` → **39 passing**, 0 failing.

Gaps from the previous pass, now closed:
- DOM adapter extracted to `src/extension/dom-normalize.js` and covered by **jsdom integration tests** (`test/dom-normalize.test.js`): in-place apply, normal-text no-op, code/script exclusion, link-spanning → preview (not mutated), hidden/editable skips, undo, autoNormalize=false routing, cleaned-text extraction. Detection now works at **block level** (§5.19 step 3), so a reversed paragraph split across an inline link is detected and routed to review.
- §6.6 **false-positive bar** built: `fixtures/normal-corpus.txt` (25 normal sentences) + `test/false-positive.test.js`, bar ≤1, currently **0**.
- **Toolbar icons** generated (`tools/gen-icons.mjs` → `icons/icon{16,32,48,128}.png`, `npm run build:icons`) and wired into the manifest.
- Review panel updated: single-node segments get **Apply** (in place); multi-node/linked get **Copy fixed text** (never mutated in place).

**Code-review pass (post-buildout, 42 tests passing):**
- C2 (spec violation): removed article-derived vocabulary (`turtle`/`turtles`/`county`) from `corpus.js`; false-positive bar still 0 → proves independence from the test article.
- I4 (inject/send race): `background.js`/`popup.js` now inject a function that **awaits** `import(content.js)`, so the message listener exists before dispatch; deleted `content-loader.js`.
- I1 (settings drift): unified into one versioned `src/extension/settings.js` imported by options/content/adapter.
- I5: added `normalizeSelection` tests (single-node apply + cross-node copy) and a re-scan idempotency test (observer safety).
- C1 (reviewer's "infinite observer loop"): **disputed and verified false** — the panel is appended to `document.documentElement` (outside the observed `document.body` subtree) and `nodeValue` edits don't fire `childList`. Still hardened the real issue: the observer now disconnects while applying and no longer rebuilds the review panel on background mutations (was a flicker/reset bug).
- I2/I3 (minor): documented V1 block-level URL exclusion (code + spec §5.3.8) and clarified `dedupe` window semantics.

**Still deferred (by design):**
- Corpus remains a compact hand-curated list; swap path documented in `NOTICE.md`.
- One **manual load-unpacked** smoke run against `fixtures/mixed-article.html` is still worth doing before store submission (Chrome-only behaviors jsdom can't model: real clipboard, MutationObserver timing, `chrome.*`).
- All OUT-of-V1 items (§9) remain unbuilt by design.
