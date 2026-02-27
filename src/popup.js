import "./popup.css";
import {
  statusClass,
  cleanUrl,
  getPath,
  isFormEncoded,
  fmtSize,
  timeAgo,
  esc,
  buildUrlFromParts,
} from "./logic/helpers.js";

// --- Elements ---
const mainView = document.getElementById("mainView");
const detailView = document.getElementById("detailView");
const recordBtn = document.getElementById("record");
const filtersEl = document.getElementById("filters");
const ignoreBar = document.getElementById("ignoreBar");
const originGroupsEl = document.getElementById("originGroups");
const recCountEl = document.getElementById("recCount");
const recSearchInput = document.getElementById("recSearchInput");
const recordingsEl = document.getElementById("recordings");
const backBtn = document.getElementById("backBtn");
const detailCount = document.getElementById("detailCount");
const detailPathFilter = document.getElementById("detailPathFilter");
const detailBodyFilter = document.getElementById("detailBodyFilter");
const detailEntries = document.getElementById("detailEntries");
const detailRecordBtn = document.getElementById("detailRecordBtn");
const detailReplayBtn = document.getElementById("detailReplayBtn");
const detailSortBtn = document.getElementById("detailSortBtn");
const detailOriginGroupsEl = document.getElementById("detailOriginGroups");

// --- State ---
const ALL_TYPES = [
  "xhr",
  "fetch",
  "script",
  "css",
  "img",
  "font",
  "doc",
  "other",
];
let activeFilters = ["xhr", "fetch"];
let ignorePatterns = [];
let originGroups = [];
let knownOrigins = [];
let currentView = "main";
let detailRecordingId = null;
let expandedEntry = -1;
let isMerging = false;
let lastRecKey = "";
let activeJsonEditor = null;
let detailSort = null; // null | "url"
let entryTogglesVisible = false;
let pendingVariantRename = null; // { entryIndex, variantIndex } - auto-open rename after load

// --- Helpers ---
function renderPayload(payload) {
  if (!payload) return "";
  if (isFormEncoded(payload)) {
    const params = new URLSearchParams(payload);
    const fields = [...params.entries()]
      .sort((a, b) => (b[1] ? 1 : 0) - (a[1] ? 1 : 0))
      .map(
        ([k, v]) =>
          `<div class="payload-field">
            <label>${esc(k)}
              <input name="payload-field" data-key="${esc(k)}" value="${esc(v)}">
            </label>
          </div>`,
      )
      .join("");
    return `<div class="payload-section collapsed">
      <div class="payload-header">
        <span class="payload-toggle">Payload (${params.size} params)</span>
        <button class="payload-mode" data-mode="parsed">Raw</button>
      </div>
      <div class="payload-body">
        <div class="payload-parsed">${fields}</div>
        <textarea class="payload-raw" name="payload" style="display:none">${esc(payload)}</textarea>
      </div>
    </div>`;
  }
  return `<label>Request payload
    <textarea name="payload">${esc(payload)}</textarea>
  </label>`;
}

function collectPayload(form) {
  const section = form.querySelector(".payload-section");
  if (section) {
    const rawEl = section.querySelector(".payload-raw");
    if (rawEl && rawEl.style.display !== "none") return rawEl.value;
    const fields = section.querySelectorAll('[name="payload-field"]');
    if (fields.length > 0) {
      const params = new URLSearchParams();
      fields.forEach((f) => params.set(f.dataset.key, f.value));
      return params.toString();
    }
  }
  const textarea = form.querySelector('[name="payload"]');
  return textarea ? textarea.value : null;
}

function renderIgnoreTags(patterns) {
  return patterns
    .map(
      (p) =>
        `<span class="ignore-tag" data-pattern="${esc(p)}">${esc(p)} <span class="remove">x</span></span>`,
    )
    .join("");
}

// --- Filter chips ---
function renderFilters() {
  filtersEl.innerHTML = ALL_TYPES.map(
    (t) =>
      `<span class="chip ${activeFilters.includes(t) ? "on" : ""}" data-type="${t}">${t}</span>`,
  ).join("");
}

filtersEl.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  const t = chip.dataset.type;
  if (activeFilters.includes(t)) {
    activeFilters = activeFilters.filter((f) => f !== t);
  } else {
    activeFilters.push(t);
  }
  renderFilters();
  chrome.runtime.sendMessage({ type: "setFilters", filters: activeFilters });
});

// --- Working ignore patterns (main view) ---
function renderIgnoreBar() {
  ignoreBar.innerHTML =
    renderIgnoreTags(ignorePatterns) +
    `<input id="ignoreInput" placeholder="Ignore pattern... (Enter to add)">`;
  document
    .getElementById("ignoreInput")
    .addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      const val = e.target.value.trim();
      if (!val) return;
      e.target.value = "";
      chrome.runtime.sendMessage(
        { type: "addIgnore", pattern: val },
        (res) => {
          if (res?.ignorePatterns) ignorePatterns = res.ignorePatterns;
          renderIgnoreBar();
        },
      );
    });
}

ignoreBar.addEventListener("click", (e) => {
  const rm = e.target.closest(".remove");
  if (!rm) return;
  const pattern = rm.closest(".ignore-tag")?.dataset.pattern;
  if (!pattern) return;
  chrome.runtime.sendMessage({ type: "removeIgnore", pattern }, (res) => {
    if (res?.ignorePatterns) ignorePatterns = res.ignorePatterns;
    renderIgnoreBar();
  });
});

// --- Origin groups ---
const expandedGroups = new Set();

