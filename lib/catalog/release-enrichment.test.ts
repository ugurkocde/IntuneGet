import { describe, expect, it } from "vitest";
import { enrichRelease, type ReleaseScan } from "./release-enrichment";
const row = {
  winget_id: "Example.App",
  name: "Example",
  publisher: null,
  version: "2.0",
  previous_version: "1.0",
  detected_at: "2026-09-06T00:00:00Z",
  release_date: null,
};
const metadata = [
  {
    winget_id: row.winget_id,
    version: "2.0",
    release_notes: "Fixed startup",
    installer_sha256: "a".repeat(64),
  },
];
const scan: ReleaseScan = {
  winget_id: row.winget_id,
  tested_version: "2.0",
  installer_sha256: "a".repeat(64),
  architecture: "x64",
  virustotal_status: "clean",
  virustotal_malicious: 0,
  virustotal_suspicious: 0,
  virustotal_total_engines: 72,
  virustotal_scanned_at_utc: "2026-09-06T01:00:00Z",
};
describe("release evidence", () => {
  it("matches the app, version and exact installer hash", () => {
    expect(enrichRelease(row, metadata, [scan]).virusTotal?.total).toBe(72);
    expect(
      enrichRelease(row, metadata, [{ ...scan, tested_version: "1.0" }])
        .virusTotal,
    ).toBeNull();
    expect(
      enrichRelease(row, metadata, [
        { ...scan, installer_sha256: "b".repeat(64) },
      ]).virusTotal,
    ).toBeNull();
    expect(
      enrichRelease(row, metadata, [{ ...scan, winget_id: "Another.App" }])
        .virusTotal,
    ).toBeNull();
  });
  it("uses the latest matching check, including an unavailable result", () => {
    const newer = {
      ...scan,
      virustotal_status: "error",
      virustotal_scanned_at_utc: "2026-09-06T02:00:00Z",
    };
    expect(enrichRelease(row, metadata, [scan, newer]).virusTotal?.status).toBe(
      "error",
    );
  });
  it("does not invent notes or scans for missing metadata", () => {
    expect(enrichRelease(row, [], [scan])).toMatchObject({
      release_notes: null,
      virusTotal: null,
    });
    expect(enrichRelease(row, metadata, []).release_notes).toBe(
      "Fixed startup",
    );
  });
});
