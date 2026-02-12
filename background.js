let sniffing = false;
let requests = [];
let targetTabId = null;

chrome.storage.local.get(["sniffing"], (res) => {
  sniffing = res.sniffing || false;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "toggle") {
    sniffing = !sniffing;
    if (sniffing) {
      requests = [];
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        targetTabId = tabs[0]?.id ?? null;
      });
    } else {
      targetTabId = null;
    }
    chrome.storage.local.set({ sniffing, requests });
    sendResponse({ sniffing });
    updateIcon();
    return true;
  }

  if (msg.type === "getState") {
    sendResponse({ sniffing, requests });
    return true;
  }

  if (msg.type === "clear") {
    requests = [];
    chrome.storage.local.set({ requests });
    sendResponse({ requests });
    return true;
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!sniffing) return;
    if (targetTabId !== null && details.tabId !== targetTabId) return;

    requests.push({
      method: details.method,
      url: details.url,
      type: details.type,
      time: Date.now(),
    });

    chrome.storage.local.set({ requests });
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    if (!sniffing) return;
    if (targetTabId !== null && details.tabId !== targetTabId) return;

    const entry = requests.find(
      (r) => r.url === details.url && !r.status
    );
    if (entry) {
      entry.status = details.statusCode;
      chrome.storage.local.set({ requests });
    }
  },
  { urls: ["<all_urls>"] }
);

function updateIcon() {
  chrome.action.setBadgeText({ text: sniffing ? "ON" : "" });
  chrome.action.setBadgeBackgroundColor({ color: sniffing ? "#e74c3c" : "#999" });
}