function renderOriginGroups() {
  const datalistId = "knownOriginsList";
  const datalist = `<datalist id="${datalistId}">${knownOrigins.map((o) => `<option value="${esc(o)}">`).join("")}</datalist>`;

  if (originGroups.length === 0) {
    originGroupsEl.innerHTML = datalist + `<button class="origin-groups-add">+ Origin group</button>`;
    return;
  }
  originGroupsEl.innerHTML =
    datalist +
    originGroups
      .map((group) => {
        const expanded = expandedGroups.has(group.id);
        const count = (group.mappings || []).length;
        const arrow = expanded ? "v" : ">";
        const summary = !expanded && count > 0
          ? `<span class="origin-group-summary">${count} mapping${count > 1 ? "s" : ""}</span>`
          : "";
        let body = "";
        if (expanded) {
          const mappings = (group.mappings || [])
            .map(
              (m, i) =>
                `<div class="origin-mapping" data-gid="${esc(group.id)}" data-mi="${i}">` +
                `<input class="origin-mapping-left" value="${esc(m[0] || "")}" placeholder="https://..." list="${datalistId}">` +
                `<span class="origin-mapping-arrow">↔</span>` +
                `<input class="origin-mapping-right" value="${esc(m[1] || "")}" placeholder="https://..." list="${datalistId}">` +
                `<span class="origin-mapping-del">x</span>` +
                `</div>`,
            )
            .join("");
          body = mappings + `<button class="origin-mapping-add" data-id="${esc(group.id)}">+ mapping</button>`;
        }
        return (
          `<div class="origin-group" data-id="${esc(group.id)}">` +
          `<div class="origin-group-header">` +
          `<span class="origin-group-toggle" data-id="${esc(group.id)}">${arrow}</span>` +
          `<input class="origin-group-name" value="${esc(group.name)}" placeholder="Group name..." data-id="${esc(group.id)}">` +
          summary +
          `<span class="del-group" data-id="${esc(group.id)}">x</span>` +
          `</div>` +
          body +
          `</div>`
        );
      })
      .join("") +
    `<button class="origin-groups-add">+ Origin group</button>`;
}

function syncOriginGroups() {
  chrome.runtime.sendMessage(
    { type: "setOriginGroups", groups: originGroups },
    (res) => {
      if (res?.originGroups) originGroups = res.originGroups;
    },
  );
}

originGroupsEl.addEventListener("click", (e) => {
  if (e.target.closest(".origin-group-toggle")) {
    const groupId = e.target.closest(".origin-group-toggle").dataset.id;
    if (expandedGroups.has(groupId)) expandedGroups.delete(groupId);
    else expandedGroups.add(groupId);
    renderOriginGroups();
    return;
  }
  if (e.target.closest(".origin-groups-add")) {
    const id = "g" + Date.now();
    originGroups = [...originGroups, { id, name: "", mappings: [] }];
    expandedGroups.add(id);
    renderOriginGroups();
    syncOriginGroups();
    const nameInput = originGroupsEl.querySelector(`.origin-group-name[data-id="${id}"]`);
    if (nameInput) nameInput.focus();
    return;
  }
  if (e.target.closest(".origin-mapping-add")) {
    const groupId = e.target.closest(".origin-mapping-add").dataset.id;
    originGroups = originGroups.map((g) =>
      g.id === groupId ? { ...g, mappings: [...(g.mappings || []), ["", ""]] } : g,
    );
    renderOriginGroups();
    syncOriginGroups();
    const lastRow = originGroupsEl.querySelector(`.origin-group[data-id="${groupId}"] .origin-mapping:last-of-type .origin-mapping-left`);
    if (lastRow) lastRow.focus();
    return;
  }
  if (e.target.closest(".origin-mapping-del")) {
    const row = e.target.closest(".origin-mapping");
    const groupId = row.dataset.gid;
    const mi = parseInt(row.dataset.mi, 10);
    originGroups = originGroups.map((g) =>
      g.id === groupId ? { ...g, mappings: g.mappings.filter((_, i) => i !== mi) } : g,
    );
    renderOriginGroups();
    syncOriginGroups();
    return;
  }
  const del = e.target.closest(".del-group");
  if (del) {
    const groupId = del.dataset.id;
    originGroups = originGroups.filter((g) => g.id !== groupId);
    renderOriginGroups();
    syncOriginGroups();
    return;
  }
});

originGroupsEl.addEventListener("change", (e) => {
  const nameInput = e.target.closest(".origin-group-name");
  if (nameInput) {
    const groupId = nameInput.dataset.id;
    const name = nameInput.value.trim();
    originGroups = originGroups.map((g) =>
      g.id === groupId ? { ...g, name } : g,
    );
    syncOriginGroups();
    return;
  }
  const left = e.target.closest(".origin-mapping-left");
  const right = e.target.closest(".origin-mapping-right");
  if (left || right) {
    const row = e.target.closest(".origin-mapping");
    const groupId = row.dataset.gid;
    const mi = parseInt(row.dataset.mi, 10);
    originGroups = originGroups.map((g) => {
      if (g.id !== groupId) return g;
      const mappings = g.mappings.map((m, i) => {
        if (i !== mi) return m;
        const pair = [...m];
        if (left) pair[0] = left.value.trim();
        if (right) pair[1] = right.value.trim();
        return pair;
      });
      return { ...g, mappings };
    });
    syncOriginGroups();
    return;
  }
});

// --- Request list ---
// --- Recordings list ---
function renderRecordings(recs, activeReplays, recordingState) {
  recCountEl.textContent = recs.length ? `(${recs.length})` : "";
  const query = (recSearchInput.value || "").trim().toLowerCase();
  const filtered = query
    ? recs.filter((r) => (r.name || "").toLowerCase().includes(query))
    : recs;
  if (filtered.length === 0) {
    recordingsEl.innerHTML = query
      ? '<div class="empty" style="padding:16px">No matches</div>'
      : '<div class="empty" style="padding:16px">No recordings yet</div>';
    return;
  }
  const { recording, recordTargetId, recordCount } = recordingState || {};
  recordingsEl.innerHTML = filtered
    .toReversed()
    .map((r) => {
      const isReplaying = r.id in (activeReplays || {});
      const isRecording = recording && recordTargetId === r.id;
      let sourceHtml = "";
      if (r.sourceUrl) {
        try {
          const u = new URL(r.sourceUrl);
          sourceHtml = `<span class="rec-source" data-url="${esc(r.sourceUrl)}" title="${esc(r.sourceUrl)}">${esc(u.pathname + u.search)}</span>`;
        } catch {}
      }
      const recIndicator = isRecording
        ? `<span class="rec-recording-badge">REC ${recordCount}</span>`
        : "";
      return `
    <div class="rec-item${isRecording ? " rec-active-recording" : ""}" data-id="${r.id}">
      <span class="rec-name" data-id="${r.id}">${esc(r.name)}</span>
      ${recIndicator}
      ${sourceHtml}
      <span class="rec-meta">${r.count}${isRecording ? `+${recordCount}` : ""} req - ${timeAgo(r.timestamp)}</span>
      <button class="merge" data-id="${r.id}">Merge</button>
      <button class="replay ${isReplaying ? "active-replay" : ""}" data-id="${r.id}">
        ${isReplaying ? "Stop" : "Replay"}
      </button>
      <button class="del" data-id="${r.id}">x</button>
    </div>`;
    })
    .join("");
}

