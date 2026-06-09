// Service worker (module): context menu, keyboard command, and content-script injection.
// V1 is strictly manual-invocation under activeTab — nothing runs without a user gesture.

const MENU_ID = 'normalize-selection';
const READER_MENU_ID = 'open-reader-view';
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools):|^https:\/\/chrome\.google\.com\/webstore/;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Normalize reversed text',
    contexts: ['selection'],
  });
  chrome.contextMenus.create({
    id: READER_MENU_ID,
    title: 'Open in reader view',
    contexts: ['page'],
  });
});

// Drop any reader payloads a prior open didn't consume (tab closed before load, SW killed
// mid-flight, tabs.create failed) so captured page HTML can't accumulate in session storage.
async function sweepStaleReaderKeys() {
  try {
    const all = await chrome.storage.session.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith('reader-'));
    if (stale.length) await chrome.storage.session.remove(stale);
  } catch {
    /* best-effort */
  }
}

// Capture the page (read-only), persist it for the reader page, and open the reader tab.
let readerSeq = 0;
async function openReader(tab) {
  if (!tab?.id || !isInjectable(tab.url)) return;
  await ensureContent(tab.id);
  const res = await chrome.tabs.sendMessage(tab.id, { type: 'capture-source' });
  if (!res?.ok) return;
  await sweepStaleReaderKeys();
  const key = `reader-${tab.id}-${readerSeq++}`;
  await chrome.storage.session.set({ [key]: { html: res.html, url: res.url } });
  await chrome.tabs.create({ url: chrome.runtime.getURL(`src/extension/reader.html?key=${key}`) });
}

function isInjectable(url) {
  return !!url && !RESTRICTED.test(url);
}

// Inject and AWAIT the content module so its message listener is registered before we
// send to it (executeScript resolves only after the injected async function settles).
function loadContentModule() {
  if (window.__rtnLoaded) return undefined;
  window.__rtnLoaded = true;
  return import(chrome.runtime.getURL('src/extension/content.js'));
}

async function ensureContent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, func: loadContentModule });
}

async function dispatch(tab, message) {
  if (!tab?.id || !isInjectable(tab.url)) return;
  await ensureContent(tab.id);
  try {
    await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    // Content not ready (rare race); the loader injects synchronously enough in practice.
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID) dispatch(tab, { type: 'normalize-selection' });
  else if (info.menuItemId === READER_MENU_ID) openReader(tab);
});

// The popup routes reader-open through here so there's a single implementation
// (one key scheme, one stale-key sweep).
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'open-reader') return undefined;
  chrome.tabs
    .query({ active: true, currentWindow: true })
    .then(([tab]) => openReader(tab))
    .then(() => sendResponse({ ok: true }), (err) => sendResponse({ ok: false, error: String(err) }));
  return true; // async response
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  dispatch(tab, { type: command });
});
