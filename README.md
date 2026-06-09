# Text Mend

**Text Mend** — a Chrome Manifest V3 extension that repairs reversed, mojibake, and garbled
article text locally and presents a clean reader view. See [requirements.md](requirements.md)
for the full spec, [docs/store-listing.md](docs/store-listing.md) for store names/subtitles,
and [tasks/todo.md](tasks/todo.md) for the implementation checklist.

## Architecture

Decision logic is pure and fully unit-tested; the extension is a thin DOM/UI adapter.

| Layer | Files | Tested by |
|---|---|---|
| Reversal primitives (grapheme-safe, punctuation-aware) | `src/core/reverse.js` | `test/reverse.test.js` |
| Detection + confidence scoring | `src/core/detect.js`, `src/core/corpus.js` | `test/detect.test.js` |
| Normalization routing policy (§5.19, in-place safety) | `src/core/engine.js` | `test/engine.test.js` |
| Duplicate removal | `src/core/dedupe.js` | `test/dedupe.test.js` |
| Cleaned-article export (Markdown / plain) | `src/core/extract.js` | `test/extract.test.js` |
| V1.5 repair candidates (strip, mojibake, unwrap, punct) + composer | `src/core/{strip,mojibake,unwrap,punct,repair}.js` | `test/repair.test.js`, `test/detect-compose.test.js` |
| News extraction (container scoring, byline, credits, dedup) | `src/extension/extract-article.js` | `test/extract-article.test.js` (jsdom) |
| Reader-view article builder | `src/extension/reader.js` | `test/reader.test.js` (jsdom) |
| DOM adapter (scan, apply, undo, exclusions, extract) | `src/extension/dom-normalize.js` | `test/dom-normalize.test.js` (jsdom) |
| False-positive bar (clean corpus, all candidates) | `fixtures/normal-corpus.txt` | `test/false-positive.test.js` |
| `web_accessible_resources` integrity | `manifest.json` | `test/manifest-war.test.js` |
| Loads + reader view + repairs in real Chrome | whole packed extension | `test/e2e/regression.e2e.mjs` (puppeteer) |
| chrome wiring, review panel, popup, options, worker | `src/extension/content.js`, others | jsdom + Chrome e2e |

## Run the tests

Requires Node 18+ (built-in test runner + `Intl.Segmenter`). DOM tests use `jsdom`;
the Chrome regression suite uses `puppeteer-core` driving locally-installed Google Chrome
(both dev-only).

```bash
npm install        # jsdom + puppeteer-core
npm test           # 76 unit + integration tests (fast, no browser)
npm run test:e2e   # 3 Chrome regression tests (loads the real extension; needs Chrome)
npm run test:all   # both
```

The e2e suite stages a clean copy of the extension (`manifest.json`, `src/`, `icons/`) to a
temp dir and loads it via Chrome's debugging pipe (`installExtension`) — Chrome 138+ removed
the `--load-extension` switch. Override the browser with `CHROME_PATH=/path/to/chrome`.

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
