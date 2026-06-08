# Requirements: Reversed Text Normalizer (Chrome Extension)

**Status:** Revised for implementation readiness (incorporates architecture-review corrections).
**Manifest:** Chrome Manifest V3.
**Guiding principle:** This is a **deterministic local reversal normalizer**, not a general "fix any broken text" tool. OCR/extraction/contextual repair is preview-or-copy only and never silently mutates the page.

---

## 1. Product Summary

The extension detects and normalizes webpage text that contains a mixture of normal readable text and **reversed** text (character-reversed and/or word-reversed). It targets article pages, copied paywalled-article extracts, web archives, CMS-rendered pages, comment sections, and dynamically loaded content.

It must preserve page structure, formatting, links, captions, headings, and already-readable text while converting reversed segments into normal left-to-right text — **or**, where in-place mutation would risk corrupting structure (e.g. text spanning links), surface the corrected text via preview/copy instead of mutating the DOM.

Primary case: a page where some paragraphs are readable and others are character-reversed, e.g. `levart ot hguorht driht eht...`, converted without damaging surrounding content.

### 1.1 Scope of the corruption model (critical)

The extension handles **deterministic reversal** only:

| Input type | V1 support |
|---|---|
| Fully character-reversed paragraph | Supported (in-place where safe) |
| Word-by-word reversed text (order correct) | Supported (in-place where safe) |
| Mixed normal/reversed paragraphs | Supported via segmentation |
| Reversed text split across simple spans | Supported in-place only if boundaries preserve safely; else preview |
| Reversed text spanning links/inline formatting | **Preview/copy only** in V1 (no auto in-place mutation) |
| OCR-mangled article text | **Detection + preview only** |
| Contextual reconstruction (missing words, scrambled order) | **Out of scope** for deterministic V1 |

The extension must **not** promise to reconstruct mangled prose automatically. Assisted/contextual repair, if added later, is an explicit opt-in preview workflow with user confirmation.

---

## 2. Goals

### 2.1 Primary Goals
1. Detect reversed text segments inside webpage content.
2. Convert reversed text into normal readable text (deterministically).
3. Preserve existing readable text.
4. Preserve formatting, links, headings, captions, and article layout.
5. Provide manual controls for selected text, page sections, or the whole page.
6. Support mixed-content documents where only some paragraphs/spans/sentences are reversed.
7. Process page contents locally; never send page text to external servers by default.

### 2.2 Non-Goals (V1)
1. Full OCR from images.
2. Bypassing paywalls, logins, subscriptions, or DRM.
3. Language translation.
4. Rewriting or summarizing content.
5. Modifying server-side content or permanently altering page source.
6. Contextual reconstruction of OCR-mangled prose (preview-only at most).
7. Non-English reversal detection (disabled unless a language pack is enabled).

---

## 3. Target Users
1. Readers encountering mangled article text.
2. Researchers collecting text from archives, news pages, forums, HTML-converted PDFs, OCR output.
3. Editors / QA reviewers checking broken page rendering.
4. Users pasting mixed normal/reversed text into browser editors.

---

## 4. Core User Stories

### 4.1 Whole-Page Normalization
Click one button to normalize all safely-fixable reversed text on the page.
- Scans visible page text; normal paragraphs unchanged; reversed paragraphs become readable; formatting retained; transformation is undoable.
- Segments that span links/inline formatting are routed to preview rather than mutated.

### 4.2 Selection Normalization
Select a block of garbled text and normalize only that selection.
- Context-menu option "Normalize reversed text."
- Only the selection is changed or copied to a result panel.
- Links/styling inside the range preserved where safe; otherwise corrected text is offered via preview/copy.

### 4.3 Preview Before Applying
Preview detected changes before applying.
- Lists detected reversed segments with before/after, confidence, and chosen mode.
- Apply all (high-confidence), apply selected, edit, or cancel.

### 4.4 Copy Cleaned Article
Copy the cleaned version for notes/documents.
- "Copy cleaned text" with readable paragraph breaks; captions/headings/body in logical order; optional duplicate-caption removal; plain text default, Markdown optional.

### 4.5 Dynamic Page Support (same-session)
After the user activates the extension on a page, newly loaded reversed content is detected during that page session.
- Observer attaches **only after user activation** and stops on navigation/reload (see §5.1).

---

## 5. Functional Requirements

### 5.1 Permissions and Execution Model (V1)

V1 uses a **manual-invocation** model.

