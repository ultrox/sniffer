// --- Elements ---
const mainView = document.getElementById("mainView");
const detailView = document.getElementById("detailView");
const toggleBtn = document.getElementById("toggle");
const recordBtn = document.getElementById("record");
const clearBtn = document.getElementById("clear");
const countEl = document.getElementById("count");
const filtersEl = document.getElementById("filters");
const statusBar = document.getElementById("statusBar");
const requestsEl = document.getElementById("requests");
const recCountEl = document.getElementById("recCount");
const recordingsEl = document.getElementById("recordings");
const backBtn = document.getElementById("backBtn");
const detailTitle = document.getElementById("detailTitle");
const detailCount = document.getElementById("detailCount");
const detailEntries = document.getElementById("detailEntries");

const ignoreBar = document.getElementById("ignoreBar");

// --- State ---
const ALL_TYPES = ["xhr", "fetch", "script", "css", "img", "font", "doc", "other"];
let activeFilters = ["xhr", "fetch"];
let ignorePatterns = [];
let currentView = "main"; // 'main' | 'detail'
let detailRecordingId = null;
let expandedEntry = -1;

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

// --- Ignore patterns ---
function renderIgnorePatterns() {
  const tags = ignorePatterns
    .map(
      (p) =>
        `<span class="ignore-tag" data-pattern="${esc(p)}">${esc(p)} <span class="remove">x</span></span>`
    )
    .join("");
  ignoreBar.innerHTML = tags + `<input id="ignoreInput" placeholder="Ignore pattern... (Enter to add)">`;
  const input = document.getElementById("ignoreInput");
  input.addEventListener("keydown", onIgnoreKey);
}

function onIgnoreKey(e) {
  if (e.key !== "Enter") return;
  const val = e.target.value.trim();
  if (!val) return;
  e.target.value = "";
  chrome.runtime.sendMessage({ type: "addIgnore", pattern: val }, (res) => {
    if (res?.ignorePatterns) ignorePatterns = res.ignorePatterns;
    renderIgnorePatterns();
  });
}

ignoreBar.addEventListener("click", (e) => {
  const rm = e.target.closest(".remove");
  if (!rm) return;
  const tag = rm.closest(".ignore-tag");
  const pattern = tag?.dataset.pattern;
  if (!pattern) return;
  chrome.runtime.sendMessage({ type: "removeIgnore", pattern }, (res) => {
    if (res?.ignorePatterns) ignorePatterns = res.ignorePatterns;
    renderIgnorePatterns();
  });
});

// --- Main view rendering ---
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
    </div>`
    )
    .join("");
}

function renderRecordings(recs, replayRecordingId) {
  recCountEl.textContent = recs.length ? `(${recs.length})` : "";
  if (recs.length === 0) {
    recordingsEl.innerHTML =
      '<div class="empty" style="padding:16px">No recordings yet</div>';
    return;
  }
  recordingsEl.innerHTML = recs
    .toReversed()
    .map(
      (r) => `
    <div class="rec-item" data-id="${r.id}">
      <span class="rec-name" data-id="${r.id}" title="Click to view/edit">${esc(r.name)}</span>
      <span class="rec-meta">${r.count} req - ${timeAgo(r.timestamp)}</span>
      <button class="edit" data-id="${r.id}">Edit</button>
      <button class="replay ${replayRecordingId === r.id ? "active-replay" : ""}" data-id="${r.id}">
        ${replayRecordingId === r.id ? "Stop" : "Replay"}
      </button>
      <button class="del" data-id="${r.id}">x</button>
    </div>`
    )
    .join("");
}

function refresh() {
  if (currentView !== "main") return;
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;

    activeFilters = res.recordFilters || activeFilters;
    renderFilters();

    if (JSON.stringify(ignorePatterns) !== JSON.stringify(res.ignorePatterns || [])) {
      ignorePatterns = res.ignorePatterns || [];
      renderIgnorePatterns();
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
      statusBar.textContent = `RECORDING — ${res.recordEntries.length} requests captured`;
    } else if (res.replaying) {
      statusBar.classList.add("replaying");
      const rec = res.recordings.find((r) => r.id === res.replayRecordingId);
      statusBar.textContent = `REPLAYING — ${rec?.name || "recording"}`;
    }

    if (res.recording) {
      renderRequests(res.recordEntries);
    } else {
      renderRequests(res.requests);
    }

    renderRecordings(res.recordings, res.replayRecordingId);
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
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

  if (btn.classList.contains("edit")) {
    openDetail(id);
    return;
  }

  if (btn.classList.contains("replay")) {
    chrome.runtime.sendMessage({ type: "getState" }, (res) => {
      if (res.replayRecordingId === id) {
        chrome.runtime.sendMessage({ type: "stopReplay" }, () => refresh());
      } else {
        chrome.runtime.sendMessage(
          { type: "startReplay", recordingId: id },
          () => refresh()
        );
      }
    });
  }

  if (btn.classList.contains("del")) {
    chrome.runtime.sendMessage(
      { type: "deleteRecording", recordingId: id },
      () => refresh()
    );
  }
});

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
  currentView = "main";
  detailView.style.display = "none";
  mainView.style.display = "block";
  refresh();
}

function loadDetail() {
  chrome.runtime.sendMessage(
    { type: "getRecording", recordingId: detailRecordingId },
    (rec) => {
      if (!rec) {
        closeDetail();
        return;
      }
      detailTitle.textContent = rec.name;
      detailCount.textContent = `${rec.entries.length} req`;
      renderDetailEntries(rec.entries);
    }
  );
}

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
          <label>Response body
            <textarea name="body">${esc(e.body || "")}</textarea>
          </label>
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
}

backBtn.addEventListener("click", closeDetail);

detailEntries.addEventListener("click", (e) => {
  // Delete entry
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

  // Save edit
  const saveBtn = e.target.closest(".save");
  if (saveBtn) {
    const idx = parseInt(saveBtn.dataset.index);
    const form = detailEntries.querySelector(
      `.edit-form[data-index="${idx}"]`
    );
    const updates = {
      url: form.querySelector('[name="url"]').value,
      method: form.querySelector('[name="method"]').value,
      status: parseInt(form.querySelector('[name="status"]').value) || 200,
      kind: form.querySelector('[name="kind"]').value,
      body: form.querySelector('[name="body"]').value,
    };
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

  // Cancel edit
  if (e.target.closest(".cancel")) {
    expandedEntry = -1;
    loadDetail();
    return;
  }

  // Click row to expand/collapse
  const row = e.target.closest(".detail-row");
  if (row) {
    const idx = parseInt(row.dataset.index);
    expandedEntry = expandedEntry === idx ? -1 : idx;
    loadDetail();
  }
});

// --- Init ---
renderFilters();
refresh();
setInterval(refresh, 500);
