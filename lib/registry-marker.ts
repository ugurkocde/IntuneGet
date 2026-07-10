/**
 * Registry Marker Path Helpers
 *
 * IntuneGet writes a detection marker to the registry during install
 * (HKLM\SOFTWARE\IntuneGet\Apps\<sanitizedWingetId>, or HKCU for user scope)
 * and points the Intune detection rule at it. Organizations can customize the
 * marker root via psadtConfig.registryMarkerPath (issue #106); these helpers
 * normalize that value and rewrite already-generated detection rules.
 *
 * The same normalization rules are mirrored in:
 * - .github/scripts/Create-PSADTPackage.ps1 (GitHub Actions packaging path)
 * - packager/src/job-processor.ts (Azure packager, cannot import from lib/)
 * Keep all three in sync.
 */

/** Default marker root: subpath under the hive, no hive prefix */
export const DEFAULT_REGISTRY_MARKER_PATH = 'SOFTWARE\\IntuneGet\\Apps';

/**
 * Normalize a user-supplied registry marker path into a safe subpath under
 * the hive (e.g. 'SOFTWARE\\Contoso\\Apps').
 *
 * - trims whitespace and converts forward slashes to backslashes
 * - collapses repeated backslashes and strips leading/trailing ones
 * - strips an accidental hive prefix (HKLM\, HKCU:\, HKEY_LOCAL_MACHINE\, ...)
 * - removes characters that are invalid in registry key names or unsafe to
 *   embed in generated PowerShell (quotes, <>|*? and control characters)
 * - returns DEFAULT_REGISTRY_MARKER_PATH for empty/undefined input
 */
export function normalizeMarkerPath(input?: string | null): string {
  if (typeof input !== 'string') {
    return DEFAULT_REGISTRY_MARKER_PATH;
  }

  let path = input.trim().replace(/\//g, '\\').replace(/\\+/g, '\\');
  path = path.replace(/^\\+|\\+$/g, '');
  path = path.replace(/^(HKLM|HKCU|HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER):?(\\|$)/i, '');
  path = path.replace(/[*?"'<>|\x00-\x1f]/g, '');

  const segments = path
    .split('\\')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return DEFAULT_REGISTRY_MARKER_PATH;
  }

  return segments.join('\\');
}

/**
 * Rewrite an IntuneGet registry marker keyPath to use a new marker root.
 *
 * A marker keyPath has the shape `<hive>\<root>\<sanitizedWingetId>` where
 * hive is HKEY_LOCAL_MACHINE or HKEY_CURRENT_USER. The hive and the trailing
 * sanitized winget id are preserved; only the root in between is replaced,
 * and only when that root exactly matches the rule's previous marker root.
 * Requiring the exact previous root prevents rewriting unrelated registry
 * rules that merely end with the sanitized id (e.g. a manually authored
 * Uninstall-key rule).
 *
 * Returns the rewritten keyPath, or null when the keyPath is not the marker
 * path for the given winget id - callers must leave such rules untouched.
 */
export function rewriteMarkerKeyPath(
  keyPath: string,
  sanitizedWingetId: string,
  markerPath: string,
  previousMarkerPath?: string | null
): string | null {
  const match = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\\(.+)$/i.exec(keyPath);
  if (!match) {
    return null;
  }

  const [, hive, subPath] = match;
  const expectedSubPath = `${normalizeMarkerPath(previousMarkerPath)}\\${sanitizedWingetId}`;
  if (subPath.toUpperCase() !== expectedSubPath.toUpperCase()) {
    return null;
  }

  return `${hive.toUpperCase()}\\${normalizeMarkerPath(markerPath)}\\${sanitizedWingetId}`;
}
