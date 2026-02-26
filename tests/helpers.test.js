import { describe, it, expect } from "vitest";
import {
  statusClass,
  cleanUrl,
  getPath,
  isFormEncoded,
  fmtSize,
  timeAgo,
  buildUrlFromParts,
} from "../src/logic/helpers.js";

describe("statusClass", () => {
  it("returns empty for falsy", () => {
    expect(statusClass(0)).toBe("");
    expect(statusClass(null)).toBe("");
    expect(statusClass(undefined)).toBe("");
  });

  it("returns ok for 2xx", () => {
    expect(statusClass(200)).toBe("ok");
    expect(statusClass(201)).toBe("ok");
    expect(statusClass(299)).toBe("ok");
  });

  it("returns redir for 3xx", () => {
    expect(statusClass(301)).toBe("redir");
    expect(statusClass(304)).toBe("redir");
  });

  it("returns err for 4xx/5xx", () => {
    expect(statusClass(400)).toBe("err");
    expect(statusClass(404)).toBe("err");
    expect(statusClass(500)).toBe("err");
  });
});

describe("cleanUrl", () => {
  it("returns pathname + search", () => {
    expect(cleanUrl("https://example.com/api/users?page=1")).toBe(
      "/api/users?page=1",
    );
  });

  it("returns original for invalid URL", () => {
    expect(cleanUrl("not-a-url")).toBe("not-a-url");
  });
});

describe("getPath", () => {
  it("returns pathname", () => {
    expect(getPath("https://example.com/api/users?page=1")).toBe("/api/users");
  });

  it("returns original for invalid URL", () => {
    expect(getPath("not-a-url")).toBe("not-a-url");
  });
});

describe("isFormEncoded", () => {
  it("returns true for form-encoded strings", () => {
    expect(isFormEncoded("foo=bar&baz=qux")).toBe(true);
  });

  it("returns false for JSON", () => {
    expect(isFormEncoded('{"foo":"bar"}')).toBe(false);
    expect(isFormEncoded("[1,2,3]")).toBe(false);
  });

  it("returns false for empty/null", () => {
    expect(isFormEncoded("")).toBe(false);
    expect(isFormEncoded(null)).toBe(false);
  });

  it("returns false for multiline", () => {
    expect(isFormEncoded("foo=bar\nbaz=qux")).toBe(false);
  });
});

describe("fmtSize", () => {
  it("returns dash for falsy", () => {
    expect(fmtSize("")).toBe("\u2014");
    expect(fmtSize(null)).toBe("\u2014");
  });

  it("formats bytes", () => {
    expect(fmtSize("hi")).toBe("2B");
  });

  it("formats kilobytes", () => {
    expect(fmtSize("x".repeat(1500))).toBe("1.5K");
  });

  it("formats megabytes", () => {
    expect(fmtSize("x".repeat(1500000))).toBe("1.5M");
  });
});

describe("timeAgo", () => {
  it("returns 'just now' for recent timestamps", () => {
    expect(timeAgo(Date.now() - 5000)).toBe("just now");
  });

  it("returns minutes ago", () => {
    expect(timeAgo(Date.now() - 120000)).toBe("2m ago");
  });

  it("returns hours ago", () => {
    expect(timeAgo(Date.now() - 7200000)).toBe("2h ago");
  });

  it("returns days ago", () => {
    expect(timeAgo(Date.now() - 172800000)).toBe("2d ago");
  });
});

describe("buildUrlFromParts", () => {
  it("builds URL with query params", () => {
    const result = buildUrlFromParts("https://example.com/api", [
      ["page", "1"],
      ["limit", "10"],
    ]);
    expect(result).toBe("https://example.com/api?page=1&limit=10");
  });

  it("returns base with no params", () => {
    expect(buildUrlFromParts("https://example.com/api", [])).toBe(
      "https://example.com/api",
    );
  });
});
