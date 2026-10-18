import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAvailableVersionsLive } from '../manifest-api';

let identity = 0;
const transport = vi.fn<typeof fetch>();
const listing = (versions = ['2.0', '1.0'], etag: string | null = '"one"') => Response.json(
  versions.map(name => ({ type: 'dir', name })),
  { headers: etag ? { ETag: etag } : {} },
);
const notModified = () => new Response(null, { status: 304 });
const read = (id = 'Example.App') => fetchAvailableVersionsLive(id, { strict: true });
const sent = (index: number) => new Headers(transport.mock.calls[index][1]?.headers);

beforeEach(() => {
  transport.mockReset();
  vi.stubGlobal('fetch', transport);
  vi.stubEnv('GITHUB_PAT', `synthetic-token-${++identity}`);
  vi.stubEnv('GITHUB_TOKEN', '');
  vi.useFakeTimers();
  vi.setSystemTime('2030-01-01T00:00:00Z');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('live version listing conditional reads', () => {
  it('revalidates every request and reuses only an authenticated unchanged listing', async () => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(notModified());
    expect(await read()).toEqual(['2.0', '1.0']);
    expect(await read()).toEqual(['2.0', '1.0']);
    expect(transport).toHaveBeenCalledTimes(2);
    expect(sent(0).has('if-none-match')).toBe(false);
    expect(sent(1).get('if-none-match')).toBe('"one"');
    expect(sent(1).get('authorization')).toContain('synthetic-token-');
    expect(transport.mock.calls[1][1]?.cache).toBe('no-store');
  });

  it('replaces a changed listing and never exposes the cached array to callers', async () => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(listing(['3.0'], 'W/"two"'))
      .mockResolvedValueOnce(notModified()).mockResolvedValueOnce(notModified());
    (await read()).push('99.0');
    expect(await read()).toEqual(['3.0']);
    (await read()).push('88.0');
    expect(await read()).toEqual(['3.0']);
    expect(sent(2).get('if-none-match')).toBe('W/"two"');
  });

  it('evicts a removed package instead of resurrecting its previous versions', async () => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(notModified());
    await read();
    expect(await read()).toEqual([]);
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(2).has('if-none-match')).toBe(false);
  });

  it.each([403, 429, 500])('keeps HTTP %i failures strict without serving stale data', async status => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(notModified());
    await read();
    await expect(read()).rejects.toMatchObject({ status });
    expect(await read()).toEqual(['2.0', '1.0']);
    expect(sent(2).get('if-none-match')).toBe('"one"');
  });

  it('does not reuse a listing after a timeout without fresh revalidation', async () => {
    transport.mockResolvedValueOnce(listing()).mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'));
    await read();
    await expect(read()).rejects.toMatchObject({ status: 0 });
  });

  it.each([300_001, -1])('does not send a validator outside its lifetime (%i ms)', async age => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(notModified());
    await read();
    vi.setSystemTime(Date.now() + age);
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(1).has('if-none-match')).toBe(false);
  });

  it('does not share validators after credential rotation or across packages', async () => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(notModified()).mockResolvedValueOnce(notModified());
    await read();
    await expect(read('Other.App')).rejects.toMatchObject({ status: 304 });
    vi.stubEnv('GITHUB_PAT', 'synthetic-rotated-token');
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(1).has('if-none-match')).toBe(false);
    expect(sent(2).has('if-none-match')).toBe(false);
  });

  it('does not let an older credential response overwrite the current cache', async () => {
    let release!: (response: Response) => void;
    transport.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; }));
    const oldRead = read();
    vi.stubEnv('GITHUB_PAT', 'synthetic-new-identity');
    transport.mockResolvedValueOnce(listing(['3.0'], '"new"'));
    expect(await read()).toEqual(['3.0']);
    release(listing(['1.0'], '"old"'));
    expect(await oldRead).toEqual(['1.0']);
    transport.mockResolvedValueOnce(notModified());
    expect(await read()).toEqual(['3.0']);
    expect(sent(2).get('if-none-match')).toBe('"new"');
  });

  it('does not retain a validator after a successful response loses its ETag', async () => {
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(listing(['3.0'], null))
      .mockResolvedValueOnce(notModified());
    await read();
    expect(await read()).toEqual(['3.0']);
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(2).has('if-none-match')).toBe(false);
  });

  it.each([null, '*', '"not a validator"'])('does not cache an unusable ETag %s', async etag => {
    transport.mockResolvedValueOnce(listing(['2.0'], etag)).mockResolvedValueOnce(notModified());
    expect(await read()).toEqual(['2.0']);
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(1).has('if-none-match')).toBe(false);
  });

  it('does not cache unauthenticated reads', async () => {
    vi.stubEnv('GITHUB_PAT', '');
    transport.mockResolvedValueOnce(listing()).mockResolvedValueOnce(notModified());
    await read();
    await expect(read()).rejects.toMatchObject({ status: 304 });
    expect(sent(1).has('if-none-match')).toBe(false);
    expect(sent(1).has('authorization')).toBe(false);
  });

  it('keeps nonstrict callers empty on an unsolicited 304', async () => {
    transport.mockResolvedValueOnce(notModified());
    expect(await fetchAvailableVersionsLive('Example.App')).toEqual([]);
  });

  it('bounds the cache and retains a recently revalidated entry', async () => {
    transport.mockImplementation(async () => listing());
    for (let n = 0; n < 128; n++) await read(`Example.App${n}`);
    transport.mockResolvedValueOnce(notModified());
    await read('Example.App0');
    await read('Example.New');
    transport.mockResolvedValueOnce(notModified());
    await expect(read('Example.App1')).rejects.toMatchObject({ status: 304 });
    expect(sent(130).has('if-none-match')).toBe(false);
  });
});
