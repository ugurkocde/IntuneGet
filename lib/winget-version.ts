/** Resolve a catalog version to its live WinGet spelling without changing releases. */
export function resolveListedWingetVersion(
  requestedVersion: string,
  versions: readonly string[],
): string | undefined {
  if (versions.includes(requestedVersion)) return requestedVersion;
  const unprefixed = requestedVersion.replace(/^v(?=\d)/i, '');
  return versions.find((version) => version.replace(/^v(?=\d)/i, '') === unprefixed);
}
