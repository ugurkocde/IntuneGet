import { describe, expect, it } from "vitest";
import { historyUrl, parseHistoryFilters } from "./release-history";
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
