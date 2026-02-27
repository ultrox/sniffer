import {
  createInitialState,
  handleToggle,
  handleClear,
  handleSetFilters,
  handleAddIgnore,
  handleRemoveIgnore,
  handleStartRecord,
  handleCreateAndRecord,
  handleStopRecord,
  handleStopRecordInto,
  handleCaptured,
  handleStopReplay,
  handleDeleteRecording,
  handleCopyEntries,
  handleMergeRecording,
  handleRenameRecording,
  handleUpdateEntry,
  handleDedupeEntries,
  handleDeleteEntry,
  handleAddRecordingIgnore,
  handleRemoveRecordingIgnore,
  handleSetOriginGroups,
  handleSetRecordingOriginGroups,
  activeOriginGroupsForRecording,
  handleToggleEntry,
  handleSoloEntry,
  handleToggleAllEntries,
  handleSetActiveVariant,
  handleAddVariant,
  handleDeleteVariant,
  handleRenameVariant,
  handleReplayed,
  handleWebRequestBefore,
  handleWebRequestCompleted,
  shouldCaptureResource,
  mergedReplayEntries,
  hasActiveReplays,
  getStateSnapshot,
} from "./logic/state.js";

let state = createInitialState();

const storageReady = new Promise((resolve) => {
  chrome.storage.local.get(
    ["recordings", "recordFilters", "ignorePatterns", "activeReplays", "originGroups", "recording", "recordTargetId", "recordTabId"],
    (res) => {
      if (res.recordings) state.recordings = res.recordings;
      if (res.recordFilters) state.recordFilters = res.recordFilters;
      if (res.ignorePatterns) state.ignorePatterns = res.ignorePatterns;
      if (res.activeReplays) state.activeReplays = res.activeReplays;
      if (res.originGroups) state.originGroups = res.originGroups;
      if (res.recording) state.recording = res.recording;
      if (res.recordTargetId) state.recordTargetId = res.recordTargetId;
      if (res.recordTabId) state.recordTabId = res.recordTabId;
      updateIcon();
      resolve();
    },
  );
});

function persist(...keys) {
  const data = {};
  for (const k of keys) data[k] = state[k];
  chrome.storage.local.set(data);
}

function sendToTab(tabId, mode, entries, originGroups) {
  chrome.tabs.sendMessage(tabId, {
    source: "sniffer-bg",
    type: "setMode",
    mode,
    entries,
    originGroups: originGroups || [],
  });
}

function resolvedOriginGroupsForTab(state, tabId) {
  const groups = [];
  const seen = new Set();
  for (const [recId, tid] of Object.entries(state.activeReplays)) {
    if (tid !== tabId) continue;
    for (const origins of activeOriginGroupsForRecording(state, recId)) {
      const key = origins.join("\0");
      if (!seen.has(key)) {
        seen.add(key);
        groups.push(origins);
      }
    }
  }
  return groups;
}

function syncReplayToTab(tabId) {
  const entries = mergedReplayEntries(state, tabId);
  const originGroups = resolvedOriginGroupsForTab(state, tabId);
  if (entries.length > 0) {
    sendToTab(tabId, "replay", entries, originGroups);
  } else {
    sendToTab(tabId, null, [], []);
  }
}

// --- Message handler ---
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Wait for storage to load before processing any message
  storageReady.then(() => handleMessage(msg, sender, sendResponse));
  return true; // keep sendResponse channel open for async
});

