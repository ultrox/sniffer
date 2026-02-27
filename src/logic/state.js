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
    recordTargetId: null,
    recordFilters: ["xhr", "fetch"],
    ignorePatterns: [],
    activeReplays: {},
    replayHitCount: 0,
    recordings: [],
    originGroups: [],
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

export function handleSetOriginGroups(state, groups) {
  return { ...state, originGroups: Array.isArray(groups) ? groups : [] };
}

export function handleSetRecordingOriginGroups(state, recordingId, groupIds) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    return { ...r, originGroupIds: Array.isArray(groupIds) ? groupIds : [] };
  });
  return { ...state, recordings };
}

export function activeOriginGroupsForRecording(state, recordingId) {
  const rec = state.recordings.find((r) => r.id === recordingId);
  if (!rec || !rec.originGroupIds || rec.originGroupIds.length === 0) return [];
  return state.originGroups
    .filter((g) => rec.originGroupIds.includes(g.id))
    .flatMap((g) => g.mappings || []);
}

export function handleStartRecord(state, filters, targetId) {
  return {
    ...state,
    recording: true,
    recordEntries: [],
    recordTargetId: targetId || null,
    recordFilters: filters || state.recordFilters,
  };
}

export function handleCreateAndRecord(state, filters) {
  const id = Date.now().toString();
  const rec = {
    id,
    name: `Recording ${state.recordings.length + 1}`,
    timestamp: Date.now(),
    sourceUrl: null,
    ignorePatterns: [...state.ignorePatterns],
    entries: [],
  };
  return {
    ...state,
    recording: true,
    recordEntries: [],
    recordTargetId: id,
    recordFilters: filters || state.recordFilters,
    recordings: [...state.recordings, rec],
  };
}

export function handleStopRecord(state) {
  const newState = {
    ...state,
    recording: false,
    recordTabId: null,
    recordTargetId: null,
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

export function handleStopRecordInto(state, targetId) {
  const newState = {
    ...state,
    recording: false,
    recordTabId: null,
    recordTargetId: null,
  };

  let recordings = state.recordings;
  if (state.recordEntries.length > 0) {
    recordings = recordings.map((r) => {
      if (r.id !== targetId) return r;
      return { ...r, entries: [...r.entries, ...state.recordEntries] };
    });
  }

  // Discard target recording if it has 0 total entries after merge
  const target = recordings.find((r) => r.id === targetId);
  if (target && target.entries.length === 0) {
    recordings = recordings.filter((r) => r.id !== targetId);
  }

  newState.recordings = recordings;
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

export function handleDedupeEntries(state, recordingId) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    const seen = new Set();
    const entries = r.entries.filter((e) => {
      if (seen.has(e.url)) return false;
      seen.add(e.url);
      return true;
    });
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

// --- Body variant helpers ---
function updateEntryInRecording(state, recordingId, entryIndex, updater) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (entryIndex < 0 || entryIndex >= r.entries.length) return r;
    const entries = [...r.entries];
    entries[entryIndex] = updater(entries[entryIndex]);
    return { ...r, entries };
  });
  return { ...state, recordings };
}

export function handleSetActiveVariant(state, recordingId, entryIndex, variantIndex) {
  return updateEntryInRecording(state, recordingId, entryIndex, (entry) => {
    if (!entry.bodyVariants || variantIndex < 0 || variantIndex >= entry.bodyVariants.length) return entry;
    return {
      ...entry,
      activeVariant: variantIndex,
      body: entry.bodyVariants[variantIndex].body,
    };
  });
}

export function handleAddVariant(state, recordingId, entryIndex, name, body) {
  return updateEntryInRecording(state, recordingId, entryIndex, (entry) => {
    const variants = entry.bodyVariants
      ? [...entry.bodyVariants]
      : [{ name: "default", body: entry.body || "" }];
    variants.push({ name, body });
    return {
      ...entry,
      bodyVariants: variants,
      activeVariant: variants.length - 1,
      body,
    };
  });
}

export function handleDeleteVariant(state, recordingId, entryIndex, variantIndex) {
  return updateEntryInRecording(state, recordingId, entryIndex, (entry) => {
    if (!entry.bodyVariants || variantIndex < 0 || variantIndex >= entry.bodyVariants.length) return entry;
    if (entry.bodyVariants.length <= 1) {
      const { bodyVariants, activeVariant, ...rest } = entry;
      return rest;
    }
    const variants = entry.bodyVariants.filter((_, i) => i !== variantIndex);
    const active = Math.min(entry.activeVariant || 0, variants.length - 1);
    return {
      ...entry,
      bodyVariants: variants,
      activeVariant: active,
      body: variants[active].body,
    };
  });
}

export function handleRenameVariant(state, recordingId, entryIndex, variantIndex, name) {
  return updateEntryInRecording(state, recordingId, entryIndex, (entry) => {
    if (!entry.bodyVariants || variantIndex < 0 || variantIndex >= entry.bodyVariants.length) return entry;
    const variants = entry.bodyVariants.map((v, i) =>
      i === variantIndex ? { ...v, name } : v,
    );
    return { ...entry, bodyVariants: variants };
  });
}

export function handleToggleEntry(state, recordingId, index) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (index < 0 || index >= r.entries.length) return r;
    const entries = [...r.entries];
    entries[index] = { ...entries[index], disabled: !entries[index].disabled };
    return { ...r, entries };
  });
  return { ...state, recordings };
}

export function handleSoloEntry(state, recordingId, index) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    if (index < 0 || index >= r.entries.length) return r;
    // If this is already the only enabled entry, re-enable all
    const onlyThisEnabled = r.entries.every((e, i) => i === index ? !e.disabled : e.disabled);
    const entries = r.entries.map((e, i) => ({
      ...e,
      disabled: onlyThisEnabled ? false : i !== index,
    }));
    return { ...r, entries };
  });
  return { ...state, recordings };
}

export function handleToggleAllEntries(state, recordingId, disabled) {
  const recordings = state.recordings.map((r) => {
    if (r.id !== recordingId) return r;
    const entries = r.entries.map((e) => ({ ...e, disabled }));
    return { ...r, entries };
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
    if (rec) entries.push(...rec.entries.filter((e) => !e.disabled));
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
    recordTargetId: state.recordTargetId,
    replaying: hasActiveReplays(state),
    recordings: state.recordings.map((r) => ({
      id: r.id,
      name: r.name,
      timestamp: r.timestamp,
      sourceUrl: r.sourceUrl,
      count: r.entries.length,
      originGroupIds: r.originGroupIds || [],
    })),
    activeReplays: state.activeReplays,
    replayHitCount: state.replayHitCount,
    recordEntries: state.recordEntries,
    recordFilters: state.recordFilters,
    ignorePatterns: state.ignorePatterns,
    originGroups: state.originGroups,
    knownOrigins: extractKnownOrigins(state),
  };
}

export function extractKnownOrigins(state) {
  const origins = new Set();
  for (const rec of state.recordings) {
    if (!rec.entries) continue;
    for (const entry of rec.entries) {
      try {
        origins.add(new URL(entry.url).origin);
      } catch {}
    }
  }
  return [...origins].sort();
}
