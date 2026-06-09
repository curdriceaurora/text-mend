// Guards the web_accessible_resources contract: every module reachable by static import
// from the INJECTED content script must be web-accessible, or it fails to load in a real
// page. (This caught a real gap: dom-normalize.js/settings.js were imported but not listed.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

// Build matchers from the WAR globs (only "*" wildcard is used here).
const warGlobs = manifest.web_accessible_resources.flatMap((e) => e.resources);
const warMatchers = warGlobs.map((g) => new RegExp('^' + g.replace(/[.]/g, '\\.').replace(/\*/g, '[^/]*') + '$'));
const isWebAccessible = (rel) => warMatchers.some((re) => re.test(rel));

// Transitively collect src/ modules statically imported starting from content.js.
function collectGraph(entryRel) {
  const seen = new Set();
  const stack = [entryRel];
  while (stack.length) {
    const rel = stack.pop();
    if (seen.has(rel)) continue;
    seen.add(rel);
    const src = readFileSync(resolve(ROOT, rel), 'utf8');
    const importRe = /(?:import|export)[^'"]*?from\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const m of src.matchAll(importRe)) {
      const spec = m[1] || m[2];
      if (!spec || !spec.startsWith('.')) continue;
      const dep = relative(ROOT, resolve(dirname(resolve(ROOT, rel)), spec));
      stack.push(dep);
    }
  }
  return seen;
}

test('every module imported by the injected content script is web-accessible', () => {
  const graph = collectGraph('src/extension/content.js');
  const missing = [...graph].filter((rel) => !isWebAccessible(rel));
  assert.deepEqual(missing, [], `not in web_accessible_resources:\n${missing.join('\n')}`);
});

test('content.js itself is web-accessible (dynamically imported into the page)', () => {
  assert.ok(isWebAccessible('src/extension/content.js'));
});
