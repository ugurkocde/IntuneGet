import type { CatalogRelease } from "./release-history";

export interface ReleaseMetadata {
  winget_id: string;
  version: string;
  release_notes: string | null;
  installer_sha256: string | null;
}
export interface ReleaseScan {
  winget_id: string;
  tested_version: string;
  installer_sha256: string | null;
  architecture: string | null;
  virustotal_status: string | null;
  virustotal_malicious: number | null;
  virustotal_suspicious: number | null;
  virustotal_total_engines: number | null;
  virustotal_scanned_at_utc: string | null;
}
export function enrichRelease(
  row: CatalogRelease,
  metadata: ReleaseMetadata[],
  scans: ReleaseScan[],
): CatalogRelease {
  const version = metadata.find(
    (v) => v.winget_id === row.winget_id && v.version === row.version,
  );
  const hash = version?.installer_sha256?.toLowerCase();
  const scan =
    hash && /^[a-f0-9]{64}$/.test(hash)
      ? scans
          .filter(
            (q) =>
              q.winget_id === row.winget_id &&
              q.tested_version === row.version &&
              q.installer_sha256?.toLowerCase() === hash &&
              q.virustotal_status,
          )
          .sort((a, b) =>
            (b.virustotal_scanned_at_utc ?? "").localeCompare(
              a.virustotal_scanned_at_utc ?? "",
            ),
          )[0]
      : undefined;
  return {
    ...row,
    release_notes: version?.release_notes || null,
    virusTotal: scan
      ? {
          status: scan.virustotal_status!,
          hash: hash!,
          architecture: scan.architecture,
          malicious: scan.virustotal_malicious,
          suspicious: scan.virustotal_suspicious,
          total: scan.virustotal_total_engines,
          scannedAt: scan.virustotal_scanned_at_utc,
        }
      : null,
  };
}
