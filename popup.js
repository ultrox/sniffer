const toggleBtn = document.getElementById("toggle");
const recordBtn = document.getElementById("record");
const clearBtn = document.getElementById("clear");
const countEl = document.getElementById("count");
const requestsEl = document.getElementById("requests");
const recHeaderEl = document.getElementById("recHeader");
const recCountEl = document.getElementById("recCount");
const recordingsEl = document.getElementById("recordings");

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

function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

function renderRequests(requests) {
  countEl.textContent = `${requests.length} req`;
  if (requests.length === 0) {
    requestsEl.innerHTML = '<div class="empty">No requests captured</div>';
    return;
  }
  requestsEl.innerHTML = requests
    .slice()
    .reverse()
    .map(
      (r) => `
    <div class="req">
      <span class="method ${r.method}">${r.method}</span>
      <span class="type">${r.type || ""}</span>
      <span class="url" title="${r.url}">${cleanUrl(r.url)}</span>
      <span class="status ${statusClass(r.status)}">${r.status || "..."}</span>
    </div>`
    )
    .join("");
}

function renderRecordings(recordings, replayRecordingId) {
  recCountEl.textContent = recordings.length ? `(${recordings.length})` : "";
  if (recordings.length === 0) {
    recordingsEl.innerHTML =
      '<div class="empty" style="padding:16px">No recordings yet</div>';
    return;
  }
  recordingsEl.innerHTML = recordings
    .slice()
    .reverse()
    .map(
      (r) => `
    <div class="rec-item" data-id="${r.id}">
      <span class="rec-name" title="${r.name}">${r.name}</span>
      <span class="rec-meta">${r.count} req - ${timeAgo(r.timestamp)}</span>
      <button class="replay ${replayRecordingId === r.id ? "active-replay" : ""}" data-id="${r.id}">
        ${replayRecordingId === r.id ? "Stop" : "Replay"}
      </button>
      <button class="del" data-id="${r.id}">x</button>
    </div>`
    )
    .join("");
}

function refresh() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;

    // Sniff button
    toggleBtn.classList.toggle("active", res.sniffing);
    toggleBtn.textContent = res.sniffing ? "Stop" : "Sniff";

    // Record button
    recordBtn.classList.remove("recording", "replaying");
    if (res.recording) {
      recordBtn.classList.add("recording");
      recordBtn.textContent = `Stop (${res.recordEntryCount})`;
    } else {
      recordBtn.textContent = "Record";
    }

    renderRequests(res.requests);
    renderRecordings(res.recordings, res.replayRecordingId);
  });
}

toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "toggle" }, () => refresh());
});

recordBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const msg = res.recording ? "stopRecord" : "startRecord";
    chrome.runtime.sendMessage({ type: msg }, () => refresh());
  });
});

clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clear" }, () => refresh());
});

recordingsEl.addEventListener("click", (e) => {
  const btn = e.target.closest("button");
  if (!btn) return;
  const id = btn.dataset.id;

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

refresh();
setInterval(refresh, 500);
