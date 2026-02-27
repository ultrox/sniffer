import { describe, it, expect } from "vitest";
import {
  hasRouteParams,
  matchRoute,
  normalizeUrl,
  substituteParams,
  findMatch,
} from "../src/logic/matching.js";

describe("hasRouteParams", () => {
  it("returns true for path params", () => {
    expect(hasRouteParams("https://api.com/users/:id")).toBe(true);
  });

  it("returns true for query param wildcards", () => {
    expect(hasRouteParams("https://api.com/search?q=:term")).toBe(true);
  });

  it("returns false for normal URLs", () => {
    expect(hasRouteParams("https://api.com/users/123")).toBe(false);
  });

  it("returns false for invalid URLs", () => {
    expect(hasRouteParams("not a url")).toBe(false);
  });
});

describe("matchRoute", () => {
  it("matches parameterized paths", () => {
    const result = matchRoute(
      "https://api.com/users/:id",
      "https://api.com/users/42",
    );
    expect(result).toEqual({ ":id": "42" });
  });

  it("returns null for different origins", () => {
    expect(
      matchRoute("https://api.com/users/:id", "https://other.com/users/42"),
    ).toBeNull();
  });

  it("returns null for different path lengths", () => {
    expect(
      matchRoute(
        "https://api.com/users/:id",
        "https://api.com/users/42/posts",
      ),
    ).toBeNull();
  });

  it("returns null for non-matching segments", () => {
    expect(
      matchRoute(
        "https://api.com/users/:id",
        "https://api.com/posts/42",
      ),
    ).toBeNull();
  });

  it("matches query param wildcards", () => {
    const result = matchRoute(
      "https://api.com/search?q=:term&page=1",
      "https://api.com/search?q=hello&page=1",
    );
    expect(result).toEqual({ ":term": "hello" });
  });

  it("returns null for missing query params", () => {
    expect(
      matchRoute(
        "https://api.com/search?q=:term",
        "https://api.com/search",
      ),
    ).toBeNull();
  });
});

describe("substituteParams", () => {
  it("substitutes template variables", () => {
    expect(substituteParams("User {{id}} found", { ":id": "42" })).toBe(
      "User 42 found",
    );
  });

  it("handles keys without colon prefix", () => {
    expect(substituteParams("User {{id}} found", { id: "42" })).toBe(
      "User 42 found",
    );
  });

  it("returns original text when no params", () => {
    expect(substituteParams("hello", null)).toBe("hello");
  });

  it("returns falsy text as-is", () => {
    expect(substituteParams("", { id: "42" })).toBe("");
    expect(substituteParams(null, { id: "42" })).toBeNull();
  });
});

describe("findMatch", () => {
  const entries = [
    { url: "https://api.com/users", method: "GET" },
    { url: "https://api.com/users", method: "POST" },
    { url: "https://api.com/users/:id", method: "GET" },
    { url: "https://api.com/items?page=1", method: "GET" },
    { url: "https://api.com/items?page=2", method: "GET" },
  ];

  it("finds exact match", () => {
    const result = findMatch("https://api.com/users", "GET", entries);
    expect(result.entry).toBe(entries[0]);
    expect(result.params).toBeNull();
  });

  it("matches correct method", () => {
    const result = findMatch("https://api.com/users", "POST", entries);
    expect(result.entry).toBe(entries[1]);
  });

  it("matches parameterized routes", () => {
    const result = findMatch("https://api.com/users/42", "GET", entries);
    expect(result.entry).toBe(entries[2]);
    expect(result.params).toEqual({ ":id": "42" });
  });

  it("scores query param matches", () => {
    const result = findMatch(
      "https://api.com/items?page=2",
      "GET",
      entries,
    );
    expect(result.entry).toBe(entries[4]);
  });

  it("returns null for no match", () => {
    expect(findMatch("https://api.com/nope", "GET", entries)).toBeNull();
  });
});

describe("normalizeUrl", () => {
  const groups = [
    ["https://dev.api.com", "https://staging.api.com", "https://api.com"],
  ];

  it("rewrites request URL to entry origin when in same group", () => {
    expect(
      normalizeUrl("https://staging.api.com/users", "https://dev.api.com/users", groups),
    ).toBe("https://dev.api.com/users");
  });

  it("preserves path and query", () => {
    expect(
      normalizeUrl("https://staging.api.com/items?page=2", "https://api.com/items?page=1", groups),
    ).toBe("https://api.com/items?page=2");
  });

  it("returns null when origins are the same", () => {
    expect(
      normalizeUrl("https://api.com/users", "https://api.com/users", groups),
    ).toBeNull();
  });

  it("returns null when origins are not in the same group", () => {
    expect(
      normalizeUrl("https://other.com/users", "https://api.com/users", groups),
    ).toBeNull();
  });

  it("returns null with no groups", () => {
    expect(normalizeUrl("https://a.com/x", "https://b.com/x", [])).toBeNull();
    expect(normalizeUrl("https://a.com/x", "https://b.com/x", null)).toBeNull();
  });
});

describe("findMatch with origin groups", () => {
  const entries = [
    { url: "https://dev.api.com/users", method: "GET", body: "[]" },
    { url: "https://dev.api.com/users/:id", method: "GET", body: "{}" },
    { url: "https://dev.api.com/items?page=1", method: "GET", body: "items" },
  ];
  const groups = [
    ["https://dev.api.com", "https://staging.api.com"],
  ];

  it("exact match across origins", () => {
    const result = findMatch("https://staging.api.com/users", "GET", entries, groups);
    expect(result).not.toBeNull();
    expect(result.entry).toBe(entries[0]);
  });

  it("path match across origins", () => {
    const result = findMatch("https://staging.api.com/items?page=1", "GET", entries, groups);
    expect(result).not.toBeNull();
    expect(result.entry).toBe(entries[2]);
  });

  it("parameterized route match across origins", () => {
    const result = findMatch("https://staging.api.com/users/42", "GET", entries, groups);
    expect(result).not.toBeNull();
    expect(result.entry).toBe(entries[1]);
    expect(result.params).toEqual({ ":id": "42" });
  });

  it("does not match across origins without groups", () => {
    expect(
      findMatch("https://staging.api.com/users", "GET", entries),
    ).toBeNull();
  });

  it("does not match origins not in any group", () => {
    expect(
      findMatch("https://other.com/users", "GET", entries, groups),
    ).toBeNull();
  });
});