function handleMessage(msg, sender, sendResponse) {
  if (msg.type === "toggle") {
    state = handleToggle(state);
    if (state.sniffing) {
      getOriginTab().then((tab) => {
        state.targetTabId = tab?.id ?? null;
      });
    }
    persist("sniffing", "requests");
    sendResponse({ sniffing: state.sniffing });
    updateIcon();
    return true;
  }

  if (msg.type === "getState") {
    sendResponse(getStateSnapshot(state));
    return true;
  }

  if (msg.type === "setFilters") {
    state = handleSetFilters(state, msg.filters);
    persist("recordFilters");
    sendResponse({ recordFilters: state.recordFilters });
    return true;
  }

  if (msg.type === "addIgnore") {
    state = handleAddIgnore(state, msg.pattern);
    persist("ignorePatterns");
    sendResponse({ ignorePatterns: state.ignorePatterns });
    return true;
  }

  if (msg.type === "removeIgnore") {
    state = handleRemoveIgnore(state, msg.pattern);
    persist("ignorePatterns");
    sendResponse({ ignorePatterns: state.ignorePatterns });
    return true;
  }

  if (msg.type === "setOriginGroups") {
    state = handleSetOriginGroups(state, msg.groups);
    persist("originGroups");
    // Re-sync any active replay tabs with updated origin groups
    for (const tabId of new Set(Object.values(state.activeReplays))) {
      syncReplayToTab(tabId);
    }
    sendResponse({ originGroups: state.originGroups });
    return true;
  }

  if (msg.type === "setRecordingOriginGroups") {
    state = handleSetRecordingOriginGroups(state, msg.recordingId, msg.groupIds);
    persist("recordings");
    const tabId = state.activeReplays[msg.recordingId];
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "clear") {
    state = handleClear(state);
    persist("requests");
    sendResponse({ requests: state.requests });
    return true;
  }

  if (msg.type === "startRecord") {
    state = handleStartRecord(state, msg.filters, msg.targetId);
    persist("recordFilters", "recording", "recordTargetId");
    getOriginTab().then((tab) => {
      state.recordTabId = tab?.id ?? null;
      state.recordSourceUrl = tab?.url ?? null;
      persist("recordTabId");
      if (state.recordTabId) sendToTab(state.recordTabId, "record", []);
    });
    sendResponse({ recording: true });
    updateIcon();
    return true;
  }

  if (msg.type === "createAndRecord") {
    state = handleCreateAndRecord(state, msg.filters);
    const recordingId = state.recordTargetId;
    persist("recordings", "recordFilters", "recording", "recordTargetId");
    getOriginTab().then((tab) => {
      state.recordTabId = tab?.id ?? null;
      state.recordSourceUrl = tab?.url ?? null;
      // Update the recording's sourceUrl
      state.recordings = state.recordings.map((r) =>
        r.id === recordingId ? { ...r, sourceUrl: state.recordSourceUrl } : r,
      );
      persist("recordings", "recordTabId");
      if (state.recordTabId) sendToTab(state.recordTabId, "record", []);
    });
    sendResponse({ recording: true, recordingId });
    updateIcon();
    return true;
  }

  if (msg.type === "stopRecord") {
    const oldTabId = state.recordTabId;
    state = handleStopRecord(state);
    persist("recordings", "recording", "recordTargetId", "recordTabId");
    if (oldTabId) sendToTab(oldTabId, null, []);
    sendResponse({ recording: false });
    updateIcon();
    return true;
  }

  if (msg.type === "stopRecordInto") {
    const oldTabId = state.recordTabId;
    state = handleStopRecordInto(state, msg.recordingId);
    persist("recordings", "recording", "recordTargetId", "recordTabId");
    if (oldTabId) sendToTab(oldTabId, null, []);
    sendResponse({ recording: false });
    updateIcon();
    return true;
  }

  if (msg.source === "sniffer-intercept" && msg.type === "replayed") {
    state = handleReplayed(state);
    updateIcon();
    return false;
  }

  if (msg.source === "sniffer-intercept" && msg.type === "captured") {
    state = handleCaptured(state, msg.entry);
    updateIcon();
    return false;
  }

  if (msg.type === "startReplay") {
    const rec = state.recordings.find((r) => r.id === msg.recordingId);
    if (!rec) {
      sendResponse({ error: "not found" });
      return true;
    }
    getOriginTab().then((tab) => {
      const tabId = tab?.id ?? null;
      if (tabId) {
        state.activeReplays = {
          ...state.activeReplays,
          [msg.recordingId]: tabId,
        };
        persist("activeReplays");
        syncReplayToTab(tabId);
      }
      updateIcon();
    });
    sendResponse({});
    return;
  }

  if (msg.type === "stopReplay") {
    const tabId = state.activeReplays[msg.recordingId];
    state = handleStopReplay(state, msg.recordingId);
    persist("activeReplays");
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    updateIcon();
    return;
  }

  if (msg.type === "deleteRecording") {
    const tabId = state.activeReplays[msg.recordingId];
    state = handleDeleteRecording(state, msg.recordingId);
    if (tabId) syncReplayToTab(tabId);
    persist("recordings", "activeReplays");
    sendResponse({});
    updateIcon();
    return;
  }

  if (msg.type === "copyEntries") {
    state = handleCopyEntries(state, msg.targetId, msg.entries);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "mergeRecording") {
    state = handleMergeRecording(state, msg.sourceId, msg.targetId);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "renameRecording") {
    state = handleRenameRecording(state, msg.recordingId, msg.name);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "getRecording") {
    const rec = state.recordings.find((r) => r.id === msg.recordingId);
    sendResponse(rec || null);
    return true;
  }

  if (msg.type === "updateEntry") {
    state = handleUpdateEntry(state, msg.recordingId, msg.index, msg.updates);
    persist("recordings");
    const replayTabId = state.activeReplays[msg.recordingId];
    if (replayTabId) syncReplayToTab(replayTabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "dedupeEntries") {
    state = handleDedupeEntries(state, msg.recordingId);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "deleteEntry") {
    state = handleDeleteEntry(state, msg.recordingId, msg.index);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "toggleEntry") {
    state = handleToggleEntry(state, msg.recordingId, msg.index);
    persist("recordings");
    const tabId = state.activeReplays[msg.recordingId];
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "soloEntry") {
    state = handleSoloEntry(state, msg.recordingId, msg.index);
    persist("recordings");
    const tabId = state.activeReplays[msg.recordingId];
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "toggleAllEntries") {
    state = handleToggleAllEntries(state, msg.recordingId, msg.disabled);
    persist("recordings");
    const tabId = state.activeReplays[msg.recordingId];
    if (tabId) syncReplayToTab(tabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "addRecordingIgnore") {
    state = handleAddRecordingIgnore(state, msg.recordingId, msg.pattern);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "removeRecordingIgnore") {
    state = handleRemoveRecordingIgnore(state, msg.recordingId, msg.pattern);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "setActiveVariant") {
    state = handleSetActiveVariant(state, msg.recordingId, msg.index, msg.variantIndex);
    persist("recordings");
    const svTabId = state.activeReplays[msg.recordingId];
    if (svTabId) syncReplayToTab(svTabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "addVariant") {
    state = handleAddVariant(state, msg.recordingId, msg.index, msg.name, msg.body);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "deleteVariant") {
    state = handleDeleteVariant(state, msg.recordingId, msg.index, msg.variantIndex);
    persist("recordings");
    const dvTabId = state.activeReplays[msg.recordingId];
    if (dvTabId) syncReplayToTab(dvTabId);
    sendResponse({});
    return true;
  }

  if (msg.type === "renameVariant") {
    state = handleRenameVariant(state, msg.recordingId, msg.index, msg.variantIndex, msg.name);
    persist("recordings");
    sendResponse({});
    return true;
  }

  if (msg.type === "openRecording") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("src/popup.html?recording=" + msg.recordingId),
    });
    sendResponse({});
    return true;
  }

  if (msg.type === "openDashboard") {
    if (msg.tabId) originTabId = msg.tabId;
    const popupUrl = chrome.runtime.getURL("src/popup.html");
    chrome.tabs.query({}, (tabs) => {
      const existing = tabs.find((t) => t.url?.startsWith(popupUrl));
      if (existing) {
        chrome.tabs.update(existing.id, { active: true });
        chrome.windows.update(existing.windowId, { focused: true });
      } else {
        chrome.tabs.create({ url: popupUrl });
      }
    });
    sendResponse({});
    return true;
  }

  if (msg.type === "setCorner") {
    chrome.storage.local.set({ snifferCorner: msg.corner });
    const tabId = sender.tab?.id;
    if (tabId) {
      chrome.tabs.sendMessage(tabId, {
        source: "sniffer-bg",
        type: "setCorner",
        corner: msg.corner,
      });
    }
    sendResponse({});
    return true;
  }

  if (msg.source === "sniffer-bridge" && msg.type === "init") {
    const tabId = sender.tab?.id;
    chrome.storage.local.get("snifferCorner", (res) => {
      const corner = res.snifferCorner || "br";
      const entries = mergedReplayEntries(state, tabId);
      if (entries.length > 0) {
        const originGroups = resolvedOriginGroupsForTab(state, tabId);
        sendResponse({ mode: "replay", entries, originGroups, corner });
      } else if (state.recording && tabId === state.recordTabId) {
        sendResponse({ mode: "record", entries: [], originGroups: [], corner });
      } else {
        sendResponse({ mode: null, originGroups: [], corner });
      }
    });
    return true;
  }
}

