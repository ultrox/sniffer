export const TYPE_MAP = {
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

export function isIgnored(url, ignorePatterns) {
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

export function createInitialState() {
  return {
    sniffing: false,
    requests: [],
    targetTabId: null,
    recording: false,
    recordTabId: null,
    recordSourceUrl: null,
    recordEntries: [],
    recordFilters: ["xhr", "fetch"],
    ignorePatterns: [],
    activeReplays: {},
    replayHitCount: 0,
    recordings: [],
  };
}

export function handleToggle(state) {
  const sniffing = !state.sniffing;
  return {
    ...state,
    sniffing,
    requests: sniffing ? [] : state.requests,
    targetTabId: sniffing ? state.targetTabId : null,
  };
}

export function handleClear(state) {
  return { ...state, requests: [] };
}

export function handleSetFilters(state, filters) {
  return { ...state, recordFilters: filters };
}

export function handleAddIgnore(state, pattern) {
  if (!pattern || state.ignorePatterns.includes(pattern)) return state;
  return { ...state, ignorePatterns: [...state.ignorePatterns, pattern] };
}

export function handleRemoveIgnore(state, pattern) {
  return {
    ...state,
    ignorePatterns: state.ignorePatterns.filter((p) => p !== pattern),
  };
}

export function handleStartRecord(state, filters) {
  return {
    ...state,
    recording: true,
    recordEntries: [],
    recordFilters: filters || state.recordFilters,
  };
}

export function handleStopRecord(state) {
  const newState = {
    ...state,
    recording: false,
    recordTabId: null,
  };

  if (state.recordEntries.length > 0) {
    const rec = {
      id: Date.now().toString(),
      name: `Recording ${state.recordings.length + 1}`,
      timestamp: Date.now(),
      sourceUrl: state.recordSourceUrl,
      ignorePatterns: [...state.ignorePatterns],
      entries: state.recordEntries,
    };
    newState.recordings = [...state.recordings, rec];
  }
  newState.recordEntries = [];
  return newState;
}

export function handleCaptured(state, entry) {
  if (!state.recording || !entry) return state;
  if (isIgnored(entry.url, state.ignorePatterns)) return state;
  if (!state.recordFilters.includes(entry.kind)) return state;
  return { ...state, recordEntries: [...state.recordEntries, entry] };
}

export function handleStartReplay(state, recordingId) {
  const rec = state.recordings.find((r) => r.id === recordingId);
  if (!rec) return { state, error: "not found" };
  return { state, error: null };
}

export function handleStopReplay(state, recordingId) {
  const newReplays = { ...state.activeReplays };
  delete newReplays[recordingId];
  const hasActive = Object.keys(newReplays).length > 0;
  return {
    ...state,
    activeReplays: newReplays,
    replayHitCount: hasActive ? state.replayHitCount : 0,
  };
}

export function handleDeleteRecording(state, recordingId) {
  const newReplays = { ...state.activeReplays };
  delete newReplays[recordingId];
  return {
    ...state,
    activeReplays: newReplays,
    recordings: state.recordings.filter((r) => r.id !== recordingId),
  };
}

export function handleCopyEntries(state, targetId, entries) {
  if (!Array.isArray(entries)) return state;
  const recordings = state.recordings.map((r) => {
    if (r.id !== targetId) return r;
    return { ...r, entries: [...r.entries, ...entries] };
  });
  return { ...state, recordings };
}

export function handleMergeRecording(state, sourceId, targetId) {
  const source = state.recordings.find((r) => r.id === sourceId);
  const target = state.recordings.find((r) => r.id === targetId);
  if (!source || !target) return state;
  const recordings = state.recordings
    .map((r) => {
      if (r.id === targetId)
        return { ...r, entries: [...r.entries, ...source.entries] };
      return r;
    })
    .filter((r) => r.id !== sourceId);
  return { ...state, recordings };
}

export function handleRenameRecording(state, recordingId, name) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    return { ...r, name };
  });
  return { ...state, recordings };
}

export function handleUpdateEntry(state, recordingId, index, updates) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (index < 0 || index >= r.entries.length) return r;
    const entries = [...r.entries];
    entries[index] = { ...entries[index], ...updates };
    return { ...r, entries };
  });
  return { ...state, recordings };
}

export function handleDeleteEntry(state, recordingId, index) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (index < 0 || index >= r.entries.length) return r;
    const entries = r.entries.filter((_, i) => i !== index);
    return { ...r, entries };
  });
  return { ...state, recordings };
}

export function handleAddRecordingIgnore(state, recordingId, pattern) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    const patterns = r.ignorePatterns || [];
    if (patterns.includes(pattern)) return r;
    return { ...r, ignorePatterns: [...patterns, pattern] };
  });
  return { ...state, recordings };
}

export function handleRemoveRecordingIgnore(state, recordingId, pattern) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (!r.ignorePatterns) return r;
    return {
      ...r,
      ignorePatterns: r.ignorePatterns.filter((p) => p !== pattern),
    };
  });
  return { ...state, recordings };
}

export function handleReplayed(state) {
  return { ...state, replayHitCount: state.replayHitCount + 1 };
}

export function handleWebRequestBefore(state, details) {
  if (!state.sniffing) return state;
  if (state.targetTabId !== null && details.tabId !== state.targetTabId)
    return state;
  const request = {
    method: details.method,
    url: details.url,
    type: details.type,
    time: Date.now(),
  };
  return { ...state, requests: [...state.requests, request] };
}

export function handleWebRequestCompleted(state, details) {
  let newState = state;

  if (state.sniffing) {
    if (state.targetTabId === null || details.tabId === state.targetTabId) {
      const requests = state.requests.map((r) => {
        if (r.url === details.url && !r.status) {
          return { ...r, status: details.statusCode };
        }
        return r;
      });
      newState = { ...newState, requests };
    }
  }

  return newState;
}

export function shouldCaptureResource(state, details) {
  if (!state.recording || details.tabId !== state.recordTabId) return false;
  if (isIgnored(details.url, state.ignorePatterns)) return false;
  const cat = TYPE_MAP[details.type] || "other";
  if (cat === "xhr") return false;
  if (!state.recordFilters.includes(cat)) return false;
  return cat;
}

export function mergedReplayEntries(state, tabId) {
  const entries = [];
  for (const [recId, tid] of Object.entries(state.activeReplays)) {
    if (tid !== tabId) continue;
    const rec = state.recordings.find((r) => r.id === recId);
    if (rec) entries.push(...rec.entries);
  }
  return entries;
}

export function hasActiveReplays(state) {
  return Object.keys(state.activeReplays).length > 0;
}

export function getStateSnapshot(state) {
  return {
    sniffing: state.sniffing,
    requests: state.requests,
    recording: state.recording,
    replaying: hasActiveReplays(state),
    recordings: state.recordings.map((r) => ({
      id: r.id,
      name: r.name,
      timestamp: r.timestamp,
      sourceUrl: r.sourceUrl,
      count: r.entries.length,
    })),
    activeReplays: state.activeReplays,
    replayHitCount: state.replayHitCount,
    recordEntries: state.recordEntries,
    recordFilters: state.recordFilters,
    ignorePatterns: state.ignorePatterns,
  };
}
