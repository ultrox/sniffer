import { describe, it, expect } from "vitest";
import {
  createInitialState,
  isIgnored,
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
  handleDeleteEntry,
  handleAddRecordingIgnore,
  handleRemoveRecordingIgnore,
  handleSetActiveVariant,
  handleAddVariant,
  handleDeleteVariant,
  handleRenameVariant,
  handleReplayed,
  handleWebRequestBefore,
  hasActiveReplays,
  getStateSnapshot,
  TYPE_MAP,
} from "../src/logic/state.js";

describe("TYPE_MAP", () => {
  it("maps xmlhttprequest to xhr", () => {
    expect(TYPE_MAP.xmlhttprequest).toBe("xhr");
  });

  it("maps stylesheet to css", () => {
    expect(TYPE_MAP.stylesheet).toBe("css");
  });
});

describe("isIgnored", () => {
  it("matches substring patterns", () => {
    expect(isIgnored("https://api.com/analytics", ["/analytics"])).toBe(true);
  });

  it("matches regex patterns", () => {
    expect(isIgnored("https://api.com/track123", ["/track\\d+/"])).toBe(true);
  });

  it("falls back to substring for invalid regex", () => {
    expect(isIgnored("https://api.com/[/path", ["/[/"])).toBe(true);
  });

  it("returns false for no match", () => {
    expect(isIgnored("https://api.com/users", ["/analytics"])).toBe(false);
  });
});

describe("handleToggle", () => {
  it("toggles sniffing on and clears requests", () => {
    const state = { ...createInitialState(), requests: [{ url: "old" }] };
    const next = handleToggle(state);
    expect(next.sniffing).toBe(true);
    expect(next.requests).toEqual([]);
  });

  it("toggles sniffing off", () => {
    const state = { ...createInitialState(), sniffing: true, targetTabId: 1 };
    const next = handleToggle(state);
    expect(next.sniffing).toBe(false);
    expect(next.targetTabId).toBeNull();
  });
});

describe("handleClear", () => {
  it("clears requests", () => {
    const state = { ...createInitialState(), requests: [{ url: "a" }] };
    expect(handleClear(state).requests).toEqual([]);
  });
});

describe("handleSetFilters", () => {
  it("sets filters", () => {
    const state = createInitialState();
    expect(handleSetFilters(state, ["css", "img"]).recordFilters).toEqual([
      "css",
      "img",
    ]);
  });
});

describe("handleAddIgnore / handleRemoveIgnore", () => {
  it("adds pattern", () => {
    const state = createInitialState();
    const next = handleAddIgnore(state, "/analytics");
    expect(next.ignorePatterns).toEqual(["/analytics"]);
  });

  it("does not add duplicates", () => {
    const state = { ...createInitialState(), ignorePatterns: ["/analytics"] };
    const next = handleAddIgnore(state, "/analytics");
    expect(next).toBe(state);
  });

  it("removes pattern", () => {
    const state = {
      ...createInitialState(),
      ignorePatterns: ["/a", "/b"],
    };
    expect(handleRemoveIgnore(state, "/a").ignorePatterns).toEqual(["/b"]);
  });
});

describe("handleStartRecord / handleStopRecord", () => {
  it("starts recording", () => {
    const next = handleStartRecord(createInitialState(), ["fetch"]);
    expect(next.recording).toBe(true);
    expect(next.recordEntries).toEqual([]);
    expect(next.recordFilters).toEqual(["fetch"]);
    expect(next.recordTargetId).toBeNull();
  });

  it("starts recording with targetId", () => {
    const next = handleStartRecord(createInitialState(), ["fetch"], "r1");
    expect(next.recordTargetId).toBe("r1");
  });

  it("stops and saves recording", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordEntries: [{ url: "a", kind: "fetch" }],
      recordSourceUrl: "https://example.com",
    };
    const next = handleStopRecord(state);
    expect(next.recording).toBe(false);
    expect(next.recordings).toHaveLength(1);
    expect(next.recordings[0].entries).toEqual([{ url: "a", kind: "fetch" }]);
    expect(next.recordEntries).toEqual([]);
  });

  it("does not save empty recording", () => {
    const state = { ...createInitialState(), recording: true };
    const next = handleStopRecord(state);
    expect(next.recordings).toHaveLength(0);
  });
});

