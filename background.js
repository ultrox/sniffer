// --- State ---
let sniffing = false;
let requests = [];
let targetTabId = null;

let recording = false;
let recordTabId = null;
let recordEntries = [];

let replaying = false;
let replayTabId = null;
let replayRecordingId = null;

let recordings = [];

chrome.storage.local.get(["recordings"], (res) => {
  recordings = res.recordings || [];
});

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Sniff
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
    sendResponse({
      sniffing,
      requests,
      recording,
      replaying,
      recordings,
      replayRecordingId,
      recordEntryCount: recordEntries.length,
    });
    return true;
  }

  if (msg.type === "clear") {
    requests = [];
    chrome.storage.local.set({ requests });
    sendResponse({ requests });
    return true;
  }

  // Record
  if (msg.type === "startRecord") {
    recording = true;
    recordEntries = [];
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      recordTabId = tabs[0]?.id ?? null;
      if (recordTabId) {
        sendToTab(recordTabId, "record", []);
      }
    });
    sendResponse({ recording: true });
    updateIcon();
    return true;
  }

  if (msg.type === "stopRecord") {
    recording = false;
    const rec = {
      id: Date.now().toString(),
      name: `Recording ${recordings.length + 1}`,
      timestamp: Date.now(),
      count: recordEntries.length,
      entries: recordEntries,
    };
    recordings.push(rec);
    chrome.storage.local.set({ recordings });
    recordEntries = [];
    if (recordTabId) sendToTab(recordTabId, null, []);
    recordTabId = null;
    sendResponse({ recording: false, recordings });
    updateIcon();
    return true;
  }

  // Captured entry from content script
  if (msg.source === "sniffer-intercept" && msg.type === "captured") {
    if (recording && msg.entry) {
      recordEntries.push(msg.entry);
    }
    return false;
  }

  // Replay
  if (msg.type === "startReplay") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (!rec) {
      sendResponse({ error: "not found" });
      return true;
    }
    replaying = true;
    replayRecordingId = msg.recordingId;
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      replayTabId = tabs[0]?.id ?? null;
      if (replayTabId) sendToTab(replayTabId, "replay", rec.entries);
    });
    sendResponse({ replaying: true });
    updateIcon();
    return true;
  }

  if (msg.type === "stopReplay") {
    replaying = false;
    replayRecordingId = null;
    if (replayTabId) sendToTab(replayTabId, null, []);
    replayTabId = null;
    sendResponse({ replaying: false });
    updateIcon();
    return true;
  }

  if (msg.type === "deleteRecording") {
    recordings = recordings.filter((r) => r.id !== msg.recordingId);
    chrome.storage.local.set({ recordings });
    sendResponse({ recordings });
    return true;
  }

  if (msg.type === "renameRecording") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec) {
      rec.name = msg.name;
      chrome.storage.local.set({ recordings });
    }
    sendResponse({ recordings });
    return true;
  }

  // Bridge init - content script asking for current mode on page load
  if (msg.source === "sniffer-bridge" && msg.type === "init") {
    const tabId = sender.tab?.id;
    if (replaying && tabId === replayTabId) {
      const rec = recordings.find((r) => r.id === replayRecordingId);
      sendResponse({ mode: "replay", entries: rec?.entries || [] });
    } else if (recording && tabId === recordTabId) {
      sendResponse({ mode: "record", entries: [] });
    } else {
      sendResponse({ mode: null });
    }
    return true;
  }
});

function sendToTab(tabId, mode, entries) {
  chrome.tabs.sendMessage(tabId, {
    source: "sniffer-bg",
    type: "setMode",
    mode,
    entries,
  });
}

// --- webRequest listeners (for sniff display) ---
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
    const entry = requests.find((r) => r.url === details.url && !r.status);
    if (entry) {
      entry.status = details.statusCode;
      chrome.storage.local.set({ requests });
    }
  },
  { urls: ["<all_urls>"] }
);

function updateIcon() {
  let text = "";
  if (recording) text = "REC";
  else if (replaying) text = "PLAY";
  else if (sniffing) text = "ON";

  let color = "#999";
  if (recording) color = "#e74c3c";
  else if (replaying) color = "#2ecc71";
  else if (sniffing) color = "#e74c3c";

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
