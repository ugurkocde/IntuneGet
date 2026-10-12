import type { DetectionRule, RegistryDetectionRule } from '@/types/intune';

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

export function sanitizeWingetIdForRegistry(wingetId: string): string {
  return wingetId.replace(/[.\-]/g, '_');
}

/**
 * Recover the custom marker root from an older saved catalog profile that
 * retained its generated detection rule but lost psadtConfig.registryMarkerPath.
 *
 * Inference is intentionally narrow: the profile must contain exactly one
 * registry rule, and every field must match the marker rule IntuneGet would
 * generate for this app, version, and scope. The root must live below
 * SOFTWARE and must differ from the default. Customer-authored rules, mixed
 * rule sets, stale versions, and uninstall-key rules are left untouched.
 */
export function inferSavedCustomMarkerPath({
  detectionRules,
  wingetId,
  version,
  installScope,
}: {
  detectionRules: DetectionRule[];
  wingetId: string;
  version: string;
  installScope?: string;
}): string | null {
  if (detectionRules.length !== 1) return null;

  const [rule] = detectionRules;
  if (
    rule.type !== 'registry' ||
    typeof rule.keyPath !== 'string' ||
    rule.valueName?.toUpperCase() !== 'VERSION' ||
    rule.check32BitOn64System !== false ||
    rule.detectionValue !== version
  ) {
    return null;
  }

  const versionParts = /^\d+(?:\.\d+){1,3}$/.test(version) ? version.split('.') : [];
  const useVersionComparison =
    versionParts.length >= 2 &&
    versionParts.length <= 4 &&
    versionParts.every((part) => Number(part) <= 2_147_483_647);
  if (
    rule.detectionType !== (useVersionComparison ? 'version' : 'string') ||
    rule.operator !== (useVersionComparison ? 'greaterThanOrEqual' : 'equal')
  ) {
    return null;
  }

  const match = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\\(.+)$/i.exec(rule.keyPath);
  const expectedHive = installScope?.toLowerCase() === 'user'
    ? 'HKEY_CURRENT_USER'
    : 'HKEY_LOCAL_MACHINE';
  if (!match || match[1].toUpperCase() !== expectedHive) return null;

  const segments = match[2].split('\\');
  const sanitizedWingetId = sanitizeWingetIdForRegistry(wingetId);
  if (segments.length < 3 || segments.at(-1)?.toUpperCase() !== sanitizedWingetId.toUpperCase()) {
    return null;
  }

  const markerPath = normalizeMarkerPath(segments.slice(0, -1).join('\\'));
  const markerPathUpper = markerPath.toUpperCase();
  if (
    !markerPathUpper.startsWith('SOFTWARE\\') ||
    markerPathUpper === DEFAULT_REGISTRY_MARKER_PATH.toUpperCase() ||
    /^SOFTWARE\\(?:WOW6432NODE\\)?MICROSOFT\\WINDOWS\\CURRENTVERSION\\UNINSTALL(?:\\|$)/.test(
      markerPathUpper
    )
  ) {
    return null;
  }

  return markerPath;
}

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

/**
 * Reconcile only IntuneGet-owned marker rules with the package that will
 * actually be generated. Saved deployment profiles can outlive a WinGet
 * install-scope or version change; without this reconciliation a user-scoped
 * package writes HKCU while Intune continues looking in HKLM (or vice versa).
 *
 * The complete default/current marker path, sanitized WinGet id, and Version
 * value form the ownership signature. A rule with that exact signature is
 * internal IntuneGet state and is normalized completely; every other registry
 * rule is returned by reference and remains byte-for-byte intact.
 */
export function reconcileManagedMarkerDetectionRules({
  detectionRules,
  wingetId,
  version,
  installScope,
  markerPath,
}: {
  detectionRules: DetectionRule[];
  wingetId: string;
  version: string;
  installScope?: string;
  markerPath?: string | null;
}): DetectionRule[] {
  const sanitizedWingetId = sanitizeWingetIdForRegistry(wingetId);
  const currentMarkerPath = normalizeMarkerPath(markerPath);
  const managedSubPaths = new Set(
    [DEFAULT_REGISTRY_MARKER_PATH, currentMarkerPath].map(
      (path) => `${path}\\${sanitizedWingetId}`.toUpperCase()
    )
  );
  const hive =
    installScope?.toLowerCase() === 'user' ? 'HKEY_CURRENT_USER' : 'HKEY_LOCAL_MACHINE';
  const versionParts = /^\d+(?:\.\d+){1,3}$/.test(version) ? version.split('.') : [];
  const useVersionComparison =
    versionParts.length >= 2 &&
    versionParts.length <= 4 &&
    versionParts.every((part) => Number(part) <= 2_147_483_647);

  return detectionRules.map((rule) => {
    if (
      rule.type !== 'registry' ||
      rule.valueName?.toUpperCase() !== 'VERSION' ||
      typeof rule.keyPath !== 'string'
    ) {
      return rule;
    }

    const match = /^(HKEY_LOCAL_MACHINE|HKEY_CURRENT_USER)\\(.+)$/i.exec(rule.keyPath);
    if (!match || !managedSubPaths.has(match[2].toUpperCase())) {
      return rule;
    }

    return {
      ...rule,
      keyPath: `${hive}\\${currentMarkerPath}\\${sanitizedWingetId}`,
      valueName: 'Version',
      check32BitOn64System: false,
      detectionType: useVersionComparison ? 'version' : 'string',
      operator: useVersionComparison ? 'greaterThanOrEqual' : 'equal',
      detectionValue: version,
    } satisfies RegistryDetectionRule;
  });
}