recSearchInput.addEventListener("input", () => refresh());

// --- Refresh (main view) ---
function refresh() {
  if (currentView !== "main") return;
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;

    activeFilters = res.recordFilters || activeFilters;
    renderFilters();

    if (
      JSON.stringify(ignorePatterns) !==
      JSON.stringify(res.ignorePatterns || [])
    ) {
      ignorePatterns = res.ignorePatterns || [];
      renderIgnoreBar();
    }

    const newKnown = res.knownOrigins || [];
    const originsChanged =
      JSON.stringify(originGroups) !== JSON.stringify(res.originGroups || []);
    const knownChanged =
      JSON.stringify(knownOrigins) !== JSON.stringify(newKnown);
    if (originsChanged || knownChanged) {
      originGroups = res.originGroups || [];
      knownOrigins = newKnown;
      renderOriginGroups();
    }

    recordBtn.classList.remove("recording");
    if (res.recording) {
      recordBtn.classList.add("recording");
      recordBtn.textContent = `Stop (${res.recordEntries.length})`;
    } else {
      recordBtn.textContent = "Record";
    }

    if (!isMerging) {
      const recordingState = {
        recording: res.recording,
        recordTargetId: res.recordTargetId,
        recordCount: (res.recordEntries || []).length,
      };
      const recKey =
        JSON.stringify(
          res.recordings.map(
            (r) => r.id + r.name + r.count + (r.sourceUrl || ""),
          ),
        ) + JSON.stringify(res.activeReplays || {})
          + (recSearchInput.value || "")
          + (res.recording ? res.recordTargetId + recordingState.recordCount : "");
      if (recKey !== lastRecKey) {
        lastRecKey = recKey;
        renderRecordings(res.recordings, res.activeReplays, recordingState);
      }
    }
  });
}

// --- Main view events ---
recordBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    if (res.recording) {
      chrome.runtime.sendMessage(
        { type: "stopRecordInto", recordingId: res.recordTargetId },
        () => refresh(),
      );
    } else {
      chrome.runtime.sendMessage(
        { type: "createAndRecord", filters: activeFilters },
        (resp) => {
          if (resp?.recordingId) openDetail(resp.recordingId);
        },
      );
    }
  });
});


recordingsEl.addEventListener("click", (e) => {
  const sourceEl = e.target.closest(".rec-source");
  if (sourceEl) {
    const url = sourceEl.dataset.url;
    if (url) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) chrome.tabs.update(tabs[0].id, { url });
      });
    }
    return;
  }

  const nameEl = e.target.closest(".rec-name");
  if (nameEl && !e.target.closest("button")) {
    openDetail(nameEl.dataset.id);
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains("replay")) {
    if (btn.classList.contains("active-replay")) {
      chrome.runtime.sendMessage(
        { type: "stopReplay", recordingId: id },
        () => refresh(),
      );
    } else {
      chrome.runtime.sendMessage(
        { type: "startReplay", recordingId: id },
        () => refresh(),
      );
    }
  }

  if (btn.classList.contains("merge")) {
    showMergePicker(id);
    return;
  }

  if (btn.classList.contains("del")) {
    chrome.runtime.sendMessage(
      { type: "deleteRecording", recordingId: id },
      () => refresh(),
    );
  }
});

// --- Merge picker ---
function showMergePicker(sourceId) {
  const row = recordingsEl.querySelector(`.rec-item[data-id="${sourceId}"]`);
  if (!row) return;
  const existing = recordingsEl.querySelector(".merge-picker");
  if (existing) {
    existing.remove();
    isMerging = false;
  }

  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const targets = res.recordings.filter((r) => r.id !== sourceId);
    if (targets.length === 0) return;

    isMerging = true;
    const picker = document.createElement("div");
    picker.className = "merge-picker";
    picker.innerHTML =
      `<span class="merge-label">Merge into:</span>` +
      targets
        .map(
          (r) =>
            `<button class="merge-target" data-id="${r.id}">${esc(r.name)}</button>`,
        )
        .join("") +
      `<button class="merge-cancel">Esc</button>`;
    row.after(picker);

    const closePicker = () => {
      picker.remove();
      isMerging = false;
      document.removeEventListener("keydown", onKey);
    };

    picker.addEventListener("click", (e) => {
      const target = e.target.closest(".merge-target");
      if (target) {
        chrome.runtime.sendMessage(
          { type: "mergeRecording", sourceId, targetId: target.dataset.id },
          () => {
            closePicker();
            refresh();
          },
        );
        return;
      }
      if (e.target.closest(".merge-cancel")) closePicker();
    });

    const onKey = (e) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);
  });
}

// --- Detail view ---
function openDetail(recordingId) {
  detailRecordingId = recordingId;
  expandedEntry = -1;
  detailSort = null;
  entryTogglesVisible = false;
  detailSortBtn.classList.remove("active");
  detailSortBtn.textContent = "Sort";
  detailPathFilter.value = "";
  detailBodyFilter.value = "";
  currentView = "detail";
  mainView.style.display = "none";
  detailView.style.display = "block";
  loadDetail();
}

function doCloseDetail() {
  if (activeJsonEditor) {
    activeJsonEditor.destroy();
    activeJsonEditor = null;
  }
  currentView = "main";
  detailView.style.display = "none";
  mainView.style.display = "block";
  refresh();
}