describe("handleCreateAndRecord", () => {
  it("creates a new recording and starts recording into it", () => {
    const state = createInitialState();
    const next = handleCreateAndRecord(state, ["fetch"]);
    expect(next.recording).toBe(true);
    expect(next.recordEntries).toEqual([]);
    expect(next.recordFilters).toEqual(["fetch"]);
    expect(next.recordings).toHaveLength(1);
    expect(next.recordings[0].entries).toEqual([]);
    expect(next.recordings[0].name).toBe("Recording 1");
    expect(next.recordTargetId).toBe(next.recordings[0].id);
  });

  it("copies current ignorePatterns to new recording", () => {
    const state = { ...createInitialState(), ignorePatterns: ["/ads"] };
    const next = handleCreateAndRecord(state);
    expect(next.recordings[0].ignorePatterns).toEqual(["/ads"]);
  });
});

describe("handleStopRecordInto", () => {
  it("appends captured entries to existing recording", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordEntries: [{ url: "b", kind: "fetch" }],
      recordings: [
        { id: "r1", name: "Rec 1", entries: [{ url: "a", kind: "xhr" }] },
      ],
    };
    const next = handleStopRecordInto(state, "r1");
    expect(next.recording).toBe(false);
    expect(next.recordings).toHaveLength(1);
    expect(next.recordings[0].entries).toHaveLength(2);
    expect(next.recordings[0].entries[1].url).toBe("b");
    expect(next.recordEntries).toEqual([]);
  });

  it("does nothing with empty record entries", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordEntries: [],
      recordings: [
        { id: "r1", name: "Rec 1", entries: [{ url: "a", kind: "xhr" }] },
      ],
    };
    const next = handleStopRecordInto(state, "r1");
    expect(next.recordings[0].entries).toHaveLength(1);
  });

  it("discards target recording if it has 0 entries after merge", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordEntries: [],
      recordings: [
        { id: "r1", name: "Empty", entries: [] },
      ],
    };
    const next = handleStopRecordInto(state, "r1");
    expect(next.recordings).toHaveLength(0);
    expect(next.recordTargetId).toBeNull();
  });
});

describe("handleCaptured", () => {
  it("adds entry when recording and filter matches", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordFilters: ["fetch"],
    };
    const next = handleCaptured(state, { url: "https://a.com", kind: "fetch" });
    expect(next.recordEntries).toHaveLength(1);
  });

  it("ignores when not recording", () => {
    const state = createInitialState();
    const next = handleCaptured(state, { url: "https://a.com", kind: "fetch" });
    expect(next).toBe(state);
  });

  it("ignores when filter does not match", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordFilters: ["xhr"],
    };
    const next = handleCaptured(state, { url: "https://a.com", kind: "fetch" });
    expect(next).toBe(state);
  });

  it("ignores when URL matches ignore pattern", () => {
    const state = {
      ...createInitialState(),
      recording: true,
      recordFilters: ["fetch"],
      ignorePatterns: ["/analytics"],
    };
    const next = handleCaptured(state, {
      url: "https://a.com/analytics",
      kind: "fetch",
    });
    expect(next).toBe(state);
  });
});

describe("handleStopReplay", () => {
  it("removes replay and resets hit count when no active replays remain", () => {
    const state = {
      ...createInitialState(),
      activeReplays: { rec1: 1 },
      replayHitCount: 5,
    };
    const next = handleStopReplay(state, "rec1");
    expect(next.activeReplays).toEqual({});
    expect(next.replayHitCount).toBe(0);
  });

  it("keeps hit count when other replays active", () => {
    const state = {
      ...createInitialState(),
      activeReplays: { rec1: 1, rec2: 2 },
      replayHitCount: 5,
    };
    const next = handleStopReplay(state, "rec1");
    expect(next.activeReplays).toEqual({ rec2: 2 });
    expect(next.replayHitCount).toBe(5);
  });
});

