import {
  findMatch,
  substituteParams,
} from "./logic/matching.js";

(function () {
  let mode = null;
  let replayEntries = [];
  let originGroups = [];

  const origFetch = window.fetch;
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  const SKIP_CONTENT_TYPES = /^(image|video|audio|font)\//;

  function post(data) {
    window.postMessage({ source: "sniffer-intercept", ...data }, "*");
  }

  // --- Request-response helper (via bridge) ---
  function request(data) {
    return new Promise((resolve) => {
      const id = Math.random().toString(36).slice(2);
      const handler = (e) => {
        if (e.data?.source === "sniffer-bg" && e.data.type === "_response" && e.data._reqId === id) {
          window.removeEventListener("message", handler);
          resolve(e.data.data);
        }
      };
      window.addEventListener("message", handler);
      post({ ...data, _reqId: id });
    });
  }

  function doFindMatch(url, method) {
    return findMatch(url, method, replayEntries, originGroups);
  }

  // --- Patch fetch ---
  window.fetch = async function (...args) {
    const req = new Request(...args);
    const url = req.url;
    const method = req.method;

    if (mode === "replay") {
      const result = doFindMatch(url, method);
      if (result) {
        post({ type: "replayed" });
        const body = substituteParams(result.entry.body, result.params);
        return new Response(body, {
          status: result.entry.status,
          statusText: result.entry.statusText || "",
          headers: result.entry.headers || {},
        });
      }
    }

    const response = await origFetch.apply(this, args);

    if (mode === "record") {
      const ct = response.headers.get("content-type") || "";
      if (!SKIP_CONTENT_TYPES.test(ct)) {
        const clone = response.clone();
        try {
          const body = await clone.text();
          let payload = null;
          try {
            payload = await req.clone().text();
          } catch {}
          post({
            type: "captured",
            entry: {
              url,
              method,
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body,
              payload: payload || undefined,
              kind: "fetch",
              time: Date.now(),
            },
          });
        } catch {}
      }
    }

    return response;
  };

  // --- Patch XHR ---
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._sniffer = { method, url: new URL(url, location.href).href };
    return origXHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (!this._sniffer) return origXHRSend.call(this, body);

    const { url, method } = this._sniffer;

    if (mode === "replay") {
      const result = doFindMatch(url, method);
      if (result) {
        post({ type: "replayed" });
        const responseBody = substituteParams(result.entry.body, result.params);
        Object.defineProperty(this, "readyState", { value: 4 });
        Object.defineProperty(this, "status", { value: result.entry.status });
        Object.defineProperty(this, "statusText", {
          value: result.entry.statusText || "",
        });
        Object.defineProperty(this, "responseText", { value: responseBody });
        Object.defineProperty(this, "response", { value: responseBody });
        const self = this;
        setTimeout(() => {
          self.dispatchEvent(new Event("readystatechange"));
          self.dispatchEvent(new ProgressEvent("load"));
          self.dispatchEvent(new ProgressEvent("loadend"));
          if (self.onreadystatechange)
            self.onreadystatechange(new Event("readystatechange"));
          if (self.onload) self.onload(new ProgressEvent("load"));
          if (self.onloadend) self.onloadend(new ProgressEvent("loadend"));
        }, 0);
        return;
      }
    }

    if (mode === "record") {
      const payload = body || undefined;
      this.addEventListener("load", () => {
        const ct = this.getResponseHeader("content-type") || "";
        if (SKIP_CONTENT_TYPES.test(ct)) return;
        try {
          post({
            type: "captured",
            entry: {
              url,
              method,
              status: this.status,
              statusText: this.statusText,
              body: this.responseText,
              payload,
              kind: "xhr",
              time: Date.now(),
            },
          });
        } catch {}
      });
    }

    return origXHRSend.call(this, body);
  };

  // --- Page controls UI ---
  let panelOpen = false;
  let badgeEl = null;
  let panelEl = null;
  let wrapperEl = null;

  function esc(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }

  function ensureWrapper() {
    if (wrapperEl) return;
    wrapperEl = document.createElement("div");
    wrapperEl.id = "__sniffer_ui__";
    const ws = wrapperEl.style;
    ws.cssText = "position:fixed;bottom:12px;right:12px;z-index:2147483647;font:11px/1.4 monospace;color:#fff;";
    document.documentElement.appendChild(wrapperEl);
  }

  function renderBadge() {
    ensureWrapper();

    if (!badgeEl) {
      badgeEl = document.createElement("button");
      badgeEl.style.cssText = "padding:5px 10px;border-radius:6px;cursor:pointer;user-select:none;border:none;font:bold 11px/1 monospace;color:#fff;opacity:0.9;display:block;margin-left:auto;";
      badgeEl.addEventListener("mouseenter", () => { badgeEl.style.opacity = "1"; });
      badgeEl.addEventListener("mouseleave", () => { badgeEl.style.opacity = "0.9"; });
      badgeEl.addEventListener("click", togglePanel);
      wrapperEl.appendChild(badgeEl);
    }

    if (mode === "record") {
      badgeEl.style.background = "#e74c3c";
      badgeEl.textContent = "● REC";
    } else if (mode === "replay") {
      badgeEl.style.background = "#2ecc71";
      badgeEl.textContent = "▶ REPLAY";
    } else {
      badgeEl.style.background = "#555";
      badgeEl.textContent = "● SNIFFER";
    }
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    if (panelOpen) {
      refreshPanel();
    } else if (panelEl) {
      panelEl.remove();
      panelEl = null;
    }
  }

  async function refreshPanel() {
    if (!panelOpen) return;
    const res = await request({ type: "getState" });
    if (!res || !panelOpen) return;

    ensureWrapper();
    if (!panelEl) {
      panelEl = document.createElement("div");
      panelEl.style.cssText = "background:#1a1a2e;border:1px solid #444;border-radius:8px;width:280px;max-height:320px;overflow-y:auto;margin-bottom:6px;box-shadow:0 4px 20px rgba(0,0,0,0.5);";
      wrapperEl.insertBefore(panelEl, badgeEl);
    }

    const recs = res.recordings || [];
    const activeReplays = res.activeReplays || {};
    const isRecording = res.recording;
    const recordTargetId = res.recordTargetId;

    let html = `<div style="padding:8px 10px;border-bottom:1px solid #333;font-size:10px;color:#888;text-transform:uppercase;display:flex;align-items:center;justify-content:space-between;">` +
      `<span>Recordings (${recs.length})</span>` +
      `<span style="cursor:pointer;font-size:14px;line-height:1;color:#666;" data-action="close">&times;</span>` +
      `</div>`;

    if (recs.length === 0) {
      html += `<div style="padding:16px 10px;text-align:center;font-size:11px;color:#666;">No recordings</div>`;
    } else {
      for (const r of recs) {
        const replaying = r.id in activeReplays;
        const recording = isRecording && recordTargetId === r.id;

        const btnStyle = replaying
          ? "padding:3px 8px;border:1px solid #2ecc71;border-radius:4px;background:#2ecc71;color:#fff;cursor:pointer;font:10px monospace;flex-shrink:0;"
          : "padding:3px 8px;border:1px solid #444;border-radius:4px;background:#2a2a3e;color:#888;cursor:pointer;font:10px monospace;flex-shrink:0;";
        const btnText = replaying ? "Stop" : "Replay";
        const action = replaying ? "stopReplay" : "startReplay";

        const recBadge = recording
          ? `<span style="padding:2px 6px;border-radius:4px;font-size:9px;font-weight:bold;background:#e74c3c;color:#fff;flex-shrink:0;">REC</span>`
          : "";

        html += `<div style="display:flex;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #222;">` +
          `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:#e0e0e0;cursor:pointer;" title="${esc(r.name)}" data-action="openRecording" data-id="${r.id}">${esc(r.name)}</span>` +
          recBadge +
          `<span style="font-size:10px;color:#666;white-space:nowrap;">${r.count}</span>` +
          `<button style="${btnStyle}" data-action="${action}" data-id="${r.id}">${btnText}</button>` +
          `</div>`;
      }
    }

    panelEl.innerHTML = html;

    panelEl.querySelectorAll("[data-action='openRecording']").forEach((el) => {
      el.addEventListener("mouseenter", () => { el.style.textDecoration = "underline"; });
      el.addEventListener("mouseleave", () => { el.style.textDecoration = "none"; });
    });

    panelEl.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const id = btn.dataset.id;
        if (action === "close") {
          panelOpen = false;
          if (panelEl) { panelEl.remove(); panelEl = null; }
          return;
        }
        if (action === "openRecording") {
          post({ type: "openRecording", recordingId: id });
          return;
        }
        if (action === "startReplay") {
          await request({ type: "startReplay", recordingId: id });
        } else if (action === "stopReplay") {
          await request({ type: "stopReplay", recordingId: id });
        }
        refreshPanel();
      });
    });
  }

  // --- Sync bootstrap from localStorage (survives reload for replay) ---
  try {
    const cached = localStorage.getItem("__sniffer__");
    if (cached) {
      const data = JSON.parse(cached);
      mode = data.mode;
      replayEntries = data.entries || [];
      originGroups = data.originGroups || [];
    }
  } catch {}
  renderBadge();

  // --- Listen for mode changes from bridge ---
  window.addEventListener("message", (e) => {
    if (e.data?.source !== "sniffer-bg") return;
    if (e.data.type === "setMode") {
      mode = e.data.mode;
      replayEntries = e.data.entries || [];
      originGroups = e.data.originGroups || [];
      renderBadge();
      if (panelOpen) refreshPanel();
    }
  });
})();
