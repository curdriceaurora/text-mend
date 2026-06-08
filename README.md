# text-reverser

**Reversed Text Normalizer** — a Chrome Manifest V3 extension that detects and normalizes
reversed text on webpages (character-reversed and word-reversed), locally and on manual
invocation. See [requirements.md](requirements.md) for the full spec and
[tasks/todo.md](tasks/todo.md) for the implementation checklist.

## Architecture

Decision logic is pure and fully unit-tested; the extension is a thin DOM/UI adapter.

| Layer | Files | Tested by |
|---|---|---|
| Reversal primitives (grapheme-safe, punctuation-aware) | `src/core/reverse.js` | `test/reverse.test.js` |
| Detection + confidence scoring | `src/core/detect.js`, `src/core/corpus.js` | `test/detect.test.js` |
| Normalization routing policy (§5.19, in-place safety) | `src/core/engine.js` | `test/engine.test.js` |
| Duplicate removal | `src/core/dedupe.js` | `test/dedupe.test.js` |
| Cleaned-article export (Markdown / plain) | `src/core/extract.js` | `test/extract.test.js` |
| DOM adapter (scan, apply, undo, exclusions, extract) | `src/extension/dom-normalize.js` | `test/dom-normalize.test.js` (jsdom) |
| False-positive bar on a normal-article corpus | `fixtures/normal-corpus.txt` | `test/false-positive.test.js` |
| chrome wiring, review panel, popup, options, worker | `src/extension/content.js`, others | manual (browser) |

## Run the tests

Requires Node 18+ (built-in test runner + `Intl.Segmenter`). DOM tests use `jsdom`
(the only dependency, dev-only).

```bash
npm install   # installs jsdom for the DOM tests
npm test      # 42 tests
```

## Load the extension (manual testing)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select this project directory.
3. Open the fixture page `fixtures/mixed-article.html` in Chrome (File → Open, or drag in).
4. Click the toolbar icon → **Normalize page**.

Expected on the fixture:
- The normal paragraph is untouched.
- `.melborp eht evlos lliw eW` becomes `We will solve the problem.` (full reverse).
- `eW lliw evlos eht melborp.` becomes `We will solve the problem.` (word reverse).
- The reversed paragraph **spanning a link** is *not* mutated — routed to review.
- The `<code>` block is never reversed.
- **Undo** restores all changes.

Keyboard shortcut for selection normalization: `Ctrl+Shift+U` (`Cmd+Shift+U` on macOS).

## V1 scope

Manual page scan, selection normalize, same-session observer (after activation),
grapheme-safe reversal, punctuation-aware token reversal, defined confidence scoring,
per-operation undo, copy cleaned text, local-only processing. Out of scope: per-site
auto mode, page-load auto-run, broad host permissions, in-place mutation across links,
OCR/contextual reconstruction, non-English detection. See `requirements.md` §9.
