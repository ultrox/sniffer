(function () {
  let mode = null;
  let replayEntries = [];

  const origFetch = window.fetch;
  const origXHROpen = XMLHttpRequest.prototype.open;
  const origXHRSend = XMLHttpRequest.prototype.send;

  const SKIP_CONTENT_TYPES = /^(image|video|audio|font)\//;

  function post(data) {
    window.postMessage({ source: "sniffer-intercept", ...data }, "*");
  }

  function findMatch(url, method) {
    // 1. Exact match
    const exact = replayEntries.find(
      (e) => e.url === url && e.method === method
    );
    if (exact) return exact;

    // 2. Match ignoring query param order / extra params
    try {
      const u = new URL(url);
      const path = u.pathname;
      const params = u.searchParams;

      // Same path + method candidates
      const candidates = replayEntries.filter((e) => {
        try {
          return new URL(e.url).pathname === path && e.method === method;
        } catch {
          return false;
        }
      });

      if (candidates.length === 0) return null;
      if (candidates.length === 1) return candidates[0];

      // Score by matching query params — most matches wins
      let best = null;
      let bestScore = -1;
      for (const c of candidates) {
        const cp = new URL(c.url).searchParams;
        let score = 0;
        for (const [k, v] of cp) {
          if (params.get(k) === v) score++;
        }
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }
      return best;
    } catch {
      return null;
    }
  }

  // --- Patch fetch ---
  window.fetch = async function (...args) {
    const req = new Request(...args);
    const url = req.url;
    const method = req.method;

    if (mode === "replay") {
      const match = findMatch(url, method);
      if (match) {
        return new Response(match.body, {
          status: match.status,
          statusText: match.statusText || "",
          headers: match.headers || {},
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
          post({
            type: "captured",
            entry: {
              url,
              method,
              status: response.status,
              statusText: response.statusText,
              headers: Object.fromEntries(response.headers.entries()),
              body,
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
      const match = findMatch(url, method);
      if (match) {
        Object.defineProperty(this, "readyState", { value: 4 });
        Object.defineProperty(this, "status", { value: match.status });
        Object.defineProperty(this, "statusText", {
          value: match.statusText || "",
        });
        Object.defineProperty(this, "responseText", { value: match.body });
        Object.defineProperty(this, "response", { value: match.body });
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
              kind: "xhr",
              time: Date.now(),
            },
          });
        } catch {}
      });
    }

    return origXHRSend.call(this, body);
  };

  // --- Sync bootstrap from localStorage (survives reload for replay) ---
  try {
    const cached = localStorage.getItem("__sniffer__");
    if (cached) {
      const data = JSON.parse(cached);
      mode = data.mode;
      replayEntries = data.entries || [];
    }
  } catch {}

  // --- Listen for mode changes from bridge ---
  window.addEventListener("message", (e) => {
    if (e.data?.source !== "sniffer-bg") return;
    if (e.data.type === "setMode") {
      mode = e.data.mode;
      replayEntries = e.data.entries || [];
    }
  });
})();
