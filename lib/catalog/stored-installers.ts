/** Restore legacy JSONB strings without guessing or altering installer fields. */
export function normalizeStoredInstallers(value: unknown): unknown[] | null {
  // Preserve existing array-backed catalog records and their selection behavior.
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string') return null;

  try {
    const decoded: unknown = JSON.parse(value);
    if (!Array.isArray(decoded) || decoded.some((entry) =>
      entry === null || typeof entry !== 'object' || Array.isArray(entry)
    )) return null;
    return decoded;
  } catch {
    return null;
  }
}
