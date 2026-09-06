import type { ReleaseMetadata } from './release-enrichment';

interface ReleasePair { winget_id: string; version: string }
interface MetadataResponse {
  data: ReleaseMetadata[] | null;
  error: { code?: string } | null;
  status: number;
}
export const releasePairKey = (row: ReleasePair) => JSON.stringify([row.winget_id, row.version]);

/** Keep one failed request from hiding evidence for every card on the page. */
export async function loadReleaseMetadata(
  rows: ReleasePair[],
  fetchBatch: (batch: ReleasePair[]) => PromiseLike<MetadataResponse>,
) {
  const batches = Array.from({ length: Math.ceil(rows.length / 10) }, (_, i) => rows.slice(i * 10, (i + 1) * 10));
  const results = await Promise.allSettled(batches.map(async batch => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetchBatch(batch);
        if (!response.error && response.data) return response.data;
        const transient = response.status === 0 || response.status === 408 || response.status === 429 || response.status >= 500 || response.error?.code === '57014';
        if (!transient || attempt === 1) throw new Error(`Release metadata unavailable (HTTP ${response.status})`);
      } catch (error) {
        if (attempt === 1 || (error instanceof Error && error.message.startsWith('Release metadata unavailable'))) throw error;
      }
    }
    throw new Error('Release metadata unavailable');
  }));
  const metadata: ReleaseMetadata[] = [];
  const unavailable = new Set<string>();
  results.forEach((result, i) => {
    if (result.status === 'fulfilled') metadata.push(...result.value);
    else {
      batches[i].forEach(row => unavailable.add(releasePairKey(row)));
      console.warn('Release metadata batch unavailable', { batchSize: batches[i].length });
    }
  });
  return { metadata, unavailable };
}
