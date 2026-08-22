/**
 * Per-app overrides for winget manifests that point at unreliable hosts.
 *
 * SourceForge mirrors fail frequently (Cloudflare challenges, dead mirrors,
 * rate limits). Some projects publish the same binary to a more reliable host
 * (e.g. GitHub Releases). The winget manifest's pinned SHA256 still applies,
 * so a wrong override URL fails fast with HASH_MISMATCH at the workflow.
 */

/**
 * Builds an override URL for the given winget id. Return `null` to fall
 * through to the manifest's original URL. Implementations that ignore the
 * `architecture` parameter are only safe when the app ships a single
 * universal installer.
 */
type OverrideFn = (version: string, architecture: string) => string | null;

export const INSTALLER_URL_OVERRIDES: Record<string, OverrideFn> = {
  // download.blender.org returns HTTP 403 to hosted preflight egress for this
  // release family. Blender's official mirror service selects a healthy
  // geographic mirror while the WinGet manifest hash remains authoritative.
  'BlenderFoundation.Blender.LTS.4.2': (version, architecture) =>
    architecture.toLowerCase() === 'x64'
      ? `https://mirror.blender.org/release/Blender4.2/blender-${version}-windows-x64.msi`
      : null,
  // ImageGlass 10.0.4.819 was published to WinGet with the correct trusted
  // hash, but the release asset was renamed after publication. Keep this
  // exact tuple on the official GitHub release without guessing future names.
  'DuongDieuPhap.ImageGlass': (version, architecture) =>
    version === '10.0.4.819' && architecture.toLowerCase() === 'x64'
      ? 'https://github.com/d2phap/ImageGlass/releases/download/10.0.4.819/ImageGlass_10.0.4.819_win-x64_pro-business.msi'
      : null,
  'Freeplane.Freeplane': (version) =>
    `https://github.com/freeplane/freeplane/releases/download/release-${version}/Freeplane-Setup-${version}.exe`,
};

export function applyInstallerUrlOverride(
  wingetId: string,
  version: string,
  architecture: string,
  originalUrl: string,
): string {
  const fn = INSTALLER_URL_OVERRIDES[wingetId];
  if (!fn) return originalUrl;
  return fn(version, architecture) ?? originalUrl;
}