function closeDetail() {
  doCloseDetail();
}

function updateDetailButtons() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const isReplaying = detailRecordingId in (res.activeReplays || {});
    detailReplayBtn.textContent = isReplaying ? "Stop" : "Replay";
    detailReplayBtn.classList.toggle("active-replay", isReplaying);
    const isRecordingHere = res.recording && res.recordTargetId === detailRecordingId;
    detailRecordBtn.textContent = isRecordingHere ? `Stop (${res.recordEntries.length})` : "Record";
    detailRecordBtn.classList.toggle("recording", isRecordingHere);
  });
}

let detailAllEntries = [];
let detailOriginGroupIds = [];

let detailOgExpanded = false;

function renderDetailOriginGroups() {
  if (originGroups.length === 0) {
    detailOriginGroupsEl.innerHTML = "";
    return;
  }
  const chips = originGroups
    .map((g) => {
      const active = detailOriginGroupIds.includes(g.id);
      return `<span class="detail-og-chip${active ? " on" : ""}" data-id="${esc(g.id)}">${esc(g.name || g.id)}</span>`;
    })
    .join("");
  const activeGroups = originGroups.filter((g) => detailOriginGroupIds.includes(g.id));
  const hasActive = activeGroups.some((g) => (g.mappings || []).length > 0);
  let expandHtml = "";
  if (hasActive) {
    const arrow = detailOgExpanded ? "v" : ">";
    expandHtml += `<span class="detail-og-expand">${arrow} mappings</span>`;
    if (detailOgExpanded) {
      expandHtml += `<div class="detail-og-mappings">${activeGroups
        .flatMap((g) =>
          (g.mappings || []).map(
            (m) => `<div class="detail-og-mapping"><span>${esc(m[0] || "")}</span> <span class="origin-mapping-arrow">↔</span> <span>${esc(m[1] || "")}</span></div>`,
          ),
        )
        .join("")}</div>`;
    }
  }
  detailOriginGroupsEl.innerHTML = chips + expandHtml;
}

detailOriginGroupsEl.addEventListener("click", (e) => {
  if (e.target.closest(".detail-og-expand")) {
    detailOgExpanded = !detailOgExpanded;
    renderDetailOriginGroups();
    return;
  }
  const chip = e.target.closest(".detail-og-chip");
  if (!chip) return;
  const groupId = chip.dataset.id;
  if (detailOriginGroupIds.includes(groupId)) {
    detailOriginGroupIds = detailOriginGroupIds.filter((id) => id !== groupId);
  } else {
    detailOriginGroupIds = [...detailOriginGroupIds, groupId];
  }
  renderDetailOriginGroups();
  chrome.runtime.sendMessage({
    type: "setRecordingOriginGroups",
    recordingId: detailRecordingId,
    groupIds: detailOriginGroupIds,
  });
});

function loadDetail() {
  chrome.runtime.sendMessage(
    { type: "getRecording", recordingId: detailRecordingId },
    (rec) => {
      if (!rec) {
        closeDetail();
        return;
      }
      const titleEl = detailView.querySelector("#detailTitle");
      if (titleEl) {
        titleEl.textContent = rec.name;
        titleEl.title = "Click to rename";
      } else {
        const span = document.createElement("span");
        span.id = "detailTitle";
        span.style.cssText = "flex:1; font-size:12px; cursor:pointer";
        span.title = "Click to rename";
        span.textContent = rec.name;
        const toolbar = detailView.querySelector(".toolbar");
        const renameInput = toolbar.querySelector(".rename-input");
        if (renameInput) renameInput.replaceWith(span);
      }

      detailOriginGroupIds = rec.originGroupIds || [];

      // Merge live recordEntries when recording into this recording
      chrome.runtime.sendMessage({ type: "getState" }, (res) => {
        let entries = rec.entries;
        if (res?.recording && res.recordTargetId === detailRecordingId) {
          entries = [...rec.entries, ...res.recordEntries];
        }
        if (res) {
          originGroups = res.originGroups || [];
          knownOrigins = res.knownOrigins || [];
        }
        detailCount.textContent = `${entries.length} req`;
        detailAllEntries = entries;
        if (entries.some((entry) => entry.disabled)) entryTogglesVisible = true;
        applyDetailFilters();
        updateDetailButtons();
        renderDetailOriginGroups();
      });
    },
  );
}

function refreshDetailEntries() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res?.recording || res.recordTargetId !== detailRecordingId) return;
    chrome.runtime.sendMessage(
      { type: "getRecording", recordingId: detailRecordingId },
      (rec) => {
        if (!rec) return;
        const entries = [...rec.entries, ...res.recordEntries];
        if (entries.length === detailAllEntries.length) return;
        detailAllEntries = entries;
        detailCount.textContent = `${entries.length} req`;
        applyDetailFilters();
      },
    );
  });
}

function applyDetailFilters() {
  const pathQ = detailPathFilter.value.trim().toLowerCase();
  const bodyQ = detailBodyFilter.value.trim().toLowerCase();
  let entries = detailAllEntries;
  if (pathQ || bodyQ) {
    entries = entries.filter((e) => {
      if (pathQ && !e.url.toLowerCase().includes(pathQ)) return false;
      if (bodyQ && !(e.body || "").toLowerCase().includes(bodyQ)) return false;
      return true;
    });
  }
  if (detailSort === "url") {
    entries = [...entries].sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
  }
  renderDetailEntries(entries);
}

detailPathFilter.addEventListener("input", applyDetailFilters);
detailBodyFilter.addEventListener("input", applyDetailFilters);

detailSortBtn.addEventListener("click", () => {
  detailSort = detailSort ? null : "url";
  detailSortBtn.classList.toggle("active", !!detailSort);
  detailSortBtn.textContent = detailSort ? "Sort: URL" : "Sort";
  applyDetailFilters();
});