Required permissions:
```json
{
  "permissions": ["activeTab", "scripting", "contextMenus", "storage"],
  "host_permissions": []
}
```
Optional: `clipboardWrite` (only if `document.execCommand`-based copy is used; prefer `navigator.clipboard` under user gesture).

Rules:
- The extension may scan/modify the active tab **only after the user invokes it** (toolbar, context menu, or keyboard command).
- It may attach a `MutationObserver` **only after user activation**, for the **current page session only**; the observer stops on navigation or reload.
- **Out of scope for V1** (require host permissions / declared `content_scripts`, deferred): automatic per-site scanning, automatic page-load normalization, background content-script execution.

Activation methods: toolbar button, right-click context menu (on selection), keyboard shortcut.

Toolbar actions: Scan page · Normalize page · Normalize visible content · Normalize selection · Preview fixes · Undo changes · Copy cleaned text · Settings.

### 5.2 Reversed Text Detection

Detect at: text-node, sentence, paragraph, block, and user-selected-range levels.

Distinguish: fully normal · fully reversed · mixed · short ambiguous strings · numeric/date/URL/code/path strings.

Confidence tiers (single normalized score, see §5.3.6):
- **High** (≥ threshold, default 0.75): auto-apply allowed (only for in-place-safe segments).
- **Medium**: shown in preview.
- **Low**: ignored unless user selects manually.

### 5.3 Detection Heuristics (local scoring engine)

Scoring compares **original text vs. proposed normalized text** — not merely "contains reversed-looking words."

#### 5.3.1 Word Recognition (dictionary delta)
Tokenize; for each candidate compare normal vs. reversed forms against a bundled English word-frequency list. Score the *improvement* of the proposed form over the original. **Do not hardcode article-specific vocabulary** (no domain word lists such as "turtle"/"county"); use a general corpus (see §5.3.7).

#### 5.3.2 Punctuation Pattern
Reversed-text indicators: paragraph begins lowercase and ends with a capitalized word; periods precede sentence fragments; quotes/commas/closing punctuation appear before clauses. Score punctuation *improvement* of proposed vs. original.

#### 5.3.3 Directional Common-Token
Count tokens that become valid frequent English words after reversal (`eht→the`, `dna→and`, `ot→to`, `fo→of`, `htiw→with`, `dias→said`, ...), drawn from the corpus, not a fixed table.

#### 5.3.4 Sentence Coherence (n-gram)
Score original vs. reversed with a lightweight local n-gram table. Normalize only if the reversed/proposed score is significantly higher.

#### 5.3.5 Casing Boundary
Score capitalization plausibility of the proposed text (sentence-initial capitals, mid-sentence lowercase).

#### 5.3.6 Confidence Formula
```
confidence =
  0.35 * dictionaryDeltaScore +
  0.25 * ngramDeltaScore +
  0.20 * reversedCommonTokenScore +
  0.10 * punctuationImprovementScore +
  0.10 * casingBoundaryScore
```
Each sub-score is normalized to `[0.0, 1.0]`. The result is compared against the configurable threshold (default `0.75`). Weights are tunable via the regression suite.

#### 5.3.7 Corpus (tiered scorer)
1. Tiny built-in stopword + reversed-token detector.
2. Bundled medium English word-frequency list (permissively licensed, compressed size capped, attribution in `NOTICE.md`).
3. Optional local n-gram model.
4. **No remote model in V1.**

#### 5.3.8 Exclusion Rules — never auto-reverse
URLs · email addresses · code blocks · inline code · math expressions · tokens under 3 chars · proper names unless part of a longer reversed phrase · password/secure inputs · `script`/`style`/`noscript`/`textarea`/hidden elements · BiDi text — including nodes under a CSS `direction: rtl` / `unicode-bidi` context, not only RTL scripts · non-English content unless a language pack is enabled.

**V1 granularity note:** V1 excludes URLs/emails at the **segment** level — a block containing a URL or email is skipped entirely rather than reversing the block and preserving just the URL token. This is conservative (no risk of mangling a link, at the cost of skipping an otherwise-reversible paragraph that happens to mention one). Token-level exclusion (reverse the prose, leave the URL token intact) is a documented post-V1 follow-up.

### 5.4 Transformation Logic

#### 5.4.1 Full-String Reverse
For an entirely-reversed block. `.melborp eht evlos lliw eW` → `We will solve the problem.`
**In-place auto-apply only for single-text-node blocks** (see §5.5). Multi-node blocks → preview/copy.

