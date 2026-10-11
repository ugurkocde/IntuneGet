import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const row = { winget_id: 'Example.App', tested_version: '1', architecture: 'x64',
  installer_sha256: 'A'.repeat(64), outcome: 'Passed', test_level: 'psadt-package',
  package_profile_sha256: 'B'.repeat(64), tested_at_utc: '2026-10-11T00:00:00Z' };
function setup(blocks: unknown[], unavailable = false, failAfterFirstPage = false) {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://catalog.example.invalid');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/qa_package_blocks')) {
      expect(new Headers(init.headers).get('apikey')).toBe('test-service-key');
      expect(url.searchParams.get('select')).toBe('winget_id,version,architecture,installer_sha256');
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || blocks.length);
      return unavailable || (failAfterFirstPage && offset > 0)
        ? Response.json({ message: 'Unavailable' }, { status: 503 })
        : Response.json(blocks.slice(offset, offset + limit));
    }
    return Response.json([row, { ...row, winget_id: 'Other.App', outcome: 'Failed' }]);
  }));
}
describe('Supabase QA deployment presentation', () => {
  it('returns truthful lifecycle evidence with private exact tuple availability', async () => {
    setup([{ winget_id: row.winget_id, version: '1', architecture: 'x64', installer_sha256: row.installer_sha256 }]);
    const { SupabaseCatalogSource } = await import('./supabase-source');
    const rows = await new SupabaseCatalogSource().getQaStatuses(['Example.App', 'Other.App']);
    expect(rows[0]).toMatchObject({ outcome: 'Passed', deployment_blocked: true });
    expect(rows[1]).toMatchObject({ outcome: 'Failed', deployment_blocked: false });
  });
  it('does not expose a passed badge when availability verification fails', async () => {
    setup([], true);
    const { SupabaseCatalogSource } = await import('./supabase-source');
    expect(await new SupabaseCatalogSource().getQaStatuses(['Example.App', 'Other.App']))
      .toEqual([expect.objectContaining({ outcome: 'Failed' })]);
  });
  it('retains failed rows but hides Passed when only the anon key is configured', async () => {
    setup([]);
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    const { SupabaseCatalogSource } = await import('./supabase-source');
    expect(await new SupabaseCatalogSource().getQaStatuses(['Example.App', 'Other.App']))
      .toEqual([expect.objectContaining({ outcome: 'Failed' })]);
    expect(vi.mocked(fetch).mock.calls.every(([input]) =>
      !new URL(String(input)).pathname.endsWith('/qa_package_blocks'))).toBe(true);
  });
  it.each([undefined, row.package_profile_sha256])(
    'returns null if availability is lost while reading a single QA result (%s)', async profile => {
      setup([]);
      vi.stubGlobal('fetch', vi.fn(async () => {
        vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
        return Response.json({ ...row, detection: {}, phase_results: {},
          install_command: 'install', uninstall_command: 'uninstall' });
      }));
      const { SupabaseCatalogSource } = await import('./supabase-source');
      expect(await new SupabaseCatalogSource().getQaResult(row.winget_id, profile)).toBeNull();
    }
  );
  it('finds an exact block after a full PostgREST page', async () => {
    const historical = Array.from({ length: 1000 }, (_, i) => ({ winget_id: row.winget_id,
      version: String(i + 2), architecture: 'x64', installer_sha256: 'C'.repeat(64) }));
    setup([...historical, { winget_id: row.winget_id, version: '1', architecture: 'x64',
      installer_sha256: row.installer_sha256 }]);
    const { SupabaseCatalogSource } = await import('./supabase-source');
    const rows = await new SupabaseCatalogSource().getQaStatuses(['Example.App', 'Other.App']);
    expect(rows[0]).toMatchObject({ outcome: 'Passed', deployment_blocked: true });
  });
  it('hides a passed badge if a later block page is unavailable', async () => {
    setup(Array.from({ length: 1001 }, () => ({ winget_id: row.winget_id, version: '2',
      architecture: 'x64', installer_sha256: 'C'.repeat(64) })), false, true);
    const { SupabaseCatalogSource } = await import('./supabase-source');
    expect(await new SupabaseCatalogSource().getQaStatuses(['Example.App', 'Other.App']))
      .toEqual([expect.objectContaining({ outcome: 'Failed' })]);
  });
});
