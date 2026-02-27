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

  // --- Listen for mode changes from bridge ---
  window.addEventListener("message", (e) => {
    if (e.data?.source !== "sniffer-bg") return;
    if (e.data.type === "setMode") {
      mode = e.data.mode;
      replayEntries = e.data.entries || [];
      originGroups = e.data.originGroups || [];
    }
  });
})();
