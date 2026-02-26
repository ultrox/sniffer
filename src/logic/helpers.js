export function statusClass(code) {
  if (!code) return "";
  if (code >= 200 && code < 300) return "ok";
  if (code >= 300 && code < 400) return "redir";
  return "err";
}

export function cleanUrl(url) {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

export function getPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

export function isFormEncoded(str) {
  if (!str || str.startsWith("{") || str.startsWith("[")) return false;
  return str.includes("=") && !str.includes("\n");
}

export function fmtSize(str) {
  if (!str) return "\u2014";
  const n = str.length;
  if (n < 1000) return `${n}B`;
  if (n < 1000000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1000000).toFixed(1)}M`;
}

export function timeAgo(ts) {
  const sec = Math.floor((Date.now() - ts) / 1000);
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

export function esc(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

export function buildUrlFromParts(base, params) {
  let qs = "";
  for (const [key, value] of params) {
    qs += (qs ? "&" : "?") + encodeURIComponent(key) + "=" + value;
  }
  return base + qs;
}
