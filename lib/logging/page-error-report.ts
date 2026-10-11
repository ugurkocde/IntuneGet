export type PageErrorArea = 'root' | 'dashboard';
export interface PageErrorReport { event: 'page_error'; area: PageErrorArea; digest?: string }
export function safeDigest(value: unknown): string | undefined {
  return typeof value === 'string' && /^\d{1,20}$/.test(value) ? value : undefined;
}
export function validatePageErrorReport(value: unknown): PageErrorReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !['event', 'area', 'digest'].includes(key))
    || row.event !== 'page_error' || !['root', 'dashboard'].includes(row.area as string)
    || ('digest' in row && !safeDigest(row.digest))) return null;
  return { event: 'page_error', area: row.area as PageErrorArea, ...(row.digest ? { digest: row.digest as string } : {}) };
}
