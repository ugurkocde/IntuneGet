/**
 * Version Comparison Utilities
 * Compare semantic versions and determine if updates are available
 */

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
  build: string;
}

/**
 * Parse a version string into components
 */
export function parseVersion(version: string): ParsedVersion {
  // Remove leading 'v' if present
  const cleaned = version.replace(/^v/i, '').trim();

  // Split by common separators and extract numeric parts
  const parts = cleaned.split(/[.\-+]/);

  const major = parseInt(parts[0], 10) || 0;
  const minor = parseInt(parts[1], 10) || 0;
  const patch = parseInt(parts[2], 10) || 0;

  // Extract prerelease (alpha, beta, rc, etc.)
  let prerelease = '';
  let build = '';

  const prereleaseMatch = cleaned.match(/[-]([a-zA-Z0-9.]+)(?:\+|$)/);
  if (prereleaseMatch) {
    prerelease = prereleaseMatch[1];
  }

  const buildMatch = cleaned.match(/\+([a-zA-Z0-9.]+)$/);
  if (buildMatch) {
    build = buildMatch[1];
  }

  return { major, minor, patch, prerelease, build };
}

/**
 * Compare two version strings
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(versionA: string, versionB: string): number {
  const a = parseVersion(versionA);
  const b = parseVersion(versionB);

  // Compare major
  if (a.major !== b.major) {
    return a.major > b.major ? 1 : -1;
  }

  // Compare minor
  if (a.minor !== b.minor) {
    return a.minor > b.minor ? 1 : -1;
  }

  // Compare patch
  if (a.patch !== b.patch) {
    return a.patch > b.patch ? 1 : -1;
  }

  // Handle prerelease versions
  // A version without prerelease is greater than one with prerelease
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;

  // Both have prereleases, compare them using semantic versioning rules
  if (a.prerelease && b.prerelease) {
    return comparePrereleases(a.prerelease, b.prerelease);
  }

  return 0;
}

/**
 * Compare prerelease versions following semver rules
 * Numeric segments are compared as integers, strings are compared lexically
 * e.g., rc.10 > rc.2 (10 > 2), alpha < beta (lexical)
 */
function comparePrereleases(a: string, b: string): number {
  const partsA = a.split('.');
  const partsB = b.split('.');
  const maxLength = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < maxLength; i++) {
    const partA = partsA[i];
    const partB = partsB[i];

    // If one has fewer parts, it comes first (1.0.0-rc < 1.0.0-rc.1)
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;

    const numA = parseInt(partA, 10);
    const numB = parseInt(partB, 10);
    const isNumA = !isNaN(numA) && String(numA) === partA;
    const isNumB = !isNaN(numB) && String(numB) === partB;

    // Numeric identifiers have lower precedence than non-numeric
    if (isNumA && !isNumB) return -1;
    if (!isNumA && isNumB) return 1;

    if (isNumA && isNumB) {
      // Both numeric - compare as integers
      if (numA !== numB) {
        return numA > numB ? 1 : -1;
      }
    } else {
      // Both non-numeric - compare lexically
      const cmp = partA.localeCompare(partB);
      if (cmp !== 0) return cmp;
    }
  }

  return 0;
}

/**
 * Check if there is an update available
 */
export function hasUpdate(currentVersion: string, latestVersion: string): boolean {
  return compareVersions(currentVersion, latestVersion) < 0;
}

/**
 * Normalize version string for comparison
 */
export function normalizeVersion(version: string | null | undefined): string {
  if (!version) return '0.0.0';

  // Remove common prefixes
  let normalized = version
    .replace(/^v/i, '')
    .replace(/^version\s*/i, '')
    .trim();

  // Handle versions like "1.2" by adding .0
  const parts = normalized.split('.');
  while (parts.length < 3) {
    parts.push('0');
  }

  return parts.slice(0, 3).join('.');
}

/**
 * Check if a version string is valid
 */
export function isValidVersion(version: string | null | undefined): boolean {
  if (!version) return false;
  const cleaned = version.replace(/^v/i, '').trim();
  return /^\d+(\.\d+)*/.test(cleaned);
}
