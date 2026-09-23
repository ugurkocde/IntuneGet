import { describe, expect, it } from "vitest";
import { hasActiveFilters, historyUrl, pageWindow, parseHistoryFilters, updateSize } from "./release-history";
describe("release history navigation", () => {
  it("bounds page numbers and rejects malformed filters", () => {
    expect(
      parseHistoryFilters({ page: "-1", month: "2026-13", kind: "bad" }),
    ).toEqual({ query: "", month: "", kind: "all", page: 1 });
    expect(parseHistoryFilters({ page: "1.5" }).page).toBe(1);
    expect(parseHistoryFilters({ page: "999999" }).page).toBe(10000);
    expect(parseHistoryFilters({ q: ["one", "two"] }).query).toBe("");
  });
  it("keeps filters through pagination and encodes literal search text", () => {
    const filters = parseHistoryFilters({
      q: " C++ & tools ",
      month: "2026-09",
      kind: "updated",
    });
    const url = new URL(historyUrl(filters, 2), "https://example.test");
    expect(url.searchParams.get("q")).toBe("C++ & tools");
    expect(url.searchParams.get("month")).toBe("2026-09");
    expect(url.searchParams.get("kind")).toBe("updated");
    expect(url.searchParams.get("page")).toBe("2");
  });
});

describe("detailed history filters", () => {
  it("rejects impossible calendar dates and reversed ranges", () => {
    expect(parseHistoryFilters({from: "2026-02-30", to: "invalid", architecture: "all"})).toEqual(parseHistoryFilters({}));
    expect(parseHistoryFilters({from: "2026-09-11", to: "2026-09-10"}).to).toBeUndefined();
  });
  it("preserves exact app, inclusive dates and architecture across pages", () => {
    const filters = parseHistoryFilters({app: "Example.App", from: "2026-09-01", to: "2026-09-11", architecture: "arm64"});
    const url = new URL(historyUrl(filters, 2), "https://example.test");
    expect(parseHistoryFilters(Object.fromEntries(url.searchParams))).toEqual({...filters, page: 2});
  });
});

describe("release history display helpers", () => {
  it("detects active filters but ignores the app view and page", () => {
    expect(hasActiveFilters(parseHistoryFilters({app: "Example.App", page: "3"}))).toBe(false);
    expect(hasActiveFilters(parseHistoryFilters({kind: "updated"}))).toBe(true);
    expect(hasActiveFilters(parseHistoryFilters({to: "2026-09-01"}))).toBe(true);
  });
  it("classifies version changes by their first differing segment", () => {
    expect(updateSize("12.29.1", "12.29.2")).toBe("patch");
    expect(updateSize("1.459.343.0", "1.459.359.0")).toBe("patch");
    expect(updateSize("5.1.5", "5.3.0")).toBe("minor");
    expect(updateSize("v2.13.43", "3.0")).toBe("major");
    expect(updateSize("1.0", "1.0.1")).toBe("patch");
    expect(updateSize("2.0.1", "2.0.0")).toBe("lower");
    expect(updateSize("1.2.0-beta", "1.2.0")).toBeNull();
    expect(updateSize("2025.12.1", "2026.1.0")).toBeNull();
    expect(updateSize("2026.1.0", "2026.2.0")).toBe("minor");
    expect(updateSize("1.0", "1.0.0")).toBeNull();
    expect(updateSize(null, "1.0.0")).toBeNull();
    expect(updateSize("latest", "1.0.0")).toBeNull();
  });
  it("builds a compact page window with gaps", () => {
    expect(pageWindow(1, 1)).toEqual([1]);
    expect(pageWindow(1, 1332)).toEqual([1, 2, "gap", 1332]);
    expect(pageWindow(5, 1332)).toEqual([1, "gap", 4, 5, 6, "gap", 1332]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(1332, 1332)).toEqual([1, "gap", 1331, 1332]);
  });
});
