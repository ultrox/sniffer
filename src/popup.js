// --- Elements ---
const mainView = document.getElementById("mainView");
const detailView = document.getElementById("detailView");
const toggleBtn = document.getElementById("toggle");
const recordBtn = document.getElementById("record");
const clearBtn = document.getElementById("clear");
const countEl = document.getElementById("count");
const filtersEl = document.getElementById("filters");
const ignoreBar = document.getElementById("ignoreBar");
const statusBar = document.getElementById("statusBar");
const requestsEl = document.getElementById("requests");
const recCountEl = document.getElementById("recCount");
const recordingsEl = document.getElementById("recordings");
const backBtn = document.getElementById("backBtn");
const detailCount = document.getElementById("detailCount");
const detailPathFilter = document.getElementById("detailPathFilter");
const detailBodyFilter = document.getElementById("detailBodyFilter");
const detailEntries = document.getElementById("detailEntries");
const detailReplayBtn = document.getElementById("detailReplayBtn");

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
let currentView = "main";
let detailRecordingId = null;
let expandedEntry = -1;
let isRenaming = false;
let isMerging = false;
let activeJsonEditor = null;

// --- Helpers ---
function statusClass(code) {
  if (!code) return "";
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redir";
  return "err";
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function getPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function isFormEncoded(str) {
  if (!str || str.startsWith("{") || str.startsWith("[")) return false;
  return str.includes("=") && !str.includes("\n");
}

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
          </div>`
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

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function renderIgnoreTags(patterns) {
  return patterns
    .map(
      (p) =>
        `<span class="ignore-tag" data-pattern="${esc(p)}">${esc(p)} <span class="remove">x</span></span>`
    )
    .join("");
}

// --- Filter chips ---
function renderFilters() {
  filtersEl.innerHTML = ALL_TYPES.map(
    (t) =>
      `<span class="chip ${activeFilters.includes(t) ? "on" : ""}" data-type="${t}">${t}</span>`
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
        }
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

// --- Request list ---
function renderRequests(items) {
  countEl.textContent = `${items.length} req`;
  if (items.length === 0) {
    requestsEl.innerHTML = '<div class="empty">No requests captured</div>';
    return;
  }
  requestsEl.innerHTML = items
    .toReversed()
    .map(
      (r) => `
    <div class="req">
      <span class="method ${r.method}">${r.method}</span>
      <span class="type">${r.type || r.kind || ""}</span>
      <span class="url" title="${esc(r.url)}">${esc(cleanUrl(r.url))}</span>
      <span class="status ${statusClass(r.status)}">${r.status || "..."}</span>
      <span class="req-ignore" data-path="${esc(getPath(r.url))}" title="Ignore ${esc(getPath(r.url))}">ban</span>
    </div>`
    )
    .join("");
}

requestsEl.addEventListener("click", (e) => {
  const ban = e.target.closest(".req-ignore");
  if (!ban) return;
  const path = ban.dataset.path;
  if (!path) return;
  chrome.runtime.sendMessage({ type: "addIgnore", pattern: path }, (res) => {
    if (res?.ignorePatterns) ignorePatterns = res.ignorePatterns;
    renderIgnoreBar();
  });
});

// --- Recordings list ---
function renderRecordings(recs, activeReplays) {
  recCountEl.textContent = recs.length ? `(${recs.length})` : "";
  if (recs.length === 0) {
    recordingsEl.innerHTML =
      '<div class="empty" style="padding:16px">No recordings yet</div>';
    return;
  }
  recordingsEl.innerHTML = recs
    .toReversed()
    .map(
      (r) => {
        const isReplaying = r.id in (activeReplays || {});
        return `
    <div class="rec-item" data-id="${r.id}">
      <span class="rec-name" data-id="${r.id}" title="Click to rename">${esc(r.name)}</span>
      <span class="rec-meta">${r.count} req - ${timeAgo(r.timestamp)}</span>
      <button class="edit" data-id="${r.id}">Edit</button>
      <button class="merge" data-id="${r.id}">Merge</button>
      <button class="replay ${isReplaying ? "active-replay" : ""}" data-id="${r.id}">
        ${isReplaying ? "Stop" : "Replay"}
      </button>
      <button class="del" data-id="${r.id}">x</button>
    </div>`;
      }
    )
    .join("");
}

// --- Refresh (main view) ---
function refresh() {
  if (currentView !== "main") return;
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;

    activeFilters = res.recordFilters || activeFilters;
    renderFilters();

    if (JSON.stringify(ignorePatterns) !== JSON.stringify(res.ignorePatterns || [])) {
      ignorePatterns = res.ignorePatterns || [];
      renderIgnoreBar();
    }

    toggleBtn.classList.toggle("active", res.sniffing);
    toggleBtn.textContent = res.sniffing ? "Stop" : "Sniff";

    recordBtn.classList.remove("recording");
    if (res.recording) {
      recordBtn.classList.add("recording");
      recordBtn.textContent = `Stop (${res.recordEntries.length})`;
    } else {
      recordBtn.textContent = "Record";
    }

    statusBar.className = "status-bar";
    if (res.recording) {
      statusBar.classList.add("recording");
      statusBar.textContent = `RECORDING - ${res.recordEntries.length} requests captured`;
    } else if (res.replaying) {
      statusBar.classList.add("replaying");
      const replayIds = Object.keys(res.activeReplays || {});
      const names = replayIds
        .map((id) => res.recordings.find((r) => r.id === id)?.name)
        .filter(Boolean);
      statusBar.textContent = `REPLAYING - ${names.join(", ") || "recording"}`;
    }

    if (res.recording) {
      renderRequests(res.recordEntries);
    } else {
      renderRequests(res.requests);
    }

    if (!isRenaming && !isMerging) renderRecordings(res.recordings, res.activeReplays);
  });
}

// --- Main view events ---
toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "toggle" }, () => refresh());
});

recordBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    if (res.recording) {
      chrome.runtime.sendMessage({ type: "stopRecord" }, () => refresh());
    } else {
      chrome.runtime.sendMessage(
        { type: "startRecord", filters: activeFilters },
        () => refresh()
      );
    }
  });
});

clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clear" }, () => refresh());
});

recordingsEl.addEventListener("click", (e) => {
  const nameEl = e.target.closest(".rec-name");
  if (nameEl && !e.target.closest("button")) {
    const id = nameEl.dataset.id;
    const current = nameEl.textContent;
    const input = document.createElement("input");
    input.className = "rename-input";
    input.value = current;
    isRenaming = true;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    const commit = () => {
      isRenaming = false;
      const name = input.value.trim() || current;
      chrome.runtime.sendMessage(
        { type: "renameRecording", recordingId: id, name },
        () => refresh()
      );
    };
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") commit();
      if (ev.key === "Escape") { isRenaming = false; refresh(); }
    });
    input.addEventListener("blur", commit);
    return;
  }

  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains("edit")) {
    openDetail(id);
    return;
  }

  if (btn.classList.contains("replay")) {
    if (btn.classList.contains("active-replay")) {
      chrome.runtime.sendMessage(
        { type: "stopReplay", recordingId: id },
        () => refresh()
      );
    } else {
      chrome.runtime.sendMessage(
        { type: "startReplay", recordingId: id },
        () => refresh()
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
      () => refresh()
    );
  }
});

// --- Merge picker ---
function showMergePicker(sourceId) {
  const row = recordingsEl.querySelector(`.rec-item[data-id="${sourceId}"]`);
  if (!row) return;
  const existing = recordingsEl.querySelector(".merge-picker");
  if (existing) { existing.remove(); isMerging = false; }

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
            `<button class="merge-target" data-id="${r.id}">${esc(r.name)}</button>`
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
          }
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
  currentView = "detail";
  mainView.style.display = "none";
  detailView.style.display = "block";
  loadDetail();
}

function closeDetail() {
  if (activeJsonEditor) { activeJsonEditor.destroy(); activeJsonEditor = null; }
  currentView = "main";
  detailView.style.display = "none";
  mainView.style.display = "block";
  refresh();
}

function updateDetailReplayBtn() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const isReplaying = detailRecordingId in (res.activeReplays || {});
    detailReplayBtn.textContent = isReplaying ? "Stop" : "Replay";
    detailReplayBtn.classList.toggle("active-replay", isReplaying);
  });
}

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
        // Re-create if it was replaced by rename input
        const span = document.createElement("span");
        span.id = "detailTitle";
        span.style.cssText = "flex:1; font-size:12px; cursor:pointer";
        span.title = "Click to rename";
        span.textContent = rec.name;
        const toolbar = detailView.querySelector(".toolbar");
        const renameInput = toolbar.querySelector(".rename-input");
        if (renameInput) renameInput.replaceWith(span);
      }
      detailCount.textContent = `${rec.entries.length} req`;
      detailAllEntries = rec.entries;
      detailPathFilter.value = "";
      detailBodyFilter.value = "";
      renderDetailEntries(rec.entries);
      updateDetailReplayBtn();
    }
  );
}

let detailAllEntries = [];

function applyDetailFilters() {
  const pathQ = detailPathFilter.value.trim().toLowerCase();
  const bodyQ = detailBodyFilter.value.trim().toLowerCase();
  if (!pathQ && !bodyQ) {
    renderDetailEntries(detailAllEntries);
    return;
  }
  const filtered = detailAllEntries.filter((e) => {
    if (pathQ && !e.url.toLowerCase().includes(pathQ)) return false;
    if (bodyQ && !(e.body || "").toLowerCase().includes(bodyQ)) return false;
    return true;
  });
  renderDetailEntries(filtered);
}

detailPathFilter.addEventListener("input", applyDetailFilters);
detailBodyFilter.addEventListener("input", applyDetailFilters);

function renderDetailEntries(entries) {
  if (entries.length === 0) {
    detailEntries.innerHTML =
      '<div class="empty">No entries in this recording</div>';
    return;
  }

  detailEntries.innerHTML = entries
    .map((e, i) => {
      const row = `
      <div class="detail-row" data-index="${i}">
        <span class="method ${e.method}">${e.method}</span>
        <span class="type">${e.kind || ""}</span>
        <span class="url" title="${esc(e.url)}">${esc(cleanUrl(e.url))}</span>
        <span class="status ${statusClass(e.status)}">${e.status || "..."}</span>
        <span class="detail-del" data-index="${i}">x</span>
      </div>`;

      if (i === expandedEntry) {
        const form = `
        <div class="edit-form" data-index="${i}">
          <label>URL
            <input name="url" value="${esc(e.url)}">
          </label>
          <div class="edit-row">
            <label>Method
              <select name="method">
                ${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]
                  .map(
                    (m) =>
                      `<option ${m === e.method ? "selected" : ""}>${m}</option>`
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
          <label>Response body</label>
          <div class="jsoneditor-container" data-index="${i}"></div>
          <div class="edit-actions">
            <button class="save" data-index="${i}">Save</button>
            <button class="cancel">Cancel</button>
          </div>
        </div>`;
        return `<div class="detail-entry expanded">${row}${form}</div>`;
      }
      return `<div class="detail-entry">${row}</div>`;
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
      editorDiv.style.height = "700px";
      container.appendChild(editorDiv);
      activeJsonEditor = new JSONEditor(editorDiv, {
        mode: "tree",
        modes: ["tree", "view"],
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
}

backBtn.addEventListener("click", closeDetail);

detailReplayBtn.addEventListener("click", () => {
  const isReplaying = detailReplayBtn.classList.contains("active-replay");
  const msgType = isReplaying ? "stopReplay" : "startReplay";
  chrome.runtime.sendMessage(
    { type: msgType, recordingId: detailRecordingId },
    () => updateDetailReplayBtn()
  );
});

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
      () => loadDetail()
    );
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") commit();
    if (ev.key === "Escape") loadDetail();
  });
  input.addEventListener("blur", commit);
});

detailEntries.addEventListener("click", (e) => {
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
      // Sync fields to raw before switching
      const fields = parsed.querySelectorAll('[name="payload-field"]');
      const params = new URLSearchParams();
      fields.forEach((f) => params.set(f.dataset.key, f.value));
      raw.value = params.toString();
      parsed.style.display = "none";
      raw.style.display = "";
      modeBtn.dataset.mode = "raw";
      modeBtn.textContent = "Parsed";
    } else {
      // Sync raw to fields before switching
      try {
        const params = new URLSearchParams(raw.value);
        const fields = parsed.querySelectorAll('[name="payload-field"]');
        fields.forEach((f) => {
          if (params.has(f.dataset.key)) f.value = params.get(f.dataset.key);
        });
      } catch {}
      raw.style.display = "none";
      parsed.style.display = "";
      modeBtn.dataset.mode = "parsed";
      modeBtn.textContent = "Raw";
    }
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
      }
    );
    return;
  }

  const saveBtn = e.target.closest(".save");
  if (saveBtn) {
    const idx = parseInt(saveBtn.dataset.index);
    const form = detailEntries.querySelector(
      `.edit-form[data-index="${idx}"]`
    );
    const payload = collectPayload(form);
    let body;
    if (activeJsonEditor) {
      try { body = JSON.stringify(activeJsonEditor.get()); } catch { body = ""; }
    } else {
      body = (form.querySelector('[name="body"]') || {}).value || "";
    }
    const updates = {
      url: form.querySelector('[name="url"]').value,
      method: form.querySelector('[name="method"]').value,
      status: parseInt(form.querySelector('[name="status"]').value) || 200,
      kind: form.querySelector('[name="kind"]').value,
      body,
    };
    if (payload !== null) updates.payload = payload;
    chrome.runtime.sendMessage(
      {
        type: "updateEntry",
        recordingId: detailRecordingId,
        index: idx,
        updates,
      },
      () => {
        expandedEntry = -1;
        loadDetail();
      }
    );
    return;
  }

  if (e.target.closest(".cancel")) {
    expandedEntry = -1;
    loadDetail();
    return;
  }

  const row = e.target.closest(".detail-row");
  if (row) {
    const idx = parseInt(row.dataset.index);
    expandedEntry = expandedEntry === idx ? -1 : idx;
    loadDetail();
  }
});

// --- Init ---
renderFilters();
renderIgnoreBar();
refresh();
setInterval(refresh, 500);
