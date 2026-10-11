import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { fromMock, selectMock, limitMock, abortSignalMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  selectMock: vi.fn(),
  limitMock: vi.fn(),
  abortSignalMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: fromMock })),
}));

vi.mock('@/lib/db', () => ({
  getDatabaseMode: vi.fn(() => 'supabase'),
  getDatabase: vi.fn(),
}));

vi.mock('@/lib/supabase', () => ({
  isSupabaseServerConfigured: vi.fn(() => true),
}));

import { GET } from '@/app/api/health/route';

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
    vi.stubEnv('AZURE_CLIENT_ID', 'client-id');
    vi.stubEnv('AZURE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('GITHUB_PAT', 'github-token');
    vi.stubEnv('GITHUB_OWNER', 'example');
    vi.stubEnv('GITHUB_WORKFLOWS_REPO', 'workflows');
    fromMock.mockReturnValue({ select: selectMock });
    selectMock.mockReturnValue({ limit: limitMock });
    limitMock.mockReturnValue({ abortSignal: abortSignalMock });
    abortSignalMock.mockResolvedValue({ error: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
  });

  it('probes the public curated catalog table and reports a healthy hosted deployment', async () => {
    const response = await GET();
    const body = await response.json();

    expect(fromMock).toHaveBeenCalledWith('curated_apps');
    expect(selectMock).toHaveBeenCalledWith('winget_id');
    expect(abortSignalMock).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(vi.getTimerCount()).toBe(0);
    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      status: 'healthy',
      mode: 'hosted',
      databaseMode: 'supabase',
      supabaseServerConfigured: true,
      services: {
        database: true,
        auth: true,
        pipeline: true,
      },
    }));
  });

  it('reports a database error without changing configured services', async () => {
    abortSignalMock.mockResolvedValue({ error: new Error('Synthetic database failure') });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'degraded',
      services: { database: false, auth: true, pipeline: true },
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts and returns a truthful response when the query never settles', async () => {
    abortSignalMock.mockReturnValue(new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(4999);
    const signal = abortSignalMock.mock.calls[0][0] as AbortSignal;
    expect(signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;
    expect(signal.aborted).toBe(true);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store, max-age=0');
    expect(await response.json()).toEqual(expect.objectContaining({
      status: 'degraded', responseTime: '5000ms',
      services: { database: false, auth: true, pipeline: true },
    }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a late successful query from changing the timeout response', async () => {
    let complete!: (value: { error: null }) => void;
    abortSignalMock.mockReturnValue(new Promise((resolve) => { complete = resolve; }));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    complete({ error: null });
    await Promise.resolve();
    expect((await response.json()).services.database).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('handles a late query rejection after returning the timeout response', async () => {
    let fail!: (reason: Error) => void;
    abortSignalMock.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(5000);
    const response = await pending;
    fail(new Error('Synthetic late failure'));
    await vi.advanceTimersByTimeAsync(0);
    expect((await response.json()).services.database).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports an abort rejection as a database failure and clears its deadline', async () => {
    abortSignalMock.mockRejectedValue(new DOMException('Synthetic abort', 'AbortError'));
    const response = await GET();
    expect((await response.json()).services.database).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
