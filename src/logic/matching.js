export function hasRouteParams(url) {
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

export function matchRoute(patternUrl, actualUrl) {
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

export function substituteParams(text, params) {
  if (!text || !params) return text;
  let result = text;
  for (const [key, value] of Object.entries(params)) {
    const name = key.startsWith(":") ? key.slice(1) : key;
    result = result.replaceAll(`{{${name}}}`, value);
  }
  return result;
}

export function findMatch(url, method, replayEntries) {
  // 1. Exact match
  const exact = replayEntries.find(
    (e) => e.url === url && e.method === method,
  );
  if (exact) return { entry: exact, params: null };

  // 2. Match ignoring query param order / extra params
  try {
    const u = new URL(url);
    const path = u.pathname;
    const urlParams = u.searchParams;

    const candidates = replayEntries.filter((e) => {
      try {
        return new URL(e.url).pathname === path && e.method === method;
      } catch {
        return false;
      }
    });

    if (candidates.length === 1) return { entry: candidates[0], params: null };

    if (candidates.length > 1) {
      let best = null;
      let bestScore = -1;
      for (const c of candidates) {
        const cp = new URL(c.url).searchParams;
        let score = 0;
        for (const [k, v] of cp) {
          if (urlParams.get(k) === v) score++;
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
