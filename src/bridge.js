// Bridge between page context (intercept.js) and background service worker.
// Runs in ISOLATED world.

// Page -> Background (with optional response relay)
window.addEventListener("message", (e) => {
  if (e.data?.source !== "sniffer-intercept") return;
  const reqId = e.data._reqId;
  chrome.runtime.sendMessage(e.data, (res) => {
    if (chrome.runtime.lastError) return;
    if (reqId) {
      window.postMessage(
        { source: "sniffer-bg", type: "_response", _reqId: reqId, data: res },
        "*",
      );
    }
  });
});

// Background -> Page
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source === "sniffer-bg") {
    window.postMessage(msg, "*");

    // Cache replay state in localStorage so intercept.js can bootstrap
    // synchronously on page reload (before async init completes).
    if (msg.type === "setMode") {
      try {
        if (msg.mode === "replay") {
          localStorage.setItem(
            "__sniffer__",
            JSON.stringify({ mode: msg.mode, entries: msg.entries || [], originGroups: msg.originGroups || [] })
          );
        } else {
          localStorage.removeItem("__sniffer__");
        }
      } catch {}
    }
  }
});

// On load, ask background for current mode
chrome.runtime.sendMessage(
  { source: "sniffer-bridge", type: "init" },
  (res) => {
    if (chrome.runtime.lastError) return;
    if (res?.mode) {
      window.postMessage(
        {
          source: "sniffer-bg",
          type: "setMode",
          mode: res.mode,
          entries: res.entries || [],
          originGroups: res.originGroups || [],
        },
        "*"
      );
    }
  }
);
