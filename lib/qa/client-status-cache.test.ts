import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { fetchQaStatuses, QA_STATUS_FRESH_MS } from './client-status-cache';

afterEach(() => vi.unstubAllGlobals());
describe('QA status cache', () => {
  it('loads 200 distinct IDs once across ten growing catalog pages', async () => {
    const client = new QueryClient();
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const ids = new URL(url, 'http://localhost').searchParams.get('ids')!.split(',');
      requested.push(...ids);
      return Response.json({ statuses: Object.fromEntries(ids.map(id => [id, null])) });
    }));
    for (let count = 20; count <= 200; count += 20) {
      const ids = Array.from({ length: count }, (_, i) => `app.${i}`);
      const result = await fetchQaStatuses(client, ids, new AbortController().signal);
      expect(Object.keys(result.statuses)).toHaveLength(count);
    }
    expect(requested).toHaveLength(200);
    expect(new Set(requested).size).toBe(200);
    client.clear();
  });

  it('refreshes expired and invalidated results, including cached nulls', async () => {
    const client = new QueryClient();
    client.setQueryData(['qa', 'status', 'old'], null, { updatedAt: Date.now() - QA_STATUS_FRESH_MS - 1 });
    client.setQueryData(['qa', 'status', 'fresh'], null);
    client.setQueryData(['qa', 'status', 'invalid'], null);
    await client.invalidateQueries({ queryKey: ['qa', 'status', 'invalid'] });
    const fetchMock = vi.fn(async () => Response.json({ statuses: { old: null, invalid: null } }));
    vi.stubGlobal('fetch', fetchMock);
    await fetchQaStatuses(client, ['old', 'fresh', 'invalid'], new AbortController().signal);
    expect(fetchMock).toHaveBeenCalledOnce();
    const url = String((fetchMock.mock.calls as unknown as [string][])[0][0]);
    expect(new URL(url, 'http://localhost').searchParams.get('ids')).toBe('old,invalid');
    client.clear();
  });

  it('bounds batches and does not cache aborted responses', async () => {
    const client = new QueryClient();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
      expect(options.signal).toBe(controller.signal);
      expect(new URL(url, 'http://localhost').searchParams.get('ids')!.split(',').length).toBeLessThanOrEqual(100);
      controller.abort();
      return Response.json({ statuses: {} });
    }));
    await expect(fetchQaStatuses(client, Array.from({ length: 250 }, (_, i) => String(i)), controller.signal)).rejects.toThrow();
    expect(client.getQueryData(['qa', 'status', '0'])).toBeUndefined();
    client.clear();
  });
});
