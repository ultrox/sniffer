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

  function hasRouteParams(url) {
    try {
      const u = new URL(url);
      if (u.pathname.split("/").some((s) => s.startsWith(":"))) return true;
      for (const v of u.searchParams.values()) {
        if (v.startsWith(":")) return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function matchRoute(patternUrl, actualUrl) {
    try {
      const pu = new URL(patternUrl);
      const au = new URL(actualUrl);
      if (pu.origin !== au.origin) return null;
      const pParts = pu.pathname.split("/");
      const aParts = au.pathname.split("/");
      if (pParts.length !== aParts.length) return null;
      const params = {};
      for (let i = 0; i < pParts.length; i++) {
        if (pParts[i].startsWith(":")) {
          params[pParts[i]] = aParts[i];
        } else if (pParts[i] !== aParts[i]) {
          return null;
        }
      }
      // Match query params — pattern values starting with : are wildcards
      for (const [key, pVal] of pu.searchParams) {
        if (!au.searchParams.has(key)) return null;
        if (pVal.startsWith(":")) {
          params[pVal] = au.searchParams.get(key);
        } else if (au.searchParams.get(key) !== pVal) {
          return null;
        }
      }
      return params;
    } catch {
      return null;
    }
  }

  function substituteParams(text, params) {
    if (!text || !params) return text;
    let result = text;
    for (const [key, value] of Object.entries(params)) {
      const name = key.startsWith(":") ? key.slice(1) : key;
      result = result.replaceAll(`{{${name}}}`, value);
    }
    return result;
  }

  function findMatch(url, method) {
    // 1. Exact match
    const exact = replayEntries.find(
      (e) => e.url === url && e.method === method
    );
    if (exact) return { entry: exact, params: null };

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

      if (candidates.length === 1) return { entry: candidates[0], params: null };

      if (candidates.length > 1) {
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
        return { entry: best, params: null };
      }
    } catch {}

    // 3. Parameterized route match
    for (const e of replayEntries) {
      if (e.method !== method || !hasRouteParams(e.url)) continue;
      const matched = matchRoute(e.url, url);
      if (matched) return { entry: e, params: matched };
    }

    return null;
  }

  // --- Patch fetch ---
  window.fetch = async function (...args) {
    const req = new Request(...args);
    const url = req.url;
    const method = req.method;

    if (mode === "replay") {
      const result = findMatch(url, method);
      if (result) {
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
      const result = findMatch(url, method);
      if (result) {
        const body = substituteParams(result.entry.body, result.params);
        Object.defineProperty(this, "readyState", { value: 4 });
        Object.defineProperty(this, "status", { value: result.entry.status });
        Object.defineProperty(this, "statusText", {
          value: result.entry.statusText || "",
        });
        Object.defineProperty(this, "responseText", { value: body });
        Object.defineProperty(this, "response", { value: body });
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
