// Popup controller. Uses activeTab (granted by this user gesture) to inject the content
// loader, then messages it. Status text is set via textContent (never innerHTML) so page-
// derived strings can never inject markup.

const RESTRICTED = /^(chrome|edge|about|chrome-extension|devtools):|^https:\/\/chrome\.google\.com\/webstore/;
const statusEl = document.getElementById('status');

// Injected into the page; awaited by executeScript so the content listener exists before
// we message it (mirrors background.js — avoids the inject/send race).
function loadContentModule() {
  if (window.__rtnLoaded) return undefined;
  window.__rtnLoaded = true;
  return import(chrome.runtime.getURL('src/extension/content.js'));
}

function setStatus(text) {
  statusEl.textContent = text;
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function send(type) {
  const tab = await activeTab();
  if (!tab?.id || RESTRICTED.test(tab.url ?? '')) {
    setStatus('This page can’t be processed.');
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: loadContentModule });
    const res = await chrome.tabs.sendMessage(tab.id, { type });
    report(type, res);
  } catch (err) {
    setStatus('Could not run on this page.');
    console.error(err);
  }
}

function report(type, res) {
  if (!res?.ok) {
    setStatus('Nothing to do.');
    return;
  }
  switch (type) {
    case 'scan':
      setStatus(`${res.total} text segments · ${res.applied} high-confidence · ${res.preview} need review.`);
      break;
    case 'normalize-page':
      setStatus(
        res.applied || res.preview
          ? `Normalized ${res.applied}. ${res.preview} routed to review (multi-node/links).`
          : 'No high-confidence reversed text detected.',
      );
      break;
    case 'normalize-selection':
      setStatus(res.applied ? 'Selection normalized.' : res.copied ? 'Copied normalized text.' : 'No reversed text in selection.');
      break;
    case 'undo':
      setStatus(res.restored ? `Restored ${res.restored} segments.` : 'Nothing to undo.');
      break;
    case 'copy-cleaned':
      setStatus(res.copied ? 'Cleaned article copied.' : 'Nothing to copy.');
      break;
    default:
      setStatus('Done.');
  }
}

document.getElementById('scan').addEventListener('click', () => send('scan'));
document.getElementById('normalize').addEventListener('click', () => send('normalize-page'));
document.getElementById('selection').addEventListener('click', () => send('normalize-selection'));
document.getElementById('copy').addEventListener('click', () => send('copy-cleaned'));
document.getElementById('undo').addEventListener('click', () => send('undo'));
document.getElementById('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
