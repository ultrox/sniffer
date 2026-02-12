const toggleBtn = document.getElementById("toggle");
const clearBtn = document.getElementById("clear");
const countEl = document.getElementById("count");
const requestsEl = document.getElementById("requests");

let pollInterval;

function statusClass(code) {
  if (!code) return "";
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redir";
  return "err";
}

function render(requests) {
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
      <span class="type">${r.type}</span>
      <span class="url" title="${r.url}">${cleanUrl(r.url)}</span>
      <span class="status ${statusClass(r.status)}">${r.status || "..."}</span>
    </div>`
    )
    .join("");
}

function cleanUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function refresh() {
  chrome.runtime.sendMessage({ type: "getState" }, (res) => {
    if (!res) return;
    toggleBtn.classList.toggle("active", res.sniffing);
    toggleBtn.textContent = res.sniffing ? "Stop" : "Sniff";
    render(res.requests);
  });
}

toggleBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "toggle" }, () => refresh());
});

clearBtn.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "clear" }, () => refresh());
});

refresh();
pollInterval = setInterval(refresh, 500);
