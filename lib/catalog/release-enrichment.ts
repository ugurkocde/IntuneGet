import type { CatalogRelease } from "./release-history";

export interface ReleaseMetadata {
  winget_id: string;
  version: string;
  release_notes_url: string | null;
  installer_sha256: string | null;
  installers?: unknown;
}
export interface FileReputation {
  sha256: string;
  status: string;
  malicious: number | null;
  suspicious: number | null;
  total_engines: number | null;
  analyzed_at: string | null;
}
export function officialReleaseNotesUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function enrichRelease(
  row: CatalogRelease,
  metadata: ReleaseMetadata[],
  reputations: FileReputation[],
  now = Date.now(),
  preferredArchitecture = "",
): CatalogRelease {
  const version = metadata.find(
    (v) => v.winget_id === row.winget_id && v.version === row.version,
  );
  let installers = version?.installers;
  if (typeof installers === "string") {
    try {
      installers = JSON.parse(installers);
    } catch {
      installers = [];
    }
  }
  const preferredInstaller = Array.isArray(installers) && preferredArchitecture
    ? installers.find(i => typeof i?.Architecture === "string" && i.Architecture.toLowerCase() === preferredArchitecture && typeof i?.InstallerSha256 === "string" && /^[a-f0-9]{64}$/i.test(i.InstallerSha256)) : null;
  const hash = (preferredArchitecture ? preferredInstaller?.InstallerSha256 : version?.installer_sha256)?.toLowerCase();
  const validHash = hash && /^[a-f0-9]{64}$/.test(hash) ? hash : null;
  const reputation = validHash ? reputations.find(r => r.sha256.toLowerCase() === validHash) : null;
  const installer = Array.isArray(installers)
    ? installers.find(
        (i) =>
          typeof i?.InstallerSha256 === "string" &&
          i.InstallerSha256.toLowerCase() === validHash,
      )
    : null;
  return {
    ...row,
    installers: Array.isArray(installers) ? installers.flatMap(i => {
      if (typeof i?.InstallerSha256 !== "string" || !/^[a-f0-9]{64}$/i.test(i.InstallerSha256)) return [];
      let filename: string | null = null;
      try { filename = decodeURIComponent(new URL(i.InstallerUrl).pathname.split("/").pop() || "") || null; } catch { /* Missing URL or invalid encoding. */ }
      return [{ hash: i.InstallerSha256.toLowerCase(), architecture: typeof i.Architecture === "string" ? i.Architecture : null, filename, type: typeof i.InstallerType === "string" ? i.InstallerType : null }];
    }) : [],
    release_notes_url: officialReleaseNotesUrl(version?.release_notes_url),
    virusTotal: validHash
      ? {
          status: reputation?.status === "pending" &&
            !(Date.parse(row.detected_at) >= now - 72 * 60 * 60 * 1000 && Date.parse(row.detected_at) <= now)
              ? "unknown"
              : reputation?.status ?? "unknown",
          hash: validHash,
          architecture:
            typeof installer?.Architecture === "string"
              ? installer.Architecture
              : null,
          malicious: reputation?.malicious ?? null,
          suspicious: reputation?.suspicious ?? null,
          total: reputation?.total_engines ?? null,
          scannedAt: reputation?.analyzed_at ?? null,
        }
      : null,
  };
}
