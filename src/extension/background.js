// Service worker (module): context menu, keyboard command, and content-script injection.
// V1 is strictly manual-invocation under activeTab — nothing runs without a user gesture.

const MENU_ID = 'normalize-selection';
const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools):|^https:\/\/chrome\.google\.com\/webstore/;

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Normalize reversed text',
    contexts: ['selection'],
  });
});

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
});

chrome.commands.onCommand.addListener(async (command) => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  dispatch(tab, { type: command });
});