detailView.querySelector(".detail-toggle-all").addEventListener("change", (e) => {
  const allEnabled = detailAllEntries.length > 0 && detailAllEntries.every((entry) => !entry.disabled);
  if (allEnabled && !entryTogglesVisible) {
    // Enter editing mode without disabling anything
    entryTogglesVisible = true;
    e.target.checked = true;
    e.target.indeterminate = true;
    applyDetailFilters();
    return;
  }
  if (e.target.checked) {
    // Re-enable all and exit editing mode
    entryTogglesVisible = false;
    chrome.runtime.sendMessage(
      { type: "toggleAllEntries", recordingId: detailRecordingId, disabled: false },
      () => loadDetail(),
    );
  } else {
    chrome.runtime.sendMessage(
      { type: "toggleAllEntries", recordingId: detailRecordingId, disabled: true },
      () => loadDetail(),
    );
  }
});

function renderDetailEntries(entries) {
  if (entries.length === 0) {
    detailEntries.innerHTML =
      '<div class="empty">No entries in this recording</div>';
    return;
  }

  // Update toggle-all checkbox state
  const toggleAll = detailView.querySelector(".detail-toggle-all");
  const allEnabled = entries.length > 0 && entries.every((e) => !e.disabled);
  const someEnabled = entries.some((e) => !e.disabled);
  if (toggleAll) {
    toggleAll.checked = allEnabled;
    toggleAll.indeterminate = (someEnabled && !allEnabled) || (allEnabled && entryTogglesVisible);
  }
  const showPerEntry = !allEnabled || entryTogglesVisible;

  detailEntries.innerHTML = entries
    .map((e, i) => {
      const checked = !e.disabled;
      const row = `
      <div class="detail-row${showPerEntry ? "" : " no-toggle"}" data-index="${i}">
        ${showPerEntry ? `<input type="checkbox" class="detail-entry-toggle" data-index="${i}" ${checked ? "checked" : ""}>` : ""}
        <span class="method ${e.method}">${e.method}</span>
        <span class="type">${e.kind || ""}</span>
        <span class="url" title="${esc(e.url)}">${esc(cleanUrl(e.url))}</span>
        <span class="size">${fmtSize(e.body)}</span>
        <span class="status ${statusClass(e.status)}">${e.status || "..."}</span>
        <span class="detail-del" data-index="${i}">x</span>
      </div>`;

      if (i === expandedEntry) {
        const form = `
        <div class="edit-form" data-index="${i}">
          <div class="url-section">
            <div class="url-header">
              <label>URL</label>
              <button class="url-mode" type="button">Parsed</button>
            </div>
            <div class="url-raw">
              <input name="url" value="${esc(e.url)}">
            </div>
            <div class="url-parsed" style="display:none">
              ${(() => {
                try {
                  const u = new URL(e.url);
                  const params = [...u.searchParams.entries()];
                  return (
                    `<input name="url-base" value="${esc(u.origin + u.pathname)}">` +
                    (params.length
                      ? `<div class="payload-parsed" style="margin-top:4px">${params
                          .map(
                            ([k, v]) =>
                              `<div class="payload-field"><label>${esc(k)}<input name="url-param" data-key="${esc(k)}" value="${esc(v)}"></label></div>`,
                          )
                          .join("")}</div>`
                      : "")
                  );
                } catch {
                  return `<input name="url-base" value="${esc(e.url)}">`;
                }
              })()}
            </div>
          </div>
          <div class="edit-row">
            <label>Method
              <select name="method">
                ${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
                  .map(
                    (m) =>
                      `<option ${m === e.method ? "selected" : ""}>${m}</option>`,
                  )
                  .join("")}
              </select>
            </label>
            <label>Status
              <input name="status" type="number" value="${e.status || 200}">
            </label>
            <label>Kind
              <input name="kind" value="${esc(e.kind || "")}">
            </label>
          </div>
          ${renderPayload(e.payload)}
          <div class="edit-actions">
            <button class="save" data-index="${i}">Save</button>
            <button class="cancel">Cancel</button>
          </div>
          <label>Response body</label>
          ${(() => {
            const variants = e.bodyVariants;
            if (variants && variants.length > 0) {
              const active = e.activeVariant || 0;
              return `<div class="variant-bar" data-index="${i}">
                ${variants.map((v, vi) => `<span class="variant-tab ${vi === active ? "active" : ""}" data-vi="${vi}">${esc(v.name)}${vi === active ? `<span class="variant-edit" data-vi="${vi}">edit</span>${variants.length > 1 ? `<span class="variant-del" data-vi="${vi}">x</span>` : ""}` : ""}</span>`).join("")}
                <button class="variant-add" data-index="${i}">+</button>
                <button class="variant-pick" data-index="${i}">Copy from...</button>
              </div>`;
            }
            return `<div class="variant-bar" data-index="${i}">
              <button class="variant-add" data-index="${i}">+</button>
              <button class="variant-pick" data-index="${i}">Copy from...</button>
            </div>`;
          })()}
          <div class="jsoneditor-container" data-index="${i}"></div>
        </div>`;
        return `<div class="detail-entry expanded${e.disabled ? " disabled" : ""}">${row}${form}</div>`;
      }
      return `<div class="detail-entry${e.disabled ? " disabled" : ""}">${row}</div>`;
    })
    .join("");

  // Initialize JSON editor or fallback textarea for expanded entry
  if (activeJsonEditor) {
    activeJsonEditor.destroy();
    activeJsonEditor = null;
  }
  const container = detailEntries.querySelector(".jsoneditor-container");
  if (container) {
    const idx = parseInt(container.dataset.index);
    const body = entries[idx]?.body || "";
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {}
    if (parsed !== undefined) {
      const editorDiv = document.createElement("div");
      container.appendChild(editorDiv);
      activeJsonEditor = new JSONEditor(editorDiv, {
        mode: "tree",
        modes: ["tree", "text"],
        navigationBar: false,
      });
      activeJsonEditor.set(parsed);
    } else {
      const textarea = document.createElement("textarea");
      textarea.name = "body";
      textarea.textContent = body;
      container.replaceWith(textarea);
    }
  }

  // Auto-open rename on a newly added variant
  if (pendingVariantRename) {
    const { entryIndex: ei, variantIndex: vi } = pendingVariantRename;
    pendingVariantRename = null;
    const tab = detailEntries.querySelector(`.variant-bar[data-index="${ei}"] .variant-tab[data-vi="${vi}"] .variant-edit`);
    if (tab) tab.click();
  }
}

