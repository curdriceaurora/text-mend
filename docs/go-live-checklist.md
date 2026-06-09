# Go-Live Checklist — Text Mend

Status legend: `[x]` done in repo · `[ ]` pending action · `[~]` partial / needs verification.

**Current readiness:** Chrome is **submission-ready after packaging + listing assets**. Firefox
needs a **porting pass first** (the codebase is Chrome-targeted; see §F0). Both share the same
privacy story: 100% local, no network calls, no analytics, no remote code.

---

## A. Shared pre-submission (both stores)

### Code & build
- [x] Manifest V3, `version` `1.0.0`, `name` "Text Mend", description ≤132 chars.
- [x] Icons 16/32/48/128 present and referenced (`icons/`, `action.default_icon`, `icons`).
- [x] No remote code / no `eval` (MV3-enforced; verified by review).
- [x] No network requests at runtime; all processing local (corpus bundled in `corpus-data.js`).
- [x] Tests green: `npm test` (107) + `npm run test:e2e` (5, real Chrome).
- [ ] **Bump a real release version** if iterating (keep `1.0.0` for first launch).
- [ ] **Produce a clean package** containing ONLY: `manifest.json`, `src/`, `icons/`. Exclude
      `node_modules/`, `test/`, `tools/`, `docs/`, `tasks/`, `.git/`, `package*.json`,
      `fixtures/`. (Reuse the e2e staging approach in `test/e2e/regression.e2e.mjs` —
      `manifest.json` + `src/` + `icons/` — as the zip contents.)
- [ ] Confirm the packaged zip loads unpacked with zero manifest warnings.

### Listing copy (from `docs/store-listing.md`)
- [x] Name, per-platform subtitles, short description finalized.
- [ ] **Long description** (feature list, "local-only / no tracking", how-to). Draft pending.
- [ ] **Single-purpose statement:** "Detects and repairs garbled article text (reversed,
      mojibake, broken line wraps) and shows a clean reader view." (Chrome requires one.)

### Assets (NOT yet created)
- [ ] **Screenshots** — 1280×800 (or 640×400), 1–5 images: (1) reader view repairing an
      article, (2) preview panel with a fix, (3) a correction being saved, (4) options page.
      Capture against `fixtures/v15-news.html` for a clean, shareable example.
- [ ] Store icon 128×128 (reuse `icons/icon128.png`) — verify it reads well at store scale.
- [ ] (Optional) Chrome promo tile 440×280; AMO has no required promo tile.

### Privacy & legal
- [ ] **Privacy policy URL** — host a short page (needs a domain; `textmend.com` is taken — see
      `docs/store-listing.md` for alternates). Content: "Text Mend processes page text locally
      in your browser. It stores your settings and any corrections you make in local browser
      storage on your device only. It does not transmit, sell, or share any data. No analytics."
- [ ] **Trademark clearance** (optional but recommended before filing) — Mend.io adjacency noted
      in `docs/store-listing.md`.
- [x] Permissions are minimal: `activeTab`, `scripting`, `contextMenus`, `storage`; empty
      `host_permissions` (avoids broad-host review).

### Permission justifications (reuse for both stores)
- [ ] `activeTab` — "Read and repair text on the page the user explicitly invokes the extension on."
- [ ] `scripting` — "Inject the content module into the active tab on user action to scan/repair text."
- [ ] `contextMenus` — "Right-click actions: normalize selection, open reader view."
- [ ] `storage` — "Save user settings and local-only correction memory."
- [ ] Host permissions — "None requested; the extension only acts on the active tab after a user gesture."

---

## B. Chrome Web Store

### Account
- [ ] Developer account registered + **one-time $5 fee** paid; 2FA enabled.
- [ ] Verified contact email on the developer account.

### Listing
- [ ] Item name: **Text Mend**; summary: *Text Mend: Repair Reversed and Garbled Articles* (≤132).
- [ ] Long description + screenshots uploaded; category **Productivity** (or Tools); language English.
- [ ] Single-purpose field completed (see §A).

### Privacy tab (Chrome is strict here — common rejection cause)
- [ ] Data collection disclosures: select **does not collect** user data (local storage ≠ transmission).
- [ ] "Limited use" certification.
- [ ] Per-permission justification strings entered (see §A).
- [ ] Privacy policy URL entered.

### Submit
- [ ] Upload zip → fill listing → **Submit for review** (typical review: hours–days).
- [ ] Save the item ID and dashboard link.

### Post-launch
- [ ] Monitor review status; if rejected, the usual culprits are permission justification, the
      single-purpose statement, or a missing privacy policy — address and resubmit.
- [ ] After publish: verify the live listing installs and works on a fresh profile.

---

## F. Firefox Add-ons (AMO)

### F0. Porting prerequisites (DO FIRST — the code is Chrome-targeted)
- [ ] **`browser_specific_settings.gecko.id`** (required by AMO) + `gecko.strict_min_version`
      (Firefox ≥ 115 for `storage.session`; verify the others). Example:
      `"browser_specific_settings": { "gecko": { "id": "text-mend@<domain>", "strict_min_version": "121.0" } }`.
- [ ] **`chrome.*` promise calls won't work under Firefox.** The code uses `await chrome.storage…`,
      `await chrome.tabs…`, etc. Firefox's `chrome.*` is callback-style; promises come from
      `browser.*`. Add `webextension-polyfill` (or switch to `browser.*`) so awaited calls resolve.
      This is the largest porting task — touches `content.js`, `corrections-store.js`,
      `background.js`, `popup.js`, `options.js`, `reader-page.js`, `settings.js`.
- [ ] **Background:** Firefox MV3 prefers `background.scripts` (event page). Verify
      `background.service_worker` runs on the target Firefox, or add a `scripts` fallback.
- [ ] **Content injection:** the dynamic `import(chrome.runtime.getURL('src/extension/content.js'))`
      loader pattern + `web_accessible_resources` must be re-verified under Firefox (moz-extension
      module loading differs); adjust if `executeScript({func})` + dynamic import doesn't resolve.
- [ ] **Re-run the e2e equivalent under Firefox** (`web-ext run` / a Firefox puppeteer or
      Playwright pass) — the current e2e is Chrome-only (`installExtension`).
- [ ] `npx web-ext lint` passes with no errors.

### Account & listing
- [ ] AMO developer account (free) + 2FA.
- [ ] Listing name **Text Mend**; summary *Text Mend: Clean Reader for Broken Article Text*.
- [ ] Description, categories, screenshots (reuse §A assets), icon.
- [ ] Privacy policy URL + data-collection disclosure (none transmitted; local only).

### Source code (AMO requirement)
- [x] No minification/obfuscation — plain ES modules, reviewer-readable.
- [ ] If asked, provide build notes: `corpus-data.js` is generated by `tools/build-corpus.mjs`
      (pinned source + SHA-256, see `NOTICE.md`); tests via `npm test`. Include this in the
      "notes to reviewer" / source-submission field.

### Submit
- [ ] Build the Firefox zip (post-port), upload to AMO, choose **listed** distribution.
- [ ] Submit for review; respond to reviewer notes.

### Post-launch
- [ ] Verify install + reader/repair flow on a fresh Firefox profile.

---

## Recommended order

1. Chrome: package → screenshots → privacy policy URL → submit. (Lowest effort to first launch.)
2. Firefox: complete §F0 porting on a branch (TDD, mirror the Chrome e2e under Firefox) →
   then listing → submit.

Track this file's checkboxes as the live launch state; update `tasks/todo.md`/this doc as items close.
