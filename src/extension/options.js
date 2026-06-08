// Options page: reads/writes the shared, versioned settings schema (§5.11).
import { SCHEMA_VERSION, SETTINGS_DEFAULTS, migrate } from './settings.js';

const fields = {
  autoNormalize: { el: 'autoNormalize', prop: 'checked' },
  dedupeOnCopy: { el: 'dedupeOnCopy', prop: 'checked' },
  threshold: { el: 'threshold', prop: 'value', cast: Number },
  minLength: { el: 'minLength', prop: 'value', cast: Number },
  maxNodes: { el: 'maxNodes', prop: 'value', cast: Number },
};

async function load() {
  const settings = migrate(await chrome.storage.sync.get(SETTINGS_DEFAULTS));
  for (const [key, { el, prop }] of Object.entries(fields)) {
    document.getElementById(el)[prop] = settings[key];
  }
}

async function save() {
  const next = { version: SCHEMA_VERSION };
  for (const [key, { el, prop, cast }] of Object.entries(fields)) {
    const raw = document.getElementById(el)[prop];
    next[key] = cast ? cast(raw) : raw;
  }
  await chrome.storage.sync.set(next);
  const saved = document.getElementById('saved');
  saved.textContent = 'Saved.';
  setTimeout(() => (saved.textContent = ''), 1500);
}

document.addEventListener('DOMContentLoaded', load);
document.querySelectorAll('input').forEach((input) => input.addEventListener('change', save));