backBtn.addEventListener("click", closeDetail);

detailRecordBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    if (res.recording) {
      chrome.runtime.sendMessage(
        { type: "stopRecordInto", recordingId: detailRecordingId },
        () => loadDetail(),
      );
    } else {
      chrome.runtime.sendMessage(
        { type: "startRecord", filters: res.recordFilters, targetId: detailRecordingId },
        () => updateDetailButtons(),
      );
    }
  });
});

detailReplayBtn.addEventListener("click", () => {
  const isReplaying = detailReplayBtn.classList.contains("active-replay");
  const msgType = isReplaying ? "stopReplay" : "startReplay";
  chrome.runtime.sendMessage(
    { type: msgType, recordingId: detailRecordingId },
    () => updateDetailButtons(),
  );
});

// --- Import picker ---
const importBtn = document.getElementById("importBtn");

document.getElementById("dedupeBtn").addEventListener("click", () => {
  chrome.runtime.sendMessage(
    { type: "dedupeEntries", recordingId: detailRecordingId },
    () => loadDetail(),
  );
});

importBtn.addEventListener("click", () => {
  const existing = detailView.querySelector(".import-picker");
  if (existing) {
    existing.remove();
    return;
  }
  showImportPicker();
});

function showImportPicker() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const others = res.recordings.filter((r) => r.id !== detailRecordingId);
    if (others.length === 0) return;

    const picker = document.createElement("div");
    picker.className = "import-picker";

    const header = document.createElement("div");
    header.className = "import-picker-header";
    header.innerHTML =
      `<span class="merge-label">Import from:</span>` +
      others
        .map(
          (r) =>
            `<button class="import-source" data-id="${r.id}">${esc(r.name)}</button>`,
        )
        .join("") +
      `<button class="merge-cancel">Close</button>`;
    picker.appendChild(header);

    const entriesDiv = document.createElement("div");
    entriesDiv.className = "import-entries";
    picker.appendChild(entriesDiv);

    const toolbar = detailView.querySelector(".toolbar");
    toolbar.after(picker);

    const closePicker = () => {
      picker.remove();
      document.removeEventListener("keydown", onKey);
      loadDetail();
    };

    const selectSource = (sourceId) => {
      header
        .querySelectorAll(".import-source")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.id === sourceId),
        );
      chrome.runtime.sendMessage(
        { type: "getRecording", recordingId: sourceId },
        (rec) => {
          if (!rec) {
            entriesDiv.innerHTML = "";
            return;
          }
          entriesDiv.innerHTML =
            rec.entries
              .map(
                (e, i) =>
                  `<div class="import-row" data-index="${i}">
              <span class="method ${e.method}">${e.method}</span>
              <span class="type">${e.kind || ""}</span>
              <span class="url" title="${esc(e.url)}">${esc(cleanUrl(e.url))}</span>
              <span class="size">${fmtSize(e.body)}</span>
              <button class="import-add" data-index="${i}">Add</button>
            </div>`,
              )
              .join("") || '<div class="empty">No entries</div>';

          entriesDiv.onclick = (ev) => {
            const addBtn = ev.target.closest(".import-add");
            if (!addBtn || addBtn.classList.contains("import-added")) return;
            const idx = parseInt(addBtn.dataset.index);
            const entry = rec.entries[idx];
            if (!entry) return;
            chrome.runtime.sendMessage(
              {
                type: "copyEntries",
                targetId: detailRecordingId,
                entries: [entry],
              },
              () => {
                addBtn.textContent = "Added";
                addBtn.classList.add("import-added");
                chrome.runtime.sendMessage(
                  { type: "getRecording", recordingId: detailRecordingId },
                  (updated) => {
                    if (!updated) return;
                    detailAllEntries = updated.entries;
                    detailCount.textContent = `${updated.entries.length} req`;
                    applyDetailFilters();
                  },
                );
              },
            );
          };
        },
      );
    };

    header.addEventListener("click", (ev) => {
      const src = ev.target.closest(".import-source");
      if (src) {
        selectSource(src.dataset.id);
        return;
      }
      if (ev.target.closest(".merge-cancel")) closePicker();
    });

    const onKey = (e) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);
  });
}