#### 5.4.2 Token-Level Reverse (punctuation-aware)
For individually-reversed words in correct order. Each token is split into `leadingPunctuation + core + trailingPunctuation`; only the core is reversed:
```
reverse("melborp.") -> "problem."   (NOT ".problem")
```
`eW lliw evlos eht melborp.` → `We will solve the problem.`

#### 5.4.3 Unicode-Safe Reversal
All reversal operates on **grapheme clusters**, not UTF-16 code units. Use `Intl.Segmenter(undefined, { granularity: "grapheme" })` (guaranteed available on Chrome MV3). `text.split('').reverse().join('')` is prohibited.

#### 5.4.4 Hybrid / Assisted Repair (preview-only)
OCR/extraction-mangled text: normalize obvious reversed words, leave uncertain phrases unchanged, mark low-confidence segments in preview, and let the user apply full-reverse / word-reverse / no-change. **Never auto-mutates the DOM.**

The transformation mode (full vs. token vs. hybrid) is chosen by comparing the scores of each candidate form (§5.19).

### 5.5 DOM Handling
1. Traverse text nodes with `TreeWalker`.
2. Skip hidden / `script` / `style` / `template` / `noscript` / `textarea` nodes.
3. Preserve HTML tags, inline formatting, hyperlinks, images, captions, heading hierarchy.
4. Do not break event handlers; avoid rewriting whole `innerHTML`.
5. Use **text-node replacement**, never HTML-string injection.
6. Store original text-node values for undo.

**Inline-element / link preservation (V1 rule):**
- Single text-node blocks → may normalize in place.
- In-node word-level reversal → may normalize in place.
- Multi-node full-block reversal → **preview only** (and copy-as-cleaned-text).
- In-place mutation across links or styled spans → **requires explicit user confirmation**; default is preview/copy.

### 5.6 Undo and Revert
1. Store original text per modified text node.
2. Restore all nodes modified **within an operation** on undo.
3. Support undo for whole-page, visible-section, and selection normalization.
4. Clear undo cache on navigation.
5. Notify when no undo state exists.
6. Undo cache is memory-bounded; if a single operation would exceed the bound, **cap the operation and warn the user** rather than silently dropping restore data (reconciles bounded cache vs. full restore).

### 5.7 Preview Panel (injected side panel)
Rendered as an **injected in-page side panel/overlay**, not the toolbar popup (popups are size-constrained and close on blur).

Columns: Location (readable section label/path) · Confidence (high/medium/low) · Original · Proposed Fix · Mode (full/word/hybrid) · Action (apply/ignore/edit).

Actions: apply all high-confidence · apply selected · ignore selected · edit proposed text · copy proposed · export cleaned article. Large result sets are virtualized.

### 5.8 Clean Article Extraction
Preserve title, byline, section headings, body paragraph order, image captions. Optionally remove duplicate captions. Exclude nav/ads/cookie banners/widgets where possible. Plain text default; Markdown export optional:
```markdown
# Article Title
By Author Name

Body paragraph...

## Section Heading
More body text...
```

### 5.9 Duplicate Caption / Paragraph Handling
Detect: exact duplicates · whitespace-normalized near-duplicates · back-to-back repeated captions · same paragraph repeated within a small distance.
Setting "Remove duplicate paragraphs when copying cleaned text": default **on** for copy/export, **off** for in-page transformation.

### 5.10 User Interface

**5.10.1 Toolbar popup** — page scan status; counts of reversed segments / high-confidence / medium-confidence fixes; buttons: Scan, Normalize Page, Preview Fixes, Normalize Selection, Copy Cleaned Text, Undo, Settings. (Primary actions and status only — detailed review happens in the side panel.)

**5.10.2 Inline highlighting** — high = green outline, medium = amber, low = gray; removable; must not rely on color alone (also use an icon/label, see §5.15).

**5.10.3 Context menu** — Normalize reversed text · Copy normalized text · Preview normalized text.

### 5.11 Settings
| Setting | Default | Description |
|---|---|---|
| Auto-scan page on activation | Enabled | Scan after toolbar activation |
| Auto-normalize high-confidence segments | Disabled | Opt-in; only in-place-safe segments |
| Show preview for medium confidence | Enabled | Prevents bad transforms |
| Remove duplicate paragraphs on copy | Enabled | Article cleanup |
| Preserve original page styling | Enabled | Avoid layout disruption |
| Process dynamically loaded content | Enabled | Same-session observer after activation |
| Maximum text nodes per scan | 10,000 | Performance guardrail |
| Minimum segment length | 20 chars | Avoid false positives |
| Confidence threshold | 0.75 | Required for auto-fix |
| Local-only processing | Enabled | No server calls |

