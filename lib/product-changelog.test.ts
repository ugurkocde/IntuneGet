import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const entry = { id: 'entry-1', title: 'Faster browsing', summary: 'Browse the app catalog more smoothly.', type: 'improved', publishedOn: '2026-09-05' };
const feed = { product: { id: 'intuneget', name: 'IntuneGet', websiteUrl: 'https://www.intuneget.com/' }, entries: [entry] };

beforeEach(() => { vi.resetModules(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('product changelog reads', () => {
  it('coalesces concurrent navigation requests, caches success, and refreshes after five minutes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => feed });
    vi.stubGlobal('fetch', fetchMock);
    const api = await import('./product-changelog');
    const first = api.fetchProductChangelog();
    expect(api.fetchProductChangelog()).toBe(first);
    expect((await first).entries[0]).not.toHaveProperty('type');
    await api.fetchProductChangelog();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(api.CHANGELOG_FEED_URL, expect.objectContaining({ credentials: 'omit', headers: { Accept: 'application/json' } }));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await api.fetchProductChangelog();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not cache failed requests and permits a successful retry', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true, json: async () => feed });
    vi.stubGlobal('fetch', fetchMock);
    const { fetchProductChangelog } = await import('./product-changelog');
    await expect(fetchProductChangelog()).rejects.toThrow('temporarily unavailable');
    await expect(fetchProductChangelog()).resolves.toHaveProperty('product.id', 'intuneget');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('aborts stalled reads and allows the next attempt', async () => {
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })));
    const { fetchProductChangelog } = await import('./product-changelog');
    const rejected = expect(fetchProductChangelog()).rejects.toThrow('aborted');
    await vi.advanceTimersByTimeAsync(10_000);
    await rejected;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => feed }));
    await expect(fetchProductChangelog()).resolves.toHaveProperty('entries');
  });

  it.each([
    null,
    { ...feed, product: { ...feed.product, id: 'another-product' } },
    { ...feed, entries: [entry, entry] },
    { ...feed, entries: [{ ...entry, publishedOn: '2026-02-30' }] },
    { ...feed, entries: [{ ...entry, title: null }] },
    { ...feed, entries: [{ ...entry, summary: 'x'.repeat(2001) }] },
  ])('rejects malformed or mismatched API data: %j', async value => {
    const { parseProductChangelog } = await import('./product-changelog');
    expect(() => parseProductChangelog(value)).toThrow();
  });

  it('accepts an empty product and encodes archive anchors', async () => {
    const { parseProductChangelog, changelogEntryUrl } = await import('./product-changelog');
    expect(parseProductChangelog({ ...feed, entries: [] }).entries).toEqual([]);
    expect(changelogEntryUrl('A#B')).toBe('https://changelog.ugurlabs.com/?product=intuneget#change-a%23b');
  });
});