// --- Variant picker (copy body from another entry) ---
function showVariantPicker(entryIndex) {
  const existing = detailEntries.querySelector(".variant-picker");
  if (existing) {
    existing.remove();
    return;
  }


  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;

    const picker = document.createElement("div");
    picker.className = "variant-picker";

    const header = document.createElement("div");
    header.className = "variant-picker-header";

    const others = res.recordings.filter((r) => r.id !== detailRecordingId);
    header.innerHTML =
      `<span class="merge-label">Copy body from:</span>` +
      `<button class="variant-picker-source active" data-id="${detailRecordingId}">This recording</button>` +
      others
        .map(
          (r) =>
            `<button class="variant-picker-source" data-id="${r.id}">${esc(r.name)}</button>`,
        )
        .join("") +
      `<button class="merge-cancel">Close</button>`;
    picker.appendChild(header);

    const entriesDiv = document.createElement("div");
    entriesDiv.className = "variant-picker-entries";
    picker.appendChild(entriesDiv);

    // Insert picker after the variant bar
    const variantBar = detailEntries.querySelector(`.variant-bar[data-index="${entryIndex}"]`);
    if (variantBar) {
      variantBar.after(picker);
    }

    const closePicker = () => {
      picker.remove();
      document.removeEventListener("keydown", onKey);
    };

    const loadEntries = (recordingId) => {
      header
        .querySelectorAll(".variant-picker-source")
        .forEach((b) =>
          b.classList.toggle("active", b.dataset.id === recordingId),
        );
      chrome.runtime.sendMessage(
        { type: "getRecording", recordingId },
        (rec) => {
          if (!rec) {
            entriesDiv.innerHTML = "";
            return;
          }
          const isSameRecording = recordingId === detailRecordingId;
          const rows = rec.entries
            .map((e, i) => {
              if (isSameRecording && i === entryIndex) return "";
              return `<div class="variant-picker-row" data-index="${i}">
                <span class="method ${e.method}">${e.method}</span>
                <span class="type">${e.kind || ""}</span>
                <span class="url" title="${esc(e.url)}">${esc(cleanUrl(e.url))}</span>
                <span class="size">${fmtSize(e.body)}</span>
                <button class="variant-picker-add" data-index="${i}">Copy</button>
              </div>`;
            })
            .filter(Boolean)
            .join("");
          entriesDiv.innerHTML = rows || '<div class="empty">No entries</div>';

          entriesDiv.onclick = (ev) => {
            const addBtn = ev.target.closest(".variant-picker-add");
            if (!addBtn) return;
            const idx = parseInt(addBtn.dataset.index);
            const entry = rec.entries[idx];
            if (!entry) return;
            const path = getPath(entry.url);
            const name = path.split("/").filter(Boolean).pop() || "imported";
            closePicker();
            chrome.runtime.sendMessage(
              {
                type: "addVariant",
                recordingId: detailRecordingId,
                index: entryIndex,
                name,
                body: entry.body || "",
              },
              () => {
                // After load, auto-open rename on the new variant (last one)
                chrome.runtime.sendMessage(
                  { type: "getRecording", recordingId: detailRecordingId },
                  (rec) => {
                    if (!rec) return;
                    const entry = rec.entries[entryIndex];
                    if (entry?.bodyVariants) {
                      pendingVariantRename = { entryIndex, variantIndex: entry.bodyVariants.length - 1 };
                    }
                    loadDetail();
                  },
                );
              },
            );
          };
        },
      );
    };

    header.addEventListener("click", (ev) => {
      const src = ev.target.closest(".variant-picker-source");
      if (src) {
        loadEntries(src.dataset.id);
        return;
      }
      if (ev.target.closest(".merge-cancel")) closePicker();
    });

    const onKey = (e) => {
      if (e.key === "Escape") closePicker();
    };
    document.addEventListener("keydown", onKey);

    // Load current recording entries by default
    loadEntries(detailRecordingId);
  });
}


detailView.addEventListener("click", (e) => {
  const titleEl = e.target.closest("#detailTitle");
  if (!titleEl) return;
  const current = titleEl.textContent;
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = current;
  input.style.flex = "1";
  input.style.fontSize = "12px";
  titleEl.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    const name = input.value.trim() || current;
    chrome.runtime.sendMessage(
      { type: "renameRecording", recordingId: detailRecordingId, name },
      () => loadDetail(),
    );
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") commit();
    if (ev.key === "Escape") loadDetail();
  });
  input.addEventListener("blur", commit);
});

