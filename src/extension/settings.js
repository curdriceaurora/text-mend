// Single source of truth for user settings (requirements §5.11). Imported by the options
// page, the content script, and the DOM adapter so defaults can't drift between them.

export const SCHEMA_VERSION = 2; // v2: added rememberCorrections

export const SETTINGS_DEFAULTS = {
  version: SCHEMA_VERSION,
  autoNormalize: true,
  dedupeOnCopy: true,
  threshold: 0.75,
  minLength: 20,
  maxNodes: 10000,
  rememberCorrections: true, // V2 correction memory; local-only
};

/** Merge stored settings forward over current defaults and stamp the schema version. */
export function migrate(stored) {
  return { ...SETTINGS_DEFAULTS, ...stored, version: SCHEMA_VERSION };
}

/** Read + migrate settings from chrome.storage.sync, falling back to defaults. */
export async function loadSettings() {
  try {
    return migrate(await chrome.storage.sync.get(SETTINGS_DEFAULTS));
  } catch {
    return { ...SETTINGS_DEFAULTS };
  }
}
