import { describe, expect, it } from "vitest";
import {
  enrichRelease,
  officialReleaseNotesUrl,
  type FileReputation,
} from "./release-enrichment";
import { manifestReleaseNotesUrl } from "../winget-sync-resolution.mjs";
const row = {
  winget_id: "Example.App",
  name: "Example",
  publisher: null,
  version: "2.0",
  previous_version: "1.0",
  detected_at: "2026-09-06T00:00:00Z",
  release_date: null,
};
const hash = "a".repeat(64);
const metadata = [
  {
    winget_id: row.winget_id,
    version: row.version,
    release_notes_url: "https://example.com/releases/2.0",
    installer_sha256: hash,
    installers: [
      { Architecture: "arm64", InstallerSha256: "b".repeat(64) },
      { Architecture: "x64", InstallerSha256: hash },
    ],
  },
];
const report: FileReputation = {
  sha256: hash,
  status: "found",
  malicious: 0,
  suspicious: 1,
  total_engines: 72,
  analyzed_at: "2026-09-06T01:00:00Z",
};
describe("release evidence", () => {
  it("reuses an exact hash report across apps and versions", () => {
    const other = { ...row, winget_id: "Another.App", version: "3.0" };
    expect(
      enrichRelease(
        other,
        [
          {
            ...metadata[0],
            winget_id: other.winget_id,
            version: other.version,
          },
        ],
        [report],
      ).virusTotal,
    ).toMatchObject({ total: 72, suspicious: 1, architecture: "x64" });
  });
  it("does not substitute findings from a different installer", () => {
    expect(
      enrichRelease(row, metadata, [{ ...report, sha256: "b".repeat(64) }])
        .virusTotal,
    ).toMatchObject({ status: "unknown", hash, total: null });
  });
  it("keeps the hash available when a lookup is pending or absent", () => {
    expect(enrichRelease(row, metadata, []).virusTotal).toMatchObject({
      status: "unknown",
      hash,
    });
    expect(
      enrichRelease(row, metadata, [
        { ...report, status: "pending", total_engines: null },
      ]).virusTotal?.status,
    ).toBe("pending");
  });
  it("does not invent a hash or vendor link without metadata", () => {
    expect(enrichRelease(row, [], [report])).toMatchObject({
      release_notes_url: null,
      virusTotal: null,
    });
  });
  it("accepts only safe official URLs in display and ingestion", () => {
    for (const value of [
      "javascript:alert(1)",
      "https://user:password@example.com",
      "not a url",
      null,
    ]) {
      expect(officialReleaseNotesUrl(value)).toBeNull();
      expect(manifestReleaseNotesUrl({ ReleaseNotesUrl: value })).toBeNull();
    }
    expect(enrichRelease(row, metadata, []).release_notes_url).toBe(
      metadata[0].release_notes_url,
    );
  });
});