describe("handleDeleteRecording", () => {
  it("removes recording and stops its replay", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [] }],
      activeReplays: { "1": 1 },
    };
    const next = handleDeleteRecording(state, "1");
    expect(next.recordings).toHaveLength(0);
    expect(next.activeReplays).toEqual({});
  });
});

describe("handleCopyEntries", () => {
  it("copies entries to target recording", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [{ url: "a" }] }],
    };
    const next = handleCopyEntries(state, "1", [{ url: "b" }]);
    expect(next.recordings[0].entries).toEqual([{ url: "a" }, { url: "b" }]);
  });
});

describe("handleMergeRecording", () => {
  it("merges source into target and removes source", () => {
    const state = {
      ...createInitialState(),
      recordings: [
        { id: "1", entries: [{ url: "a" }] },
        { id: "2", entries: [{ url: "b" }] },
      ],
    };
    const next = handleMergeRecording(state, "1", "2");
    expect(next.recordings).toHaveLength(1);
    expect(next.recordings[0].id).toBe("2");
    expect(next.recordings[0].entries).toEqual([{ url: "b" }, { url: "a" }]);
  });
});

describe("handleRenameRecording", () => {
  it("renames recording", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", name: "old", entries: [] }],
    };
    const next = handleRenameRecording(state, "1", "new");
    expect(next.recordings[0].name).toBe("new");
  });
});

describe("handleUpdateEntry", () => {
  it("updates entry fields", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [{ url: "a", status: 200 }] }],
    };
    const next = handleUpdateEntry(state, "1", 0, { status: 404 });
    expect(next.recordings[0].entries[0].status).toBe(404);
    expect(next.recordings[0].entries[0].url).toBe("a");
  });
});

describe("handleDeleteEntry", () => {
  it("deletes entry by index", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [{ url: "a" }, { url: "b" }] }],
    };
    const next = handleDeleteEntry(state, "1", 0);
    expect(next.recordings[0].entries).toEqual([{ url: "b" }]);
  });
});

describe("handleAddRecordingIgnore / handleRemoveRecordingIgnore", () => {
  it("adds ignore pattern to recording", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [] }],
    };
    const next = handleAddRecordingIgnore(state, "1", "/ads");
    expect(next.recordings[0].ignorePatterns).toEqual(["/ads"]);
  });

  it("removes ignore pattern from recording", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [], ignorePatterns: ["/ads", "/track"] }],
    };
    const next = handleRemoveRecordingIgnore(state, "1", "/ads");
    expect(next.recordings[0].ignorePatterns).toEqual(["/track"]);
  });
});

describe("handleSetActiveVariant", () => {
  it("switches active variant and syncs body", () => {
    const state = {
      ...createInitialState(),
      recordings: [{
        id: "1",
        entries: [{
          url: "a",
          body: "first",
          bodyVariants: [{ name: "v1", body: "first" }, { name: "v2", body: "second" }],
          activeVariant: 0,
        }],
      }],
    };
    const next = handleSetActiveVariant(state, "1", 0, 1);
    const entry = next.recordings[0].entries[0];
    expect(entry.activeVariant).toBe(1);
    expect(entry.body).toBe("second");
  });

  it("does nothing for missing variants", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [{ url: "a", body: "x" }] }],
    };
    const next = handleSetActiveVariant(state, "1", 0, 0);
    expect(next.recordings[0].entries[0].body).toBe("x");
  });
});

describe("handleAddVariant", () => {
  it("creates default + new variant on first add", () => {
    const state = {
      ...createInitialState(),
      recordings: [{ id: "1", entries: [{ url: "a", body: "original" }] }],
    };
    const next = handleAddVariant(state, "1", 0, "empty", "[]");
    const entry = next.recordings[0].entries[0];
    expect(entry.bodyVariants).toHaveLength(2);
    expect(entry.bodyVariants[0]).toEqual({ name: "default", body: "original" });
    expect(entry.bodyVariants[1]).toEqual({ name: "empty", body: "[]" });
    expect(entry.activeVariant).toBe(1);
    expect(entry.body).toBe("[]");
  });

  it("appends variant when variants already exist", () => {
    const state = {
      ...createInitialState(),
      recordings: [{
        id: "1",
        entries: [{
          url: "a",
          body: "first",
          bodyVariants: [{ name: "v1", body: "first" }],
          activeVariant: 0,
        }],
      }],
    };
    const next = handleAddVariant(state, "1", 0, "v2", "second");
    const entry = next.recordings[0].entries[0];
    expect(entry.bodyVariants).toHaveLength(2);
    expect(entry.activeVariant).toBe(1);
    expect(entry.body).toBe("second");
  });
});

