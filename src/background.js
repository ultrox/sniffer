// --- State ---
let sniffing = false;
let requests = [];
let targetTabId = null;

let recording = false;
let recordTabId = null;
let recordSourceUrl = null;
let recordEntries = [];
let recordFilters = ["xhr", "fetch"];
let ignorePatterns = []; // working set, saved with recording on stop

// { recordingId: tabId } — supports multiple simultaneous replays
let activeReplays = {};
let replayHitCount = 0;

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

chrome.storage.local.get(
  ["recordings", "recordFilters", "ignorePatterns"],
  (res) => {
    recordings = res.recordings || [];
    if (res.recordFilters) recordFilters = res.recordFilters;
    if (res.ignorePatterns) ignorePatterns = res.ignorePatterns;
    updateIcon();
  }
);

function isIgnored(url) {
  return ignorePatterns.some((p) => {
    if (p.startsWith("/") && p.lastIndexOf("/") > 0) {
      const end = p.lastIndexOf("/");
      try {
        return new RegExp(p.slice(1, end), p.slice(end + 1)).test(url);
      } catch {
        return url.includes(p);
      }
    }
    return url.includes(p);
  });
}

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
      replaying: hasActiveReplays(),
      recordings: recordings.map((r) => ({
        id: r.id,
        name: r.name,
        timestamp: r.timestamp,
        sourceUrl: r.sourceUrl,
        count: r.entries.length,
      })),
      activeReplays,
      replayHitCount,
      recordEntries,
      recordFilters,
      ignorePatterns,
    });
    return true;
  }

  if (msg.type === "setFilters") {
    recordFilters = msg.filters;
    chrome.storage.local.set({ recordFilters });
    sendResponse({ recordFilters });
    return true;
  }

  if (msg.type === "addIgnore") {
    if (msg.pattern && !ignorePatterns.includes(msg.pattern)) {
      ignorePatterns.push(msg.pattern);
      chrome.storage.local.set({ ignorePatterns });
    }
    sendResponse({ ignorePatterns });
    return true;
  }

  if (msg.type === "removeIgnore") {
    ignorePatterns = ignorePatterns.filter((p) => p !== msg.pattern);
    chrome.storage.local.set({ ignorePatterns });
    sendResponse({ ignorePatterns });
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
      recordSourceUrl = tabs[0]?.url ?? null;
      if (recordTabId) sendToTab(recordTabId, "record", []);
    });
    sendResponse({ recording: true });
    updateIcon();
    return true;
  }

  if (msg.type === "stopRecord") {
    recording = false;
    if (recordEntries.length > 0) {
      const rec = {
        id: Date.now().toString(),
        name: `Recording ${recordings.length + 1}`,
        timestamp: Date.now(),
        sourceUrl: recordSourceUrl,
        ignorePatterns: [...ignorePatterns],
        entries: recordEntries,
      };
      recordings.push(rec);
      chrome.storage.local.set({ recordings });
    }
    recordEntries = [];
    if (recordTabId) sendToTab(recordTabId, null, []);
    recordTabId = null;
    sendResponse({ recording: false });
    updateIcon();
    return true;
  }

  // Replay hit from content script
  if (msg.source === "sniffer-intercept" && msg.type === "replayed") {
    replayHitCount++;
    updateIcon();
    return false;
  }

  // Captured entry from content script (fetch/xhr)
  if (msg.source === "sniffer-intercept" && msg.type === "captured") {
    if (recording && msg.entry) {
      if (isIgnored(msg.entry.url)) return false;
      const cat = msg.entry.kind;
      if (recordFilters.includes(cat)) {
        recordEntries.push(msg.entry);
        updateIcon();
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
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0]?.id ?? null;
      if (tabId) {
        activeReplays[msg.recordingId] = tabId;
        syncReplayToTab(tabId);
      }
      updateIcon();
    });
    sendResponse({});
    return true;
  }

  if (msg.type === "stopReplay") {
    const tabId = activeReplays[msg.recordingId];
    delete activeReplays[msg.recordingId];
    if (!hasActiveReplays()) replayHitCount = 0;
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    updateIcon();
    return true;
  }

  if (msg.type === "deleteRecording") {
    const tabId = activeReplays[msg.recordingId];
    if (tabId) {
      delete activeReplays[msg.recordingId];
      syncReplayToTab(tabId);
      updateIcon();
    }
    recordings = recordings.filter((r) => r.id !== msg.recordingId);
    chrome.storage.local.set({ recordings });
    sendResponse({});
    return true;
  }

  if (msg.type === "mergeRecording") {
    const source = recordings.find((r) => r.id === msg.sourceId);
    const target = recordings.find((r) => r.id === msg.targetId);
    if (source && target) {
      target.entries.push(...source.entries);
      recordings = recordings.filter((r) => r.id !== msg.sourceId);
      chrome.storage.local.set({ recordings });
    }
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

  // Recording detail
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

  // Per-recording ignore patterns
  if (msg.type === "addRecordingIgnore") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec) {
      if (!rec.ignorePatterns) rec.ignorePatterns = [];
      if (!rec.ignorePatterns.includes(msg.pattern)) {
        rec.ignorePatterns.push(msg.pattern);
        chrome.storage.local.set({ recordings });
      }
    }
    sendResponse({});
    return true;
  }

  if (msg.type === "removeRecordingIgnore") {
    const rec = recordings.find((r) => r.id === msg.recordingId);
    if (rec && rec.ignorePatterns) {
      rec.ignorePatterns = rec.ignorePatterns.filter(
        (p) => p !== msg.pattern
      );
      chrome.storage.local.set({ recordings });
    }
    sendResponse({});
    return true;
  }

  // Bridge init
  if (msg.source === "sniffer-bridge" && msg.type === "init") {
    const tabId = sender.tab?.id;
    const replayEntries = mergedReplayEntries(tabId);
    if (replayEntries.length > 0) {
      sendResponse({ mode: "replay", entries: replayEntries });
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

function mergedReplayEntries(tabId) {
  const entries = [];
  for (const [recId, tid] of Object.entries(activeReplays)) {
    if (tid !== tabId) continue;
    const rec = recordings.find((r) => r.id === recId);
    if (rec) entries.push(...rec.entries);
  }
  return entries;
}

function syncReplayToTab(tabId) {
  const entries = mergedReplayEntries(tabId);
  if (entries.length > 0) {
    sendToTab(tabId, "replay", entries);
  } else {
    sendToTab(tabId, null, []);
  }
}

function hasActiveReplays() {
  return Object.keys(activeReplays).length > 0;
}

// --- webRequest listeners ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
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

    if (recording && details.tabId === recordTabId) {
      if (isIgnored(details.url)) return;
      const cat = TYPE_MAP[details.type] || "other";
      if (cat === "xhr") return;
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
  updateIcon();
}

function updateIcon() {
  let text = "";
  if (recording) text = `${recordEntries.length}`;
  else if (hasActiveReplays()) text = `${replayHitCount}`;
  else if (sniffing) text = "ON";

  let color = "#999";
  if (recording) color = "#e74c3c";
  else if (hasActiveReplays()) color = "#2ecc71";
  else if (sniffing) color = "#e74c3c";

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}
