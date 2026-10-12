import { afterEach, describe, expect, it, vi } from 'vitest';
import { SupabaseCatalogSource } from './supabase-source';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function setup() {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
}

describe('catalog request performance', () => {
  it('starts the page query before waiting for its independent count', async () => {
    setup();
    let completeCount: ((response: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(async (_input: string, init: RequestInit) => {
      if (init.method === 'HEAD') return new Promise<Response>(resolve => { completeCount = resolve; });
      expect(completeCount).toBeDefined();
      completeCount!(new Response(null, { headers: { 'content-range': '0-0/42' } }));
      return Response.json([{ winget_id: 'Example.App', name: 'Example' }]);
    }));
    const result = await new SupabaseCatalogSource().getPopularApps({ limit: 20, offset: 0, sort: 'popular' });
    expect(result?.total).toBe(42);
    expect(result?.data[0].winget_id).toBe('Example.App');
  }, 1500);

  it('loads a public presentation without variant RPCs or full version history', async () => {
    setup();
    const urls: URL[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string) => {
      const url = new URL(input); urls.push(url);
      return url.pathname.endsWith('/curated_apps')
        ? Response.json({ winget_id: 'Example.App', name: 'Example', publisher: 'Publisher', latest_version: '1', is_locale_variant: false })
        : Response.json([{ version: '1' }]);
    }));
    const result = await new SupabaseCatalogSource().getAppByWingetId('Example.App', { presentationOnly: true });
    expect(result?.versions).toEqual(['1']);
    expect(result?.localeVariants).toBeUndefined();
    expect(urls).toHaveLength(2);
    expect(urls.find(url => url.pathname.endsWith('/version_history'))?.searchParams.get('limit')).toBe('10');
    expect(urls.find(url => url.pathname.endsWith('/curated_apps'))?.searchParams.get('select')).not.toBe('*');
  });
});