detailEntries.addEventListener("click", (e) => {
  const urlModeBtn = e.target.closest(".url-mode");
  if (urlModeBtn) {
    const section = urlModeBtn.closest(".url-section");
    const rawDiv = section.querySelector(".url-raw");
    const parsedDiv = section.querySelector(".url-parsed");
    if (rawDiv.style.display !== "none") {
      const rawUrl = rawDiv.querySelector('[name="url"]').value;
      try {
        const u = new URL(rawUrl);
        parsedDiv.querySelector('[name="url-base"]').value =
          u.origin + u.pathname;
        const params = parsedDiv.querySelectorAll('[name="url-param"]');
        params.forEach((f) => {
          if (u.searchParams.has(f.dataset.key))
            f.value = u.searchParams.get(f.dataset.key);
        });
      } catch {}
      rawDiv.style.display = "none";
      parsedDiv.style.display = "";
      urlModeBtn.textContent = "Raw";
    } else {
      const base = parsedDiv.querySelector('[name="url-base"]').value;
      const params = parsedDiv.querySelectorAll('[name="url-param"]');
      const pairs = [...params].map((f) => [f.dataset.key, f.value]);
      rawDiv.querySelector('[name="url"]').value = buildUrlFromParts(
        base,
        pairs,
      );
      parsedDiv.style.display = "none";
      rawDiv.style.display = "";
      urlModeBtn.textContent = "Parsed";
    }
    return;
  }

  const toggle = e.target.closest(".payload-toggle");
  if (toggle) {
    const section = toggle.closest(".payload-section");
    section.classList.toggle("collapsed");
    return;
  }

  const modeBtn = e.target.closest(".payload-mode");
  if (modeBtn) {
    const section = modeBtn.closest(".payload-section");
    const parsed = section.querySelector(".payload-parsed");
    const raw = section.querySelector(".payload-raw");
    if (modeBtn.dataset.mode === "parsed") {
      const fields = parsed.querySelectorAll('[name="payload-field"]');
      const params = new URLSearchParams();
      fields.forEach((f) => params.set(f.dataset.key, f.value));
      raw.value = params.toString();
      parsed.style.display = "none";
      raw.style.display = "";
      modeBtn.dataset.mode = "raw";
      modeBtn.textContent = "Parsed";
    } else {
      try {
        const params = new URLSearchParams(raw.value);
        const fields = parsed.querySelectorAll('[name="payload-field"]');
        fields.forEach((f) => {
          if (params.has(f.dataset.key))
            f.value = params.get(f.dataset.key);
        });
      } catch {}
      raw.style.display = "none";
      parsed.style.display = "";
      modeBtn.dataset.mode = "parsed";
      modeBtn.textContent = "Raw";
    }
    return;
  }

  const toggleCb = e.target.closest(".detail-entry-toggle");
  if (toggleCb) {
    const idx = parseInt(toggleCb.dataset.index);
    chrome.runtime.sendMessage(
      { type: "toggleEntry", recordingId: detailRecordingId, index: idx },
      () => loadDetail(),
    );
    return;
  }

  const delEl = e.target.closest(".detail-del");
  if (delEl) {
    const idx = parseInt(delEl.dataset.index);
    chrome.runtime.sendMessage(
      { type: "deleteEntry", recordingId: detailRecordingId, index: idx },
      () => {
        expandedEntry = -1;
        loadDetail();
      },
    );
    return;
  }

  const variantAdd = e.target.closest(".variant-add");
  if (variantAdd) {
    const idx = parseInt(variantAdd.dataset.index);
    let body;
    if (activeJsonEditor) {
      try { body = JSON.stringify(activeJsonEditor.get()); } catch { body = ""; }
    } else {
      const form = detailEntries.querySelector(`.edit-form[data-index="${idx}"]`);
      body = (form?.querySelector('[name="body"]') || {}).value || "";
    }
    chrome.runtime.sendMessage(
      { type: "addVariant", recordingId: detailRecordingId, index: idx, name: `variant ${Date.now() % 1000}`, body },
      () => loadDetail(),
    );
    return;
  }

  const variantPick = e.target.closest(".variant-pick");
  if (variantPick) {
    const idx = parseInt(variantPick.dataset.index);
    showVariantPicker(idx);
    return;
  }

  const variantEdit = e.target.closest(".variant-edit");
  if (variantEdit) {
    const tab = variantEdit.closest(".variant-tab");
    const bar = tab.closest(".variant-bar");
    const idx = parseInt(bar.dataset.index);
    const vi = parseInt(tab.dataset.vi);
    // Get the name text (tab text minus the "edit" button text)
    const currentName = tab.childNodes[0].textContent.trim();
    const input = document.createElement("input");
    input.className = "variant-rename";
    input.value = currentName;
    // Lock tab to its current width so removing edit/x buttons causes no shift
    const tabWidth = tab.offsetWidth;
    tab.style.width = tabWidth + "px";
    // Replace tab contents with input
    tab.innerHTML = "";
    tab.appendChild(input);
    input.size = currentName.length || 1;
    input.addEventListener("input", () => {
      input.size = input.value.length || 1;
      // If input outgrows the locked width, let tab expand
      tab.style.width = "";
      tab.style.minWidth = tabWidth + "px";
    });
    input.focus();
    input.select();
    const commit = () => {
      const name = input.value.trim() || currentName;
      chrome.runtime.sendMessage(
        { type: "renameVariant", recordingId: detailRecordingId, index: idx, variantIndex: vi, name },
        () => loadDetail(),
      );
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") loadDetail();
    });
    input.addEventListener("blur", commit);
    e.stopPropagation();
    return;
  }

  const variantDel = e.target.closest(".variant-del");
  if (variantDel) {
    const bar = variantDel.closest(".variant-bar");
    const idx = parseInt(bar.dataset.index);
    const vi = parseInt(variantDel.dataset.vi);
    chrome.runtime.sendMessage(
      { type: "deleteVariant", recordingId: detailRecordingId, index: idx, variantIndex: vi },
      () => loadDetail(),
    );
    return;
  }

  const variantTab = e.target.closest(".variant-tab");
  if (variantTab) {
    const bar = variantTab.closest(".variant-bar");
    const idx = parseInt(bar.dataset.index);
    const vi = parseInt(variantTab.dataset.vi);
    chrome.runtime.sendMessage(
      { type: "setActiveVariant", recordingId: detailRecordingId, index: idx, variantIndex: vi },
      () => loadDetail(),
    );
    return;
  }

  const saveBtn = e.target.closest(".save");
  if (saveBtn) {
    const idx = parseInt(saveBtn.dataset.index);
    const form = detailEntries.querySelector(
      `.edit-form[data-index="${idx}"]`,
    );
    const payload = collectPayload(form);
    let body;
    if (activeJsonEditor) {
      try {
        body = JSON.stringify(activeJsonEditor.get());
      } catch {
        body = "";
      }
    } else {
      body = (form.querySelector('[name="body"]') || {}).value || "";
    }
    let url;
    const urlParsed = form.querySelector(".url-parsed");
    if (urlParsed && urlParsed.style.display !== "none") {
      const base = urlParsed.querySelector('[name="url-base"]').value;
      const params = urlParsed.querySelectorAll('[name="url-param"]');
      const pairs = [...params].map((f) => [f.dataset.key, f.value]);
      url = buildUrlFromParts(base, pairs);
    } else {
      url = form.querySelector('[name="url"]').value;
    }
    const entry = detailAllEntries[idx];
    const updates = {
      url,
      method: form.querySelector('[name="method"]').value,
      status: parseInt(form.querySelector('[name="status"]').value) || 200,
      kind: form.querySelector('[name="kind"]').value,
      body,
    };
    if (entry?.bodyVariants) {
      const active = entry.activeVariant || 0;
      const variants = entry.bodyVariants.map((v, i) =>
        i === active ? { ...v, body } : v,
      );
      updates.bodyVariants = variants;
    }
    if (payload !== null) updates.payload = payload;
    saveBtn.classList.add("saved");
    setTimeout(() => saveBtn.classList.remove("saved"), 200);
    chrome.runtime.sendMessage({
      type: "updateEntry",
      recordingId: detailRecordingId,
      index: idx,
      updates,
    });
    return;
  }

  if (e.target.closest(".cancel")) {
    expandedEntry = -1;
    loadDetail();
    return;
  }

  const row = e.target.closest(".detail-row");
  if (row && !e.target.closest(".detail-entry-toggle")) {
    const idx = parseInt(row.dataset.index);
    expandedEntry = expandedEntry === idx ? -1 : idx;
    loadDetail();
  }
});

// --- Init ---
renderFilters();
renderIgnoreBar();
renderOriginGroups();
refresh();

// Auto-open recording detail if ?recording=ID is in the URL
const urlRecordingId = new URLSearchParams(location.search).get("recording");
if (urlRecordingId) {
  // Wait for first refresh to load recordings, then open detail
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (res?.recordings?.some((r) => r.id === urlRecordingId)) {
      openDetail(urlRecordingId);
    }
  });
}
setInterval(() => {
  if (currentView === "main") {
    refresh();
  } else {
    updateDetailButtons();
    // Live-refresh entry list during recording
    if (detailRecordBtn.classList.contains("recording")) {
      refreshDetailEntries();
    }
  }
}, 500);
