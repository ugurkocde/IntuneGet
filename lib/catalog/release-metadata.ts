import type { ReleaseMetadata } from './release-enrichment';

interface ReleasePair { winget_id: string; version: string }
interface MetadataResponse {
  data: ReleaseMetadata[] | null;
  error: { code?: string } | null;
  status: number;
}
export const releasePairKey = (row: ReleasePair) => JSON.stringify([row.winget_id, row.version]);

/** Counts only; never request, row or error content. */
export interface ReleaseMetadataStats {
  batchFailures: { aborted: number; http5xx: number; statementTimeout: number; other: number };
  singlesAttempted: number;
  singlesRecovered: number;
}
const isAbort = (error: unknown) => error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/** Keep one failed request from hiding evidence for every card on the page. */
export async function loadReleaseMetadata(
  rows: ReleasePair[],
  fetchBatch: (batch: ReleasePair[]) => PromiseLike<MetadataResponse>,
  fetchSingle?: (row: ReleasePair) => PromiseLike<MetadataResponse>,
) {
  const stats: ReleaseMetadataStats = {
    batchFailures: { aborted: 0, http5xx: 0, statementTimeout: 0, other: 0 },
    singlesAttempted: 0,
    singlesRecovered: 0,
  };
  const failed = (kind: keyof ReleaseMetadataStats['batchFailures']) => { stats.batchFailures[kind]++; };
  const batches = Array.from({ length: Math.ceil(rows.length / 10) }, (_, i) => rows.slice(i * 10, (i + 1) * 10));
  const results = await Promise.allSettled(batches.map(async batch => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        let response: MetadataResponse;
        try { response = await fetchBatch(batch); }
        catch (error) { failed(isAbort(error) ? 'aborted' : 'other'); throw error; }
        if (!response.error && response.data) return response.data;
        // Status zero also covers transport/body-read failures; it does not prove an abort.
        failed(response.error?.code === '57014' ? 'statementTimeout'
          : response.status >= 500 ? 'http5xx' : 'other');
        if (fetchSingle && response.status === 0) throw new Error('Release metadata unavailable (request aborted)');
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
  // Recover healthy rows individually when a batch fails. Limit database pressure.
  if (fetchSingle && unavailable.size) {
    const pending = rows.filter(row => unavailable.has(releasePairKey(row)));
    let next = 0;
    await Promise.all(Array.from({length: Math.min(4, pending.length)}, async () => {
      while (next < pending.length) {
        const row = pending[next++];
        stats.singlesAttempted++;
        try {
          const response = await fetchSingle(row);
          if (!response.error && response.data) {
            metadata.push(...response.data);
            unavailable.delete(releasePairKey(row));
            stats.singlesRecovered++;
          }
        } catch { /* Preserve the unavailable state only for this pair. */ }
      }
    }));
  }
  return { metadata, unavailable, stats };
}
