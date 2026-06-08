# Third-Party Notices

## Bundled English word list (`src/core/corpus.js`)

The current corpus is a small, hand-curated list of high-frequency English words
authored for this project and released under the project's MIT license. It contains
no domain-specific vocabulary.

For production, replace it with a larger permissively-licensed frequency list (e.g. a
public-domain or MIT/CC0 frequency corpus) and document the source, version, and license
here. The scoring API in `src/core/detect.js` does not change when the corpus is swapped.
