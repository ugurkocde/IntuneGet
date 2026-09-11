import { appHistoryUrl, type CatalogRelease } from "./release-history";

export function escapeXml(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[<>&"']/g, char => ({"<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;"})[char]!);
}
export function releaseFeed(rows: CatalogRelease[], app = ""): string {
  const origin = "https://intuneget.com";
  const title = app ? `${app} release history` : "IntuneGet catalog release history";
  const feedUrl = `${origin}/apps/releases/feed${app ? `?app=${encodeURIComponent(app)}` : ""}`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>${escapeXml(title)}</title><link>${escapeXml(origin + (app ? appHistoryUrl(app) : "/apps/releases"))}</link>
<description>The latest 40 app versions recorded by IntuneGet. Dates are catalog observation times.</description>
<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${rows.map(row => `<item><title>${escapeXml(`${row.name} ${row.version}`)}</title>
<link>${escapeXml(origin + appHistoryUrl(row.winget_id))}</link>
<guid isPermaLink="false">${escapeXml(JSON.stringify([row.winget_id, row.version]))}</guid>
<pubDate>${new Date(row.detected_at).toUTCString()}</pubDate>
<description>${escapeXml(row.previous_version ? `Recorded version change: ${row.previous_version} to ${row.version}.` : `First recorded version: ${row.version}.`)}</description>
</item>`).join("\n")}</channel></rss>`;
}