// --- webRequest listeners ---
chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    state = handleWebRequestBefore(state, details);
    if (state.sniffing) persist("requests");
  },
  { urls: ["<all_urls>"] },
);

chrome.webRequest.onCompleted.addListener(
  (details) => {
    state = handleWebRequestCompleted(state, details);
    if (state.sniffing) persist("requests");

    const cat = shouldCaptureResource(state, details);
    if (cat) captureResource(details, cat);
  },
  { urls: ["<all_urls>"] },
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

  state.recordEntries.push(entry);
  updateIcon();
}

function updateIcon() {
  let text = "";
  if (state.recording) text = `${state.recordEntries.length}`;
  else if (hasActiveReplays(state)) text = `${state.replayHitCount}`;
  else if (state.sniffing) text = "ON";

  let color = "#999";
  if (state.recording) color = "#e74c3c";
  else if (hasActiveReplays(state)) color = "#2ecc71";
  else if (state.sniffing) color = "#e74c3c";

  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

let originTabId = null;

function getOriginTab() {
  return new Promise((resolve) => {
    if (originTabId) {
      chrome.tabs.get(originTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          resolve(null);
        } else {
          resolve(tab);
        }
      });
    } else {
      // Fallback: find the most recent non-extension tab
      chrome.tabs.query({ currentWindow: true }, (tabs) => {
        const tab = tabs.find(
          (t) => t.active && !t.url?.startsWith("chrome"),
        ) || tabs.find((t) => !t.url?.startsWith("chrome"));
        resolve(tab || null);
      });
    }
  });
}
