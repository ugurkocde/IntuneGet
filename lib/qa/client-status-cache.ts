import type { QueryClient } from '@tanstack/react-query';
import type { QaStatus } from '@/types/qa';

export const QA_STATUS_FRESH_MS = 60_000;

// Aggregate query keys change as pages/visible rows change. Reuse fresh values
// per package so adding a page only requests its new IDs, including null results.
export async function fetchQaStatuses(
  client: QueryClient,
  ids: string[],
  signal: AbortSignal,
): Promise<{ statuses: Record<string, QaStatus | null> }> {
  const statuses: Record<string, QaStatus | null> = {};
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    const state = client.getQueryState<QaStatus | null>(['qa', 'status', id]);
    if (state?.data !== undefined && !state.isInvalidated && Date.now() - state.dataUpdatedAt < QA_STATUS_FRESH_MS) {
      statuses[id] = state.data;
    } else missing.push(id);
  }
  const chunks: string[][] = [];
  for (let i = 0; i < missing.length; i += 100) chunks.push(missing.slice(i, i + 100));
  await Promise.all(chunks.map(async chunk => {
    const params = new URLSearchParams({ ids: chunk.join(',') });
    const response = await fetch(`/api/qa/status?${params}`, { signal });
    if (!response.ok) throw new Error('Failed to load QA statuses');
    const data = await response.json() as { statuses: Record<string, QaStatus | null> };
    signal.throwIfAborted();
    for (const id of chunk) {
      const value = data.statuses[id] ?? null;
      statuses[id] = value;
      client.setQueryData(['qa', 'status', id], value);
    }
  }));
  return { statuses };
}
