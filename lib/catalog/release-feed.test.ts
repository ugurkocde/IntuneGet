import { describe, expect, it } from "vitest";
import { escapeXml, releaseFeed } from "./release-feed";
const row = {winget_id: "Example.App", name: "App & <tools>", publisher: null, version: "2", previous_version: "1", detected_at: "2026-09-11T00:00:00Z", release_date: "2026-09-01"};
describe("release RSS", () => {
  it("escapes metadata and uses recorded dates with stable item identity", () => {
    const feed = releaseFeed([row], row.winget_id);
    expect(feed).toContain("App &amp; &lt;tools&gt; 2");
    expect(feed).toContain("Fri, 11 Sep 2026 00:00:00 GMT");
    expect(feed).toContain('isPermaLink="false"');
    expect(feed).toContain("?app=Example.App");
    expect(escapeXml("bad\u0000text")).toBe("badtext");
    expect(feed.match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]).toBe(releaseFeed([{...row, name: "Renamed"}]).match(/<guid[^>]*>(.*?)<\/guid>/)?.[1]);
  });
  it("produces a valid empty channel without inventing releases", () => {
    expect(releaseFeed([])).toContain("<channel>");
    expect(releaseFeed([])).not.toContain("<item>");
  });
});
