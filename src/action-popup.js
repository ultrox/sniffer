const buttons = document.querySelectorAll("[data-corner]");

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
