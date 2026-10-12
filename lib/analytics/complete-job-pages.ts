import type { AnalyticsJob } from '@/lib/db/types';

/** A short server page is not completion: compare it with the exact row count. */
export async function collectAnalyticsJobs(load: (offset: number) => Promise<{ data: AnalyticsJob[]; count: number | null }>) {
  const rows: AnalyticsJob[] = [];
  const ids = new Set<string>();
  let expected: number | null = null;
  do {
    const { data, count } = await load(rows.length);
    if (!Number.isSafeInteger(count) || count === null || count < 0 || count > 100000 || expected !== null && expected !== count) throw new Error('Complete statistics unavailable');
    expected = count;
    if (!Array.isArray(data) || data.length === 0 && rows.length < count) throw new Error('Incomplete statistics page');
    for (const row of data) {
      if (!row.id || ids.has(row.id)) throw new Error('Statistics changed during pagination');
      ids.add(row.id); rows.push(row);
    }
    if (rows.length > count) throw new Error('Statistics count mismatch');
  } while (rows.length < expected);
  return rows;
}