Settings stored in `chrome.storage.sync`. **Note quota** (~8KB/item, ~100KB total): future "user correction memory" must use `storage.local` or chunking, not `sync`. Settings carry a schema `version` for migration.

### 5.12 Privacy
1. Local processing by default.
2. No article text transmitted externally without explicit opt-in.
3. No analytics collect page text.
4. Settings may use `chrome.storage.sync`.
5. User corrections stay local unless export/sync explicitly enabled.
6. No browsing-history collection beyond the active-tab operation.

### 5.13 Security
1. No `eval`. 2. No remote scripts. 3. Strict CSP (rely on MV3 defaults; do not relax). 4. Sanitize any text shown in extension UI. 5. Never replace page HTML with unsanitized strings. 6. Text-node replacement, not HTML injection. 7. No access to password/secure inputs. 8. Skip Chrome-restricted URLs: `chrome://`, `edge://`, `about:`, Chrome Web Store pages.

> Note: MV3 already enforces a strict CSP and bans remote code; items 1–3 are largely platform-guaranteed — the requirement is "do not weaken the defaults."

### 5.14 Accessibility
1. Popup keyboard-navigable. 2. Side panel screen-reader accessible. 3. Accessible labels on buttons. 4. Highlights not color-only (icon/label too). 5. Support high-contrast modes. 6. Configurable keyboard shortcut. 7. In-place transformation must not steal focus from active elements.

### 5.15 Performance
1. Initial scan goal ≤ 500 ms on a typical article page (treated as a target, validated by benchmark; revisit once coherence scoring is added). 2. Batch large pages. 3. Avoid layout thrashing. 4. Debounce `MutationObserver`. 5. Cap scan size; warn on extremely large pages. 6. Virtualize large preview sets. 7. Memory-bounded undo cache (see §5.6.6).

### 5.16 Error Handling
Clear messages for: no reversed text detected · unsupported page type · selection unavailable · clipboard write failed · page too large · missing permission for current page · no undo state.
Example: `No high-confidence reversed text was detected. Try selecting the garbled paragraph and using "Normalize selection."`

### 5.17 Keyboard Shortcut
Default avoids browser-reserved commands (**not** `Ctrl/Cmd+Shift+R` — that is hard-reload):
- Windows/Linux: `Ctrl+Shift+U`
- macOS: `Command+Shift+U`

If Chrome cannot assign it, surface instructions to set it manually at `chrome://extensions/shortcuts`. Also declare `_execute_action` so the popup is keyboard-openable.

### 5.18 Edge Cases
Mixed normal/reversed paragraphs · mixed sentences within a paragraph (requires sentence segmentation, §5.19) · reversed quotes/apostrophes/smart-quotes/em-dashes · reversed names/numbers/dates · duplicated captions · text split across spans · lazy-loaded sections · shadow DOM where accessible · same-origin iframes · cross-origin iframes (access restricted — skip) · infinite scroll · reader-mode pages · CMS hidden text · copy-protected pages · CSS `rtl`/bidi contexts (skip) · non-English (disabled unless language pack).

### 5.19 Detection/Transformation Flow
1. User activates scan. 2. Content script collects candidate text nodes. 3. Group into logical blocks; segment paragraphs into sentences where mixed content is possible. 4. Score each segment in three forms — original, full-string-reversed, word-by-word-reversed — using §5.3. 5. Select best-scoring form. 6. High confidence + in-place-safe → mark fixable. 7. Medium, or any multi-node/linked block → preview. 8. Low → ignore. 9. User applies. 10. Store undo state. 11. Replace only affected text nodes. 12. Optionally generate cleaned article output.

### 5.20 Manifest V3
```json
{
  "manifest_version": 3,
  "name": "Reversed Text Normalizer",
  "version": "1.0.0",
  "description": "Detects and normalizes reversed text on webpages.",
  "permissions": ["activeTab", "scripting", "contextMenus", "storage"],
  "host_permissions": [],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html", "default_title": "Normalize reversed text" },
  "options_page": "options.html",
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Ctrl+Shift+Y", "mac": "Command+Shift+Y" },
      "description": "Open the Normalizer popup"
    },
    "normalize-selection": {
      "suggested_key": { "default": "Ctrl+Shift+U", "mac": "Command+Shift+U" },
      "description": "Normalize selected reversed text"
    }
  }
}
```

