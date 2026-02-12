// --- State ---
let sniffing = false;
let requests = [];
let targetTabId = null;

let recording = false;
let recordTabId = null;
let recordEntries = [];
let recordFilters = ["xhr", "fetch"];

let replaying = false;
let replayTabId = null;
let replayRecordingId = null;

let recordings = [];

const TYPE_MAP = {
  xmlhttprequest: "xhr",
  stylesheet: "css",
  script: "script",
  image: "img",
  font: "font",
  media: "media",
  websocket: "media",
  main_frame: "doc",
  sub_frame: "doc",
  object: "other",
  ping: "other",
  csp_report: "other",
  other: "other",
};

chrome.storage.local.get(["recordings", "recordFilters"], (res) => {
  recordings = res.recordings || [];
  if (res.recordFilters) recordFilters = res.recordFilters;
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
      recordings: recordings.map((r) => ({
        id: r.id,
        name: r.name,
        timestamp: r.timestamp,
        count: r.entries.length,
      })),
      replayRecordingId,
      recordEntries,
      recordFilters,
    });
    return true;
  }

  if (msg.type === "setFilters") {
    recordFilters = msg.filters;
    chrome.storage.local.set({ recordFilters });
    sendResponse({ recordFilters });
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
    recordFilters = msg.filters || recordFilters;
    chrome.storage.local.set({ recordFilters });
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      recordTabId = tabs[0]?.id ?? null;
      if (recordTabId) sendToTab(recordTabId, "record", []);
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
      entries: recordEntries,
    };
    recordings.push(rec);
    chrome.storage.local.set({ recordings });
    recordEntries = [];
    if (recordTabId) sendToTab(recordTabId, null, []);
    recordTabId = null;
    sendResponse({ recording: false });
    updateIcon();
    return true;
  }

  // Captured entry from content script (fetch/xhr)
  if (msg.source === "sniffer-intercept" && msg.type === "captured") {
    if (recording && msg.entry) {
      const cat = msg.entry.kind; // 'fetch' or 'xhr'
      if (recordFilters.includes(cat)) {
        recordEntries.push(msg.entry);
      }
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
    sendResponse({});
    return true;
  }

  if (msg.type === "renameRecording") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec) {
      rec.name = msg.name;
      chrome.storage.local.set({ recordings });
    }
    sendResponse({});
    return true;
  }

  // Recording detail (entries are large, fetched separately)
  if (msg.type === "getRecording") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    sendResponse(rec || null);
    return true;
  }

  // Edit entry in a saved recording
  if (msg.type === "updateEntry") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec && msg.index >= 0 && msg.index < rec.entries.length) {
      Object.assign(rec.entries[msg.index], msg.updates);
      chrome.storage.local.set({ recordings });
    }
    sendResponse({});
    return true;
  }

  if (msg.type === "deleteEntry") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec && msg.index >= 0 && msg.index < rec.entries.length) {
      rec.entries.splice(msg.index, 1);
      chrome.storage.local.set({ recordings });
    }
    sendResponse({});
    return true;
  }

  // Bridge init
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

// --- webRequest listeners ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    // Sniffing
    if (sniffing) {
      if (targetTabId === null || details.tabId === targetTabId) {
        requests.push({
          method: details.method,
          url: details.url,
          type: details.type,
          time: Date.now(),
        });
        chrome.storage.local.set({ requests });
      }
    }
  },
  { urls: ["<all_urls>"] }
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    // Sniffing - update status
    if (sniffing) {
      if (targetTabId === null || details.tabId === targetTabId) {
        const entry = requests.find(
          (r) => r.url === details.url && !r.status
        );
        if (entry) {
          entry.status = details.statusCode;
          chrome.storage.local.set({ requests });
        }
      }
    }

    // Recording - capture non-XHR types (XHR/fetch handled by content script)
    if (recording && details.tabId === recordTabId) {
      const cat = TYPE_MAP[details.type] || "other";
      if (cat === "xhr") return; // content script handles
      if (!recordFilters.includes(cat)) return;

      captureResource(details, cat);
    }
  },
  { urls: ["<all_urls>"] }
);

async function captureResource(details, cat) {
  const entry = {
    url: details.url,
    method: details.method,
    status: details.statusCode,
    statusText: "",
    kind: cat,
    time: Date.now(),
    body: "",
    headers: {},
  };

  try {
    const res = await fetch(details.url);
    entry.body = await res.text();
    entry.headers = Object.fromEntries(res.headers.entries());
  } catch {}

  recordEntries.push(entry);
}

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