describe("handleDeleteVariant", () => {
  it("removes variant and adjusts activeVariant", () => {
    const state = {
      ...createInitialState(),
      recordings: [{
        id: "1",
        entries: [{
          url: "a",
          body: "second",
          bodyVariants: [{ name: "v1", body: "first" }, { name: "v2", body: "second" }],
          activeVariant: 1,
        }],
      }],
    };
    const next = handleDeleteVariant(state, "1", 0, 1);
    const entry = next.recordings[0].entries[0];
    expect(entry.bodyVariants).toHaveLength(1);
    expect(entry.activeVariant).toBe(0);
    expect(entry.body).toBe("first");
  });

  it("removes variants array when deleting last variant", () => {
    const state = {
      ...createInitialState(),
      recordings: [{
        id: "1",
        entries: [{
          url: "a",
          body: "only",
          bodyVariants: [{ name: "v1", body: "only" }],
          activeVariant: 0,
        }],
      }],
    };
    const next = handleDeleteVariant(state, "1", 0, 0);
    const entry = next.recordings[0].entries[0];
    expect(entry.bodyVariants).toBeUndefined();
    expect(entry.activeVariant).toBeUndefined();
    expect(entry.body).toBe("only");
  });
});

describe("handleRenameVariant", () => {
  it("renames a variant", () => {
    const state = {
      ...createInitialState(),
      recordings: [{
        id: "1",
        entries: [{
          url: "a",
          body: "x",
          bodyVariants: [{ name: "old", body: "x" }],
          activeVariant: 0,
        }],
      }],
    };
    const next = handleRenameVariant(state, "1", 0, 0, "new");
    expect(next.recordings[0].entries[0].bodyVariants[0].name).toBe("new");
  });
});

describe("handleReplayed", () => {
  it("increments hit count", () => {
    const state = { ...createInitialState(), replayHitCount: 3 };
    expect(handleReplayed(state).replayHitCount).toBe(4);
  });
});

describe("handleWebRequestBefore", () => {
  it("adds request when sniffing", () => {
    const state = { ...createInitialState(), sniffing: true };
    const next = handleWebRequestBefore(state, {
      method: "GET",
      url: "https://a.com",
      type: "xmlhttprequest",
      tabId: 1,
    });
    expect(next.requests).toHaveLength(1);
    expect(next.requests[0].method).toBe("GET");
  });

  it("ignores when not sniffing", () => {
    const state = createInitialState();
    const next = handleWebRequestBefore(state, {
      method: "GET",
      url: "https://a.com",
      type: "xmlhttprequest",
      tabId: 1,
    });
    expect(next).toBe(state);
  });

  it("ignores wrong tab", () => {
    const state = {
      ...createInitialState(),
      sniffing: true,
      targetTabId: 1,
    };
    const next = handleWebRequestBefore(state, {
      method: "GET",
      url: "https://a.com",
      type: "xmlhttprequest",
      tabId: 2,
    });
    expect(next).toBe(state);
  });
});

describe("hasActiveReplays", () => {
  it("returns false for empty", () => {
    expect(hasActiveReplays(createInitialState())).toBe(false);
  });

  it("returns true when replays exist", () => {
    expect(
      hasActiveReplays({
        ...createInitialState(),
        activeReplays: { "1": 1 },
      }),
    ).toBe(true);
  });
});

describe("getStateSnapshot", () => {
  it("returns summary with recording counts", () => {
    const state = {
      ...createInitialState(),
      recordings: [
        { id: "1", name: "R1", timestamp: 100, sourceUrl: "https://a.com", entries: [1, 2] },
      ],
    };
    const snap = getStateSnapshot(state);
    expect(snap.recordings[0].count).toBe(2);
    expect(snap.recordings[0].entries).toBeUndefined();
  });
});
