const buttons = document.querySelectorAll("[data-corner]");
const recsEl = document.getElementById("recs");

chrome.storage.local.get("snifferCorner", (res) => {
  const current = res.snifferCorner || "br";
  for (const btn of buttons) {
    if (btn.dataset.corner === current) btn.classList.add("active");
  }
});

for (const btn of buttons) {
  btn.addEventListener("click", () => {
    const c = btn.dataset.corner;
    chrome.storage.local.set({ snifferCorner: c });
    for (const b of buttons) b.classList.toggle("active", b.dataset.corner === c);

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          source: "sniffer-bg",
          type: "setCorner",
          corner: c,
        });
      }
    });
  });
}

document.getElementById("dashboard").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    chrome.runtime.sendMessage({
      type: "openDashboard",
      tabId: tab?.id ?? null,
    });
    window.close();
  });
});

function render() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    const recs = res.recordings || [];
    if (recs.length === 0) {
      recsEl.innerHTML = '<div class="empty">No recordings</div>';
      return;
    }
    recsEl.innerHTML = recs.map((r) => {
      const replaying = res.activeReplays?.[r.id];
      const recordingHere = res.recording && res.recordTargetId === r.id;
      return `<div class="rec" data-id="${r.id}">
        <span class="rec-name">${esc(r.name)}</span>
        <button class="rec-btn ${recordingHere ? "recording" : ""}" data-action="record" data-id="${r.id}">${recordingHere ? "Stop" : "Rec"}</button>
        <button class="rec-btn ${replaying ? "on" : ""}" data-action="replay" data-id="${r.id}">${replaying ? "Stop" : "Play"}</button>
      </div>`;
    }).join("");
  });
}

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
}

recsEl.addEventListener("click", (e) => {
  const btn = e.target.closest(".rec-btn");
  if (btn) {
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (action === "replay") {
      const isOn = btn.classList.contains("on");
      chrome.runtime.sendMessage(
        { type: isOn ? "stopReplay" : "startReplay", recordingId: id },
        () => render(),
      );
    } else if (action === "record") {
      const isRec = btn.classList.contains("recording");
      if (isRec) {
        chrome.runtime.sendMessage(
          { type: "stopRecordInto", recordingId: id },
          () => render(),
        );
      } else {
        chrome.runtime.sendMessage({ type: "getState" }, (res) => {
          chrome.runtime.sendMessage(
            { type: "startRecord", filters: res?.recordFilters || ["xhr", "fetch"], targetId: id },
            () => render(),
          );
        });
      }
    }
    return;
  }

  const name = e.target.closest(".rec-name");
  if (name) {
    const id = name.closest(".rec").dataset.id;
    chrome.runtime.sendMessage({ type: "openRecording", recordingId: id });
    window.close();
  }
});

render();
