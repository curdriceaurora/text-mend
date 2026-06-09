# Third-Party Notices

## Bundled English word list (`src/core/corpus-data.js`)

The frequency-ranked word list bundled at `src/core/corpus-data.js` is generated from:

- **hermitdave/FrequencyWords** — <https://github.com/hermitdave/FrequencyWords>
  The compilation/code is licensed under the **MIT License**.
- **Upstream data:** the frequency counts derive from the **OpenSubtitles** corpus as
  distributed by the **OPUS** project (P. Lison & J. Tiedemann, *OpenSubtitles2016*, LREC
  2016). Only a derived list of common English **words** is bundled here — no subtitle
  text, lines, or dialogue are included or redistributed. Word frequencies are used solely
  as a local heuristic signal.

`tools/build-corpus.mjs` fetches the 2018 English list (`en_50k.txt`) **pinned to a specific
upstream commit** and **verifies it against a known SHA-256** before use, keeps the top
20,000 alphabetic words (length 2–15) minus a profanity/non-English denylist, and writes
them as a compact ES module. Regenerate with:

```bash
npm run build:corpus     # or: node tools/build-corpus.mjs
```

A small curated supplement in `src/core/corpus.js` adds tool-specific terms (e.g.
`reversed`, `normalize`) that may fall outside the frequency cut. No article- or
domain-specific vocabulary is hardcoded; common nouns are present only because the
frequency list includes them.

The list is used purely for local heuristic scoring; no text ever leaves the browser.
