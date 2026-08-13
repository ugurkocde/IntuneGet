import { afterEach, describe, expect, it, vi } from 'vitest';

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(() => ({ client: true })),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

async function loadSupabase(url?: string, serviceKey?: string) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', url || '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey || '');
  return import('@/lib/supabase');
}

describe('Supabase server configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    createClientMock.mockClear();
  });

  it.each([
    [undefined, undefined],
    ['https://example.supabase.co', undefined],
    [undefined, 'service-key'],
  ])('is not configured without both URL and service key', async (url, serviceKey) => {
    const { getServerClientOrNull, isSupabaseServerConfigured } = await loadSupabase(
      url,
      serviceKey
    );

    expect(isSupabaseServerConfigured()).toBe(false);
    expect(getServerClientOrNull()).toBeNull();
    expect(createClientMock).not.toHaveBeenCalled();
  });

  it('returns a server client when both values are configured', async () => {
    const { getServerClientOrNull, isSupabaseServerConfigured } = await loadSupabase(
      'https://example.supabase.co',
      'service-key'
    );

    expect(isSupabaseServerConfigured()).toBe(true);
    expect(getServerClientOrNull()).toEqual({ client: true });
    expect(createClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'service-key',
      expect.any(Object)
    );
  });
});