---

## 6. Test Requirements

### 6.1 Definition of "full coverage"
Full coverage means **every declared feature, exclusion rule, edge case, and transformation mode has corresponding unit, integration, and regression tests** — *not* "corrects every possible mangled article."

### 6.2 Unit Tests
Full-string reversal · word-by-word reversal (punctuation-aware) · grapheme-safe reversal · mixed-paragraph detection · confidence scoring (formula + weights) · punctuation correction · smart-quote handling · URL/code exclusion · BiDi/`rtl` exclusion · duplicate-paragraph detection · Markdown export.

### 6.3 Integration Tests
Static article · article with images/captions · duplicated captions · inline links · dynamic content loading · selection-only · iframes · shadow DOM · forms/editable fields · comments.

### 6.4 Regression Fixtures
Normal-only · reversed-only · mixed · **OCR-mangled reversed text (real, not clean reversal)** · news article with headings/byline/captions/body · 100+ paragraph article · article with dates/names/locations · article with code snippets that must not be reversed · **Unicode fixtures: emoji, combining marks, smart quotes, em dashes, accented characters, mixed punctuation**.

### 6.5 Acceptance Examples
Clean reversal:
```
Input:  BRUNSWICK — Turn them off? Take them down?
        .melborp eht evlos lliw eW
Output: BRUNSWICK — Turn them off? Take them down?
        We will solve the problem.
```
Punctuation-aware token reversal: `eW lliw evlos eht melborp.` → `We will solve the problem.`
OCR-mangled input: routed to **preview**, not auto-applied (asserts no silent DOM mutation).

### 6.6 Quality Gate
Define a **measurable false-positive bar**: e.g. ≤ N false reversals across the normal-only regression corpus of M article pages. "Acceptably low" is not a release criterion.

---

## 7. Suggested Architecture

| Module | Responsibility |
|---|---|
| `manifest.json` | MV3 manifest |
| `background.js` | Service worker: context menu, command routing |
| `scanner.ts` | Find candidate text nodes (TreeWalker) |
| `detector.ts` | Score original vs. reversed; confidence formula |
| `normalizer.ts` | Full / token (punctuation-aware) / hybrid reversal, grapheme-safe |
| `domWriter.ts` | Safe text-node updates + in-place-safety checks |
| `undoStore.ts` | Per-operation original text, bounded |
| `articleExtractor.ts` | Cleaned copy/export (plain + Markdown) |
| `dedupe.ts` | Duplicate-paragraph removal |
| `corpus/` | Bundled word-frequency list + n-gram table (+ `NOTICE.md`) |
| `popup.tsx` | Toolbar UI (status + primary actions) |
| `sidePanel.tsx` | Injected preview/diff/apply UI |
| `settings.ts` | Preferences (versioned schema) |
| `fixtures/` | Test fixture suite |

---

## 8. Release Criteria (V1)
1. Whole-page scan works on static article pages.
2. Selection normalization works.
3. Undo works reliably (per §5.6).
4. Preview side panel works.
5. Copy cleaned text works.
6. Duplicate-caption removal works on copy/export.
7. False-positive bar (§6.6) met on the normal-article corpus.
8. No page text leaves the browser.
9. Grapheme-safe + punctuation-aware reversal verified by fixtures.
10. Multi-node/linked blocks are never silently mutated in place.
11. Unit + integration + regression suites pass.
12. Chrome Web Store privacy disclosure complete.

---

## 9. V1 Scope Summary

**In:** manual page scan · selection normalize (context menu) · same-session observer after activation · grapheme-safe full-string reverse · punctuation-aware token reverse · defined confidence scoring · injected side-panel preview · per-operation undo · copy cleaned text · local-only processing.

**Out / deferred:** per-site auto mode · page-load auto-run · broad host permissions · in-place mutation across links/spans · OCR/contextual reconstruction · LLM-based repair · non-English detection · PDF/image OCR.

---

## 10. Future Enhancements
Firefox/Edge support (reinstate `Array.from` reversal fallback then) · optional local language-model scoring · additional languages · PDF text-layer support · image/screenshot OCR · reader-mode cleaned view · site-specific rules · user-correction memory (`storage.local`) · batch processing of saved HTML · side-by-side original/cleaned reading mode.
