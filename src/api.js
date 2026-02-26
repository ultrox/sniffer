export function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

export function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs[0] ?? null);
    });
  });
}

export function updateTab(tabId, props) {
  return chrome.tabs.update(tabId, props);
}

export function sendToTab(tabId, msg) {
  chrome.tabs.sendMessage(tabId, msg);
}

export function storageGet(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

export function storageSet(data) {
  return chrome.storage.local.set(data);
}
